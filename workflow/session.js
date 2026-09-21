// agent-template:workflow/workflow.run-cancellable:
//   func(prompt: string, model: option<string>, effort: option<string>)
//     -> result<_, string>
// The `-cancellable` suffix is what makes Obelisk allow an operator (the UI's
// Cancel button) to cancel a running session; do not drop it.
//
// The durable agent loop. One persistent execution per session. It:
//   - discovers session config (max steps, tool registry, system prompt) once;
//   - holds a provider-neutral chat history in memory (replayed on recovery);
//   - self-stubs each `session-event` onto a "session-events" join set so the UI
//     can read the transcript durably (Notifications below);
//   - keeps an always-open user-input offer on a per-turn "user-{turn}" join set,
//     racing it against each LLM completion so a prompt typed mid-turn is queued
//     and an interrupt stops the turn;
//   - dispatches each model tool call: the built-in `ask_user` is answered by the
//     `ask-user` stub (human-in-the-loop), every other tool is an activity called
//     by FFQN with the tool_use input as JSON.
//
// Pure, host-free helpers live in session-logic.js (unit-tested); this file is
// the host-facing orchestration. WIT record/variant fields cross into JS as
// snake_case (max_steps, system_prompt, turn_index, ...).

import { discover } from "agent-template:config/config";
import * as obelisk from "obelisk:workflow@1.0.0";
import * as dynamic from "obelisk:workflow-dynamic@1.0.0";
import { completionSubmit } from "agent-template:llm-obelisk-ext/chat";
import {
    askUserSubmit,
    injectionSubmit,
    recordOutputAwaitNext,
    recordOutputSubmit,
} from "agent-template:stub-obelisk-ext/stub";
import { recordOutputStub } from "agent-template:stub-obelisk-stub/stub";
import {
    EMPTY_REPLY_NUDGE,
    buildToolsJson,
    elapsedMilliseconds,
    emptyReplyError,
    hasUserVisibleText,
    interruptedError,
    llmErrorEvent,
    renderSystemPrompt,
    stepLimitError,
    stepWarningText,
    stepWarningThreshold,
    toolError,
    toolOk,
    toolResultMessageValue,
    userText,
} from "./session-logic.js";

const SESSION_EVENTS_JOIN_SET = "session-events";
const PROTOCOL_VERSION = 1;

export default function runCancellable(prompt, model, effort) {
    try {
        return runInner(prompt ?? "", model ?? "", effort ?? "");
    } catch (e) {
        throw errorMessage(e);
    }
}

function runInner(prompt, model, effort) {
    const executionId = obelisk.executionIdCurrent();
    const config = discover(executionId, model, effort);
    if (typeof config?.system_prompt !== "string" || !config.system_prompt) {
        throw "config.discover did not return a system prompt";
    }
    agentLoop(prompt, model, effort, config);
}

function errorMessage(e) {
    if (e instanceof obelisk.ChildError) {
        return typeof e.value === "string" ? e.value : (e.message ?? "child execution failed");
    }
    if (typeof e === "string") return e;
    return e?.message ?? String(e);
}

function hostNowMs() {
    return Date.now();
}

// ----- notifications: self-stub each session event onto a durable join set -----

class Notifications {
    constructor() {
        // Lazily created on first flush (matching the pattern that lets a
        // session record its join set at the same replay point every time).
        this.joinSet = null;
        this.turnIndex = 0;
        // Buffered until flush(): a burst of events published back-to-back
        // lands as one durable record instead of one submit+stub+await round
        // trip per event.
        this.pending = [];
    }

    setTurnIndex(turnIndex) {
        this.turnIndex = turnIndex;
    }

    notify(event) {
        this.pending.push(event);
    }

    // Publish every buffered event as one record-output call. Callers must flush
    // right before any real blocking wait so the transcript is up to date by the
    // time the session goes idle waiting on the outside.
    flush() {
        if (this.pending.length === 0) return;
        if (!this.joinSet) this.joinSet = obelisk.createJoinSet({ name: SESSION_EVENTS_JOIN_SET });
        const events = this.pending;
        this.pending = [];
        const execId = recordOutputSubmit(this.joinSet);
        recordOutputStub(execId, { ok: events });
        recordOutputAwaitNext(this.joinSet);
        if (this.joinSet.lastId !== execId) {
            throw `unexpected session event response: ${this.joinSet.lastId}`;
        }
    }

    humanInputRequested(executionId, question) {
        this.notify({ human_input_requested: { execution_id: executionId, question, turn_index: this.turnIndex } });
    }

    humanInputResolved(executionId) {
        this.notify({ human_input_resolved: { execution_id: executionId, turn_index: this.turnIndex } });
    }

    close() {
        try { this.flush(); } catch (_) { /* best-effort during cleanup */ }
        if (this.joinSet) this.joinSet.close();
    }
}

// ----- ask_user: the human-in-the-loop tool, backed by the ask-user stub -----

function askUser(question, notifications) {
    const joinSet = obelisk.createJoinSet();
    const executionId = askUserSubmit(joinSet, question);
    notifications.humanInputRequested(executionId, question);
    notifications.flush();
    let answer;
    try {
        answer = joinSet.joinNext();
    } catch (e) {
        joinSet.close();
        throw `ask-user await failed: ${errorMessage(e)}`;
    }
    if (joinSet.lastId !== executionId) {
        joinSet.close();
        throw `unexpected ask-user response: ${joinSet.lastId}`;
    }
    notifications.humanInputResolved(executionId);
    joinSet.close();
    return typeof answer === "string" ? answer : String(answer);
}

// ----- durable "user" channel: LLM completion raced against injection -----

function openSession(turnIndex, notifications) {
    const joinSet = obelisk.createJoinSet({ name: `user-${turnIndex}` });
    const injectionId = injectionSubmit(joinSet);
    notifications.notify({ input_offered: { execution_id: injectionId, turn_index: turnIndex } });
    return { joinSet, injectionId, turnIndex };
}

function advanceTurn(session, notifications) {
    if (session.joinSet) session.joinSet.close();
    const turnIndex = session.turnIndex + 1;
    session.joinSet = obelisk.createJoinSet({ name: `user-${turnIndex}` });
    session.injectionId = injectionSubmit(session.joinSet);
    session.turnIndex = turnIndex;
    notifications.notify({ input_offered: { execution_id: session.injectionId, turn_index: turnIndex } });
    return turnIndex;
}

function rearmUserInput(session, notifications) {
    session.injectionId = injectionSubmit(session.joinSet);
    notifications.notify({ input_offered: { execution_id: session.injectionId, turn_index: session.turnIndex } });
}

function publishAgentStatus(notifications, working, turnIndex) {
    notifications.notify({ agent_status: { working, turn_index: turnIndex } });
}

function takeUserEvent(session, notifications) {
    notifications.flush();
    let event;
    try {
        event = session.joinSet.joinNext();
    } catch (e) {
        throw `session injection failed: ${errorMessage(e)}`;
    }
    if (session.joinSet.lastId !== session.injectionId) {
        throw `unexpected session response while idle: ${session.joinSet.lastId}`;
    }
    rearmUserInput(session, notifications);
    return event;
}

// Apply one injected input. Returns true when it should trigger an LLM turn (a
// prompt); an interrupt received while idle is a stale click and does nothing.
function applySessionInput(event, turnIndex, notifications, messages) {
    if (event.prompt) {
        const { id, text } = event.prompt;
        notifications.notify({ user_message: { id, text, turn_index: turnIndex } });
        messages.push(userText(text));
        return true;
    }
    return false;
}

// One LLM call raced against the user input offer; each injected event lands
// after the request snapshot, so it reaches the model on the following turn.
function callLlmWithUser(session, system, messages, toolsJson, model, effort, notifications) {
    let promptQueued = false;
    while (true) {
        notifications.flush();
        const requestMessageCount = messages.length;
        const messagesJson = JSON.stringify(messages);
        const startedAt = hostNowMs();
        const completionId = completionSubmit(session.joinSet, system, messagesJson, toolsJson, model, effort);

        let completion;
        while (true) {
            let value;
            let failed = null;
            notifications.flush();
            try {
                value = session.joinSet.joinNext();
            } catch (e) {
                if (!(e instanceof obelisk.ChildError)) throw e;
                failed = e;
            }
            const completedId = session.joinSet.lastId;
            if (completedId === completionId) {
                if (failed) return { kind: "failed", message: `llm.completion failed: ${errorMessage(failed)}` };
                completion = value;
                break;
            } else if (completedId === session.injectionId) {
                if (failed) throw `session injection failed: ${errorMessage(failed)}`;
                const event = value;
                if (event.interrupt) {
                    // Closing this turn's join set cancels the outstanding
                    // completion immediately; the outer loop opens the next
                    // turn's set after recording the stop.
                    session.joinSet.close();
                    session.joinSet = null;
                    completion = null;
                    break;
                }
                rearmUserInput(session, notifications);
                promptQueued = promptQueued || applySessionInput(event, session.turnIndex, notifications, messages);
            } else {
                throw `unexpected session response: ${completedId}`;
            }
        }

        if (completion === null) return { kind: "interrupted" };
        if (completion.rate_limited) {
            const seconds = Math.max(1, completion.rate_limited.retry_after_seconds);
            try { obelisk.sleep({ seconds }); } catch { /* cancelled: retry immediately */ }
            continue;
        }
        const reply = completion.reply;
        let content;
        try {
            content = JSON.parse(reply.content_json);
        } catch (e) {
            throw `llm reply content_json is not valid JSON: ${e}`;
        }
        if (!Array.isArray(content)) throw "llm reply content must be a JSON array of blocks";
        return {
            kind: "reply",
            content,
            contentJson: reply.content_json,
            durationMilliseconds: elapsedMilliseconds(startedAt, hostNowMs()),
            requestMessageCount,
            promptQueued,
        };
    }
}

// ----- tool dispatch -----

// ask_user is answered inline via the stub; every other tool is an activity
// called by FFQN with the tool_use input serialized as its single argument.
function dispatchTool(call, toolsByName, notifications) {
    if (call.name === "ask_user") {
        const question = typeof call.input?.question === "string" ? call.input.question : "";
        if (!question.trim()) return toolError(call.id, "question is required");
        try {
            return toolOk(call.id, askUser(question, notifications));
        } catch (e) {
            return toolError(call.id, typeof e === "string" ? e : String(e?.message ?? e));
        }
    }
    const tool = toolsByName.get(call.name);
    if (!tool) return toolError(call.id, `unknown tool: ${call.name}`);
    try {
        const value = dynamic.call(tool.ffqn, [JSON.stringify(call.input ?? {})]);
        return toolOk(call.id, typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) {
        return toolError(call.id, errorMessage(e));
    }
}

// ----- main loop -----

function agentLoop(prompt, model, effort, config) {
    const maxSteps = config.max_steps;
    const tools = config.tools ?? [];
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const toolsJson = buildToolsJson(tools);
    const system = renderSystemPrompt(config.system_prompt, tools);

    const notifications = new Notifications();
    const messages = prompt.trim() ? [userText(prompt.trim())] : [];

    notifications.notify({
        session_started: { protocol_version: PROTOCOL_VERSION, prompt, backend: model, effort, system_prompt: system },
    });

    let turnIndex = 0;
    let emptyReplyNudgedTurn = -1;
    let stepWarnedTurn = -1;
    let shouldCallLlm = messages.length > 0;
    let agentSteps = 0;
    const session = openSession(turnIndex, notifications);
    publishAgentStatus(notifications, shouldCallLlm, turnIndex);

    try {
        while (true) {
            session.turnIndex = turnIndex;
            notifications.setTurnIndex(turnIndex);

            if (shouldCallLlm && agentSteps >= maxSteps) {
                const error = stepLimitError(turnIndex, maxSteps);
                // A user, not assistant, message: a synthetic assistant turn can
                // poison provider prefix pairing, so the next turn can re-pair.
                messages.push(userText(error.text));
                notifications.notify({ agent_error: error });
                shouldCallLlm = false;
                publishAgentStatus(notifications, false, turnIndex);
                agentSteps = 0;
                turnIndex = advanceTurn(session, notifications);
                continue;
            }
            if (shouldCallLlm && agentSteps >= stepWarningThreshold(maxSteps) && stepWarnedTurn !== turnIndex) {
                stepWarnedTurn = turnIndex;
                messages.push(userText(stepWarningText(maxSteps)));
            }

            let turnComplete = false;
            if (!shouldCallLlm) {
                const event = takeUserEvent(session, notifications);
                shouldCallLlm = applySessionInput(event, turnIndex, notifications, messages);
                if (shouldCallLlm) publishAgentStatus(notifications, true, turnIndex);
                turnComplete = !shouldCallLlm;
            } else {
                publishAgentStatus(notifications, true, turnIndex);
                const outcome = callLlmWithUser(session, system, messages, toolsJson, model, effort, notifications);
                if (outcome.kind === "failed") {
                    notifications.notify({ agent_error: llmErrorEvent(turnIndex, outcome.message) });
                    shouldCallLlm = false;
                    agentSteps = 0;
                    publishAgentStatus(notifications, false, turnIndex);
                    turnIndex = advanceTurn(session, notifications);
                    continue;
                }
                if (outcome.kind === "interrupted") {
                    const error = interruptedError(turnIndex);
                    messages.push(userText(error.text));
                    notifications.notify({ agent_error: error });
                    shouldCallLlm = false;
                    agentSteps = 0;
                    publishAgentStatus(notifications, false, turnIndex);
                    turnIndex = advanceTurn(session, notifications);
                    continue;
                }

                agentSteps += 1;
                const calls = outcome.content
                    .filter((b) => b?.type === "tool_use")
                    .map((b) => ({ id: b.id ?? "", name: b.name ?? "", input: b.input ?? {} }));
                const nudgeEmptyReply = calls.length === 0 && !outcome.promptQueued && !hasUserVisibleText(outcome.content) && emptyReplyNudgedTurn !== turnIndex;
                const assistantCompletesTurn = calls.length === 0 && !outcome.promptQueued && !nudgeEmptyReply;
                notifications.notify({
                    assistant_reply: {
                        content_json: outcome.contentJson,
                        turn_index: turnIndex,
                        step: agentSteps,
                        duration_milliseconds: outcome.durationMilliseconds,
                        turn_complete: assistantCompletesTurn,
                    },
                });
                messages.splice(outcome.requestMessageCount, 0, { role: "assistant", content: outcome.content });

                if (calls.length > 0) {
                    const resultBlocks = [];
                    for (const call of calls) {
                        const startedAt = hostNowMs();
                        const block = dispatchTool(call, toolsByName, notifications);
                        const durationMilliseconds = elapsedMilliseconds(startedAt, hostNowMs());
                        notifications.notify({
                            tool_result: {
                                id: call.id,
                                name: call.name,
                                output: block.ok ? { ok: block.result } : { error: block.message },
                                turn_index: turnIndex,
                                step: agentSteps,
                                duration_milliseconds: durationMilliseconds,
                            },
                        });
                        resultBlocks.push(toolResultMessageValue(block));
                    }
                    messages.splice(outcome.requestMessageCount + 1, 0, { role: "user", content: resultBlocks });
                    shouldCallLlm = true;
                } else if (nudgeEmptyReply) {
                    emptyReplyNudgedTurn = turnIndex;
                    messages.splice(outcome.requestMessageCount + 1, 0, userText(EMPTY_REPLY_NUDGE));
                    shouldCallLlm = true;
                } else {
                    if (!outcome.promptQueued && !hasUserVisibleText(outcome.content)) {
                        notifications.notify({ agent_error: emptyReplyError(turnIndex) });
                    }
                    shouldCallLlm = outcome.promptQueued;
                    agentSteps = 0;
                    turnComplete = assistantCompletesTurn;
                    if (!shouldCallLlm) publishAgentStatus(notifications, false, turnIndex);
                }
            }
            if (turnComplete) turnIndex = advanceTurn(session, notifications);
        }
    } finally {
        if (session.joinSet) session.joinSet.close();
        notifications.close();
    }
}

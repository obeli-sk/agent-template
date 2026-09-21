// Walk the session notification stream into the transcript and live UI state.

import { getExecutionResponses, getLatestExecutionResponses } from "./obelisk-api.js";
import {
    emptyMarkers,
    projectLatestWindow,
    sessionEventEndsTurn,
    sessionEventList,
} from "../../shared/session-state.js";

const SESSION_EVENTS_JOIN_SET = "n:session-events";

export async function loadResponses(execId, startCursor = 0) {
    const replies = [];
    const toolResults = [];
    const userMessages = [];
    const humanInputEvents = [];
    const agentErrors = [];
    let sessionStarted;
    let inputOffer;
    let agentWorking;
    let cursor = startCursor;
    let including = startCursor === 0;
    while (true) {
        let payload;
        try {
            payload = await getExecutionResponses(execId, SESSION_EVENTS_JOIN_SET, cursor, including, 200);
        } catch (_) { break; }
        const responses = payload.responses || [];
        for (const r of responses) {
            // record-output batches several events into one response; each
            // element is applied in order, same as separate rows.
            for (const value of sessionEventList(r)) {
                const projection = { replies, toolResults, userMessages, humanInputEvents, agentErrors, sessionStarted, inputOffer, agentWorking };
                appendSessionEvent(projection, value, r);
                inputOffer = projection.inputOffer;
                agentWorking = projection.agentWorking;
                sessionStarted = projection.sessionStarted;
            }
        }
        const next = payload.scan_cursor;
        if (typeof next !== "number" || next <= cursor) break;
        cursor = next;
        including = false;
        if (typeof payload.max_cursor === "number" && cursor >= payload.max_cursor) break;
    }
    return { replies, toolResults, userMessages, humanInputEvents, agentErrors, sessionStarted, inputOffer, agentWorking, cursor };
}

// Bounded latest-window scan for the live working flag plus the terminal markers
// the state projection needs.
export async function loadLatestAgentState(execId) {
    let payload;
    try { payload = await getLatestExecutionResponses(execId, SESSION_EVENTS_JOIN_SET, 50); }
    catch (_) { return { working: false, markers: emptyMarkers() }; }
    const scan = projectLatestWindow(payload.responses || []);
    return { working: scan.working === true, markers: scan.markers };
}

function appendSessionEvent(target, event, response) {
    if (!event || typeof event !== "object") return;
    if (sessionEventEndsTurn(event)) target.inputOffer = null;
    const createdAt = response.event?.created_at || "";
    if (event.session_started) {
        const started = event.session_started;
        target.sessionStarted = {
            protocol_version: started.protocol_version,
            prompt: typeof started.prompt === "string" ? started.prompt : "",
            backend: typeof started.backend === "string" ? started.backend : "",
            effort: typeof started.effort === "string" ? started.effort : "",
            system_prompt: typeof started.system_prompt === "string" ? started.system_prompt : "",
            created_at: createdAt,
        };
    } else if (event.input_offered) {
        const offer = event.input_offered;
        target.inputOffer = {
            id: typeof offer.execution_id === "string" ? offer.execution_id : "",
            turn_index: Number.isInteger(offer.turn_index) ? offer.turn_index : null,
        };
    } else if (event.agent_status) {
        target.agentWorking = event.agent_status.working === true;
    } else if (event.human_input_requested) {
        const requested = event.human_input_requested;
        target.humanInputEvents.push({
            kind: "requested",
            id: typeof requested.execution_id === "string" ? requested.execution_id : "",
            question: typeof requested.question === "string" ? requested.question : "",
            turn_index: Number.isInteger(requested.turn_index) ? requested.turn_index : null,
        });
    } else if (event.human_input_resolved) {
        const resolved = event.human_input_resolved;
        target.humanInputEvents.push({
            kind: "resolved",
            id: typeof resolved.execution_id === "string" ? resolved.execution_id : "",
            turn_index: Number.isInteger(resolved.turn_index) ? resolved.turn_index : null,
        });
    } else if (event.user_message) {
        const message = event.user_message;
        target.userMessages.push({
            id: message.id || "",
            text: message.text || "",
            created_at: createdAt,
            turn_index: Number.isInteger(message.turn_index) ? message.turn_index : null,
        });
    } else if (event.assistant_reply) {
        appendAssistantReply(target.replies, event.assistant_reply, createdAt);
    } else if (event.agent_error) {
        const error = event.agent_error;
        target.agentErrors.push({
            id: typeof error.id === "string" ? error.id : "",
            text: typeof error.text === "string" ? error.text : "",
            created_at: createdAt,
            turn_index: Number.isInteger(error.turn_index) ? error.turn_index : null,
        });
        target.replies.push({
            reply: { error: error.text },
            created_at: createdAt,
            turn_index: Number.isInteger(error.turn_index) ? error.turn_index : null,
            turn_complete: true,
        });
    } else if (event.tool_result) {
        target.toolResults.push(normalizeSessionToolResult(event.tool_result, createdAt));
    }
}

function appendAssistantReply(replies, rep, createdAt) {
    if (!rep || typeof rep.content_json !== "string") return;
    let blocks = [];
    try { blocks = JSON.parse(rep.content_json); } catch (_) { blocks = []; }
    if (!Array.isArray(blocks)) blocks = [];
    const toolUses = blocks.filter((b) => b && b.type === "tool_use");
    const text = blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
    const reply = toolUses.length > 0
        ? { tool_calls: toolUses.map((b) => ({ id: typeof b.id === "string" ? b.id : "", name: b.name, args: b.input || {} })) }
        : { response: text };
    replies.push({
        reply,
        narration: toolUses.length > 0 ? text : "",
        created_at: createdAt,
        turn_index: Number.isInteger(rep.turn_index) ? rep.turn_index : null,
        step: Number.isInteger(rep.step) ? rep.step : null,
        duration_milliseconds: rep.duration_milliseconds,
        turn_complete: rep.turn_complete === true,
    });
}

function normalizeSessionToolResult(result, createdAt) {
    const out = { id: String(result.id || ""), name: String(result.name || ""), created_at: createdAt };
    if (result.output && "ok" in result.output) out.ok = result.output.ok;
    else if (result.output && "error" in result.output) out.err = result.output.error;
    out.duration_milliseconds = result.duration_milliseconds;
    if (Number.isInteger(result.turn_index)) out.turn_index = result.turn_index;
    if (Number.isInteger(result.step)) out.step = result.step;
    return out;
}

export function parseJoinName(joinSetId) {
    // One-off join sets use "o:<ordinal>-<name>"; named join sets use "n:<name>".
    if (typeof joinSetId !== "string") return "";
    const name = rawJoinName(joinSetId);
    return /^user-\d+$/.test(name) ? "user" : name;
}

function rawJoinName(joinSetId) {
    if (typeof joinSetId !== "string") return "";
    if (joinSetId.startsWith("n:")) return joinSetId.substring(2);
    const dash = joinSetId.indexOf("-");
    return dash === -1 ? "" : joinSetId.substring(dash + 1);
}

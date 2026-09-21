// Run listing (sidebar) and per-run detail assembly: normalise an execution and
// its session-event stream into the transcript, status, and pending
// human-gate shape the UI renders.

import {
    getExecutionLogs,
    getExecutionRecord,
    getExecutionStatus,
    listExecutions,
} from "./obelisk-api.js";
import { loadLatestAgentState, loadResponses, parseJoinName } from "./responses.js";
import { SESSION_STATE_LABELS, emptyMarkers, projectSessionState } from "../../shared/session-state.js";

const WORKFLOW_FFQN = "agent-template:workflow/workflow.run";

function pickRunState(workflowStatus) {
    const ps = workflowStatus?.pending_state || null;
    return {
        status: ps?.status || "unknown",
        result_kind: ps?.result_kind ?? null,
        join_name: parseJoinName(ps?.join_set_id),
    };
}

function projectRun(runState, working, markers) {
    const state = projectSessionState({
        status: runState.status,
        resultKind: runState.result_kind,
        joinName: runState.join_name,
        working,
        markers,
    });
    const [label, cls] = SESSION_STATE_LABELS[state];
    return { state, label, cls };
}

export async function listRuns() {
    const executions = await listExecutions(WORKFLOW_FFQN, "", false, false, 100);
    const runs = await Promise.all(executions.map(async (e) => {
        const id = e.execution_id;
        const runState = pickRunState(e);
        const latest = await loadLatestAgentState(id);
        const working = runState.status === "blocked_by_join_set" && runState.join_name === "user" && latest.working;
        return {
            id,
            created_at: e.created_at || "",
            ...runState,
            working,
            ...projectRun(runState, latest.working, latest.markers || emptyMarkers()),
        };
    }));
    // Newest first.
    runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { runs };
}

export async function detailRun(id, cursorState) {
    const resetTranscript = cursorState.workflowId !== id;
    const responseCursor = resetTranscript ? 0 : cursorState.responseCursor;
    const [status, walk, finalResult] = await Promise.all([
        loadStatus(id),
        loadResponses(id, responseCursor),
        loadFinalResult(id),
    ]);
    const started = walk.sessionStarted;
    const runState = pickRunState(status);
    const markers = { lastReplyTurn: null, stepLimitTurn: null };
    for (const reply of walk.replies) {
        if (!reply.turn_complete) continue;
        const turn = Number.isInteger(reply.turn_index) ? reply.turn_index : -1;
        if (typeof reply.reply?.response === "string" && reply.reply.response) {
            markers.lastReplyTurn = Math.max(markers.lastReplyTurn ?? -1, turn);
        }
    }
    for (const error of walk.agentErrors) {
        if (error.id.startsWith("step-limit-")) {
            markers.stepLimitTurn = Math.max(
                markers.stepLimitTurn ?? -1,
                Number.isInteger(error.turn_index) ? error.turn_index : -1,
            );
        }
    }
    return {
        id,
        ...runState,
        ...projectRun(runState, walk.agentWorking === true, markers),
        created_at: status?.created_at || "",
        prompt: started?.prompt || null,
        backend: started?.backend || null,
        effort: started?.effort || null,
        system_prompt: started?.system_prompt || null,
        transcript: {
            reset: resetTranscript,
            workflow_id: id,
            replies: walk.replies,
            user_messages: walk.userMessages,
            human_input_events: walk.humanInputEvents,
            agent_errors: walk.agentErrors,
            session_started: walk.sessionStarted,
            sent_results: walk.toolResults,
            input_offer: walk.inputOffer,
            agent_working: walk.agentWorking,
            response_cursor: walk.cursor,
        },
        final_result: finalResult,
    };
}

async function loadStatus(id) {
    try { return await getExecutionStatus(id); }
    catch (_) { return null; }
}

async function loadFinalResult(id) {
    try {
        const status = await getExecutionStatus(id);
        if (status?.pending_state?.status !== "finished") return null;
        return await getExecutionRecord(id);
    } catch (e) { return { error: String(e) }; }
}

// Logs are loaded lazily from a separate endpoint because a run can have many
// derived executions (the LLM, tool, and stub children).
export async function loadExecutionTreeLogs(workflowId, startCursor) {
    const logs = [];
    let cursor = startCursor || "";
    let including = false;
    while (true) {
        let page;
        try {
            page = await getExecutionLogs(workflowId, true, cursor, including, 200);
        } catch (_) { break; }
        if (!Array.isArray(page) || page.length === 0) break;
        logs.push(...page);
        const next = page[page.length - 1]?.cursor;
        if (typeof next !== "string" || !next || next === cursor) break;
        cursor = next;
        including = false;
        if (page.length < 200) break;
    }
    return { logs, cursor: startCursor && logs.length === 0 ? startCursor : cursor };
}

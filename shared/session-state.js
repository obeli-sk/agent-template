// Central session-state projection: one place maps raw execution/session facts
// onto the state label the sidebar and the detail header render. Consumer:
// webhook/lib/runs.js (serves the precomputed state/label/cls). The browser
// shell only consumes the rendered labels.

export const SESSION_STATES = {
    THINKING: "thinking",
    WORKING: "working",
    AWAITING_USER: "awaiting-user",
    AWAITING_ANSWER: "awaiting-answer",
    FINAL_RESPONSE: "final-response",
    STEP_LIMIT: "step-limit",
    FINISHED_OK: "finished-ok",
    CANCELLED: "cancelled",
    FAILED: "failed",
    UNKNOWN: "unknown",
};

// Terminal marker turns derived from the session-event stream:
//   lastReplyTurn: newest completed assistant text message (a final response).
//   stepLimitTurn: newest MAX_STEPS agent error.
//   { lastReplyTurn: number | null, stepLimitTurn: number | null }

/**
 * @param {object} input
 * @param {string} input.status obelisk pending_state.status
 * @param {object|null} input.resultKind parsed final result ({ok}|{err}) when finished
 * @param {string} input.joinName suffix of the blocked-on join set
 * @param {boolean} input.working latest agent_status.working flag
 * @param {object} input.markers terminal-marker turns (see above)
 */
export function projectSessionState({ status, resultKind, joinName, working, markers }) {
    if (status === "finished") return finishedState(resultKind);
    if (status === "running") return SESSION_STATES.WORKING;
    if (status === "blocked_by_join_set") {
        return blockedState(joinName || "", working === true, markers || EMPTY_MARKERS);
    }
    return SESSION_STATES.UNKNOWN;
}

const EMPTY_MARKERS = {};

function finishedState(resultKind) {
    const err = errArm(resultKind);
    if (err !== undefined) {
        return err?.execution_failure === "cancelled"
            ? SESSION_STATES.CANCELLED
            : SESSION_STATES.FAILED;
    }
    return SESSION_STATES.FINISHED_OK;
}

function errArm(resultKind) {
    if (!resultKind || typeof resultKind !== "object") return undefined;
    if (resultKind.err !== undefined) return resultKind.err;
    if (resultKind.Err !== undefined) return resultKind.Err;
    return undefined;
}

function blockedState(join, working, markers) {
    // ask-user stubs park on their own `o:N-ask-user` set; the offer is the
    // question awaiting an answer.
    if (/ask-user/.test(join)) return SESSION_STATES.AWAITING_ANSWER;
    // The completion child shares the per-turn user join set (user input races
    // the model call), so `user + working` means thinking, not parked.
    if (working) return join === "user" ? SESSION_STATES.THINKING : SESSION_STATES.WORKING;
    // Parked on the user offer: whatever terminal event closed the most recent
    // turn decides the label. Each marker carries the turn it ended, so a later
    // turn's event supersedes an earlier one.
    if (join === "user") {
        const stepLimitTurn = markers.stepLimitTurn ?? null;
        const lastReplyTurn = markers.lastReplyTurn ?? null;
        if (stepLimitTurn !== null && (lastReplyTurn === null || stepLimitTurn > lastReplyTurn)) {
            return SESSION_STATES.STEP_LIMIT;
        }
        if (lastReplyTurn !== null) return SESSION_STATES.FINAL_RESPONSE;
        return SESSION_STATES.AWAITING_USER;
    }
    // Blocked elsewhere without a working flag is a transient tool wait.
    return SESSION_STATES.WORKING;
}

// Rendered chip per state: [label, css class].
export const SESSION_STATE_LABELS = {
    [SESSION_STATES.THINKING]: ["thinking", "working"],
    [SESSION_STATES.WORKING]: ["working", "working"],
    [SESSION_STATES.AWAITING_USER]: ["your turn", "awaiting"],
    [SESSION_STATES.AWAITING_ANSWER]: ["awaiting answer", "awaiting"],
    [SESSION_STATES.FINAL_RESPONSE]: ["final response", "finished"],
    [SESSION_STATES.STEP_LIMIT]: ["step limit", "awaiting"],
    [SESSION_STATES.FINISHED_OK]: ["ok", "finished"],
    [SESSION_STATES.CANCELLED]: ["cancelled", "err"],
    [SESSION_STATES.FAILED]: ["failed", "err"],
    [SESSION_STATES.UNKNOWN]: ["unknown", ""],
};

/** Accumulate terminal-marker facts from one raw session-event value. */
export function scanMarkers(markers, value) {
    if (!value || typeof value !== "object") return;
    if (value.agent_error) {
        const err = value.agent_error;
        if (
            typeof err.id === "string" && err.id.startsWith("step-limit-")
            || typeof err.text === "string" && err.text.startsWith("exceeded MAX_STEPS")
        ) {
            const turn = intOr(err.turn_index, -1);
            if (turn >= 0) markers.stepLimitTurn = Math.max(markers.stepLimitTurn ?? -1, turn);
        }
        return;
    }
    if (value.assistant_reply) {
        const rep = value.assistant_reply;
        if (rep.turn_complete !== true) return;
        let textOnly = false;
        try {
            const blocks = JSON.parse(rep.content_json);
            textOnly = Array.isArray(blocks)
                && blocks.some((b) => b?.type === "text" && b.text)
                && !blocks.some((b) => b?.type === "tool_use");
        } catch (_) { /* unparseable content never counts as a final reply */ }
        if (textOnly) {
            const turn = intOr(rep.turn_index, -1);
            if (turn >= 0) markers.lastReplyTurn = Math.max(markers.lastReplyTurn ?? -1, turn);
        }
    }
}

/** Whether a session event ends the turn whose advertised input offer it followed. */
export function sessionEventEndsTurn(value) {
    if (value?.assistant_reply?.turn_complete === true) return true;
    const errorId = value?.agent_error?.id;
    return typeof errorId === "string"
        && /^(step-limit|llm-error|interrupted|empty-reply)-/.test(errorId);
}

function intOr(value, fallback) {
    return Number.isInteger(value) ? value : fallback;
}

export function emptyMarkers() {
    return { lastReplyTurn: null, stepLimitTurn: null };
}

// Unwraps one recorded-notification row into its stub payload. On the
// session-events join set this is a list<session-event> (record-output batches
// several events into one response).
export function sessionEventValue(response) {
    const event = response?.event?.event?.event;
    if (!event || event.type !== "child_execution_finished") return null;
    return event.result?.ok?.value ?? event.result?.ok ?? null;
}

// Normalizes a session-events row to a list.
export function sessionEventList(response) {
    const value = sessionEventValue(response);
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

// Newest-facts scan over one bounded page of GET /responses. Pages arrive
// oldest-first, so a forward walk makes the newest fact win each overwrite:
//   working: newest agent_status.working flag, null when none is in the window
//   offerId: newest input_offered.execution_id
//   markers: terminal-marker turns accumulated across the whole window
export function projectLatestWindow(responses, valueOf = sessionEventList) {
    const markers = emptyMarkers();
    let working = null;
    let offerId = null;
    for (const response of responses ?? []) {
        for (const value of valueOf(response)) {
            if (!value || typeof value !== "object") continue;
            scanMarkers(markers, value);
            if (sessionEventEndsTurn(value)) offerId = null;
            if (typeof value.agent_status?.working === "boolean") {
                working = value.agent_status.working;
            }
            if (typeof value.input_offered?.execution_id === "string") {
                offerId = value.input_offered.execution_id;
            }
        }
    }
    return { working, offerId, markers };
}

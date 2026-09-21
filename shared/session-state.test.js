import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SESSION_STATES,
    emptyMarkers,
    projectLatestWindow,
    projectSessionState,
    scanMarkers,
    sessionEventEndsTurn,
} from "./session-state.js";

function project(over) {
    return projectSessionState({ status: "blocked_by_join_set", joinName: "user", working: false, markers: emptyMarkers(), ...over });
}

test("running and finished map to their states", () => {
    assert.equal(projectSessionState({ status: "running" }), SESSION_STATES.WORKING);
    assert.equal(projectSessionState({ status: "finished", resultKind: {} }), SESSION_STATES.FINISHED_OK);
    assert.equal(projectSessionState({ status: "finished", resultKind: { err: {} } }), SESSION_STATES.FAILED);
    assert.equal(projectSessionState({ status: "finished", resultKind: { err: { execution_failure: "cancelled" } } }), SESSION_STATES.CANCELLED);
});

test("thinking vs your-turn on the user join set", () => {
    assert.equal(project({ working: true }), SESSION_STATES.THINKING);
    assert.equal(project({ working: false }), SESSION_STATES.AWAITING_USER);
});

test("ask-user join set is awaiting an answer", () => {
    assert.equal(project({ joinName: "o:3-ask-user" }), SESSION_STATES.AWAITING_ANSWER);
});

test("final-response and step-limit markers win by newest turn", () => {
    assert.equal(project({ markers: { lastReplyTurn: 2, stepLimitTurn: null } }), SESSION_STATES.FINAL_RESPONSE);
    assert.equal(project({ markers: { lastReplyTurn: 1, stepLimitTurn: 2 } }), SESSION_STATES.STEP_LIMIT);
    assert.equal(project({ markers: { lastReplyTurn: 3, stepLimitTurn: 2 } }), SESSION_STATES.FINAL_RESPONSE);
});

test("scanMarkers records step-limit and text-only replies", () => {
    const markers = emptyMarkers();
    scanMarkers(markers, { agent_error: { id: "step-limit-4", turn_index: 4 } });
    scanMarkers(markers, { assistant_reply: { content_json: JSON.stringify([{ type: "text", text: "done" }]), turn_index: 5, turn_complete: true } });
    scanMarkers(markers, { assistant_reply: { content_json: JSON.stringify([{ type: "tool_use", id: "1", name: "x" }]), turn_index: 6, turn_complete: true } });
    assert.equal(markers.stepLimitTurn, 4);
    assert.equal(markers.lastReplyTurn, 5);
});

test("sessionEventEndsTurn detects turn-closing events", () => {
    assert.equal(sessionEventEndsTurn({ assistant_reply: { turn_complete: true } }), true);
    assert.equal(sessionEventEndsTurn({ assistant_reply: { turn_complete: false } }), false);
    assert.equal(sessionEventEndsTurn({ agent_error: { id: "interrupted-2" } }), true);
    assert.equal(sessionEventEndsTurn({ user_message: { id: "u1" } }), false);
});

test("projectLatestWindow ends on the newest working flag and offer", () => {
    const responses = [
        { event: { event: { event: { type: "child_execution_finished", result: { ok: { value: [{ agent_status: { working: true } }, { input_offered: { execution_id: "E_1.n:user-0_1" } }] } } } } } },
        { event: { event: { event: { type: "child_execution_finished", result: { ok: { value: [{ agent_status: { working: false } }] } } } } } },
    ];
    const scan = projectLatestWindow(responses);
    assert.equal(scan.working, false);
    assert.equal(scan.offerId, "E_1.n:user-0_1");
});

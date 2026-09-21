// Mutating routes: schedule runs, cancel, inject user input, fulfil an ask_user
// gate. These stay durable native calls (workflow schedule + `control`
// cancel/stub), unlike the read-only polling GETs.

import { jsonError, jsonResponse } from "./http.js";
import { cancelObeliskExecution, stubObeliskExecution } from "./obelisk-api.js";

const WORKFLOW_FFQN = "agent-template:workflow/workflow.run-cancellable";

let runtime;
let dynamicRuntime;

export function configureRuntime(obelisk, dynamic) {
    runtime = obelisk;
    dynamicRuntime = dynamic;
}

function scheduleSession(prompt, backend, effort) {
    const execId = runtime.executionIdGenerate();
    dynamicRuntime.schedule(execId, WORKFLOW_FFQN, [prompt, backend, effort], null);
    return execId;
}

export async function submit(request) {
    let body;
    try { body = await request.text(); }
    catch (e) { return jsonError(400, `cannot read body: ${String(e)}`); }
    let payload;
    try { payload = JSON.parse(body); }
    catch (e) { return jsonError(400, `body must be JSON: ${e.message}`); }
    const prompt = payload?.prompt;
    if (typeof prompt !== "string" || !prompt.trim()) return jsonError(400, "prompt is required");
    const backend = (typeof payload?.backend === "string" && payload.backend) ? payload.backend : null;
    const effort = (typeof payload?.effort === "string" && payload.effort) ? payload.effort : null;
    let execId;
    try { execId = scheduleSession(prompt, backend, effort); }
    catch (e) { return jsonError(502, `schedule failed: ${String(e)}`); }
    return jsonResponse({ execution_id: execId });
}

export async function createSession(request) {
    let payload = {};
    try {
        const text = await request.text();
        if (text) payload = JSON.parse(text);
    } catch (e) {
        return jsonError(400, `body must be JSON: ${e.message}`);
    }
    const backend = typeof payload.backend === "string" && payload.backend ? payload.backend : null;
    const effort = typeof payload.effort === "string" && payload.effort ? payload.effort : null;
    let execId;
    try { execId = scheduleSession("", backend, effort); }
    catch (e) { return jsonError(502, `schedule failed: ${String(e)}`); }
    return jsonResponse({ execution_id: execId });
}

export async function cancelRun(id) {
    if (!id) return jsonError(400, "missing run id");
    try { cancelObeliskExecution(id); }
    catch (e) { return jsonError(502, `cancel failed: ${String(e)}`); }
    return jsonResponse({ ok: true, cancelled: [id] });
}

// Fulfil the concrete input offer advertised by the session notification feed.
export async function submitSessionInput(request, runId) {
    if (!runId) return jsonError(400, "missing run id");
    let payload;
    try { payload = JSON.parse(await request.text()); }
    catch (e) { return jsonError(400, `body must be JSON: ${e.message}`); }
    const offerId = payload?.offer_id;
    if (typeof offerId !== "string" || !offerId.startsWith(runId + ".")) {
        return jsonError(400, "offer_id must identify an input offer for this run");
    }
    const event = normalizeSessionInput(payload?.input);
    if (!event) return jsonError(400, "input must contain a valid prompt or interrupt");
    try { stubObeliskExecution(offerId, { ok: event }); }
    catch (e) { return jsonError(502, `input fulfil failed: ${String(e)}`); }
    return jsonResponse({ child_execution_id: offerId, event_id: (event.prompt || event.interrupt).id });
}

// Stop the current turn by fulfilling the live input offer with an interrupt.
export async function interruptOffer(request, runId) {
    if (!runId) return jsonError(400, "missing run id");
    let payload;
    try { payload = JSON.parse(await request.text()); }
    catch (e) { return jsonError(400, `body must be JSON: ${e.message}`); }
    const offerId = payload?.offer_id;
    if (typeof offerId !== "string" || !offerId.startsWith(runId + ".")) {
        return jsonError(400, "offer_id must identify an input offer for this run");
    }
    const id = typeof payload?.id === "string" && payload.id ? payload.id : `interrupt-${Date.now()}`;
    try { stubObeliskExecution(offerId, { ok: { interrupt: { id } } }); }
    catch (e) { return jsonError(502, `interrupt failed: ${String(e)}`); }
    return jsonResponse({ child_execution_id: offerId });
}

function normalizeSessionInput(input) {
    if (!input || typeof input !== "object") return null;
    if (input.prompt) {
        const { id, text } = input.prompt;
        if (typeof id !== "string" || !id || typeof text !== "string" || !text.trim()) return null;
        return { prompt: { id, text: text.trim() } };
    }
    if (input.interrupt) {
        const { id } = input.interrupt;
        if (typeof id !== "string" || !id) return null;
        return { interrupt: { id } };
    }
    return null;
}

// Answer an ask_user gate: the workflow's ask-user stub child awaits a string.
export async function answerStub(request, childId) {
    if (!childId) return jsonError(400, "missing child id");
    let body;
    try { body = await request.text(); }
    catch (e) { return jsonError(400, `cannot read body: ${String(e)}`); }
    let payload;
    try { payload = JSON.parse(body); }
    catch (e) { return jsonError(400, `body must be JSON: ${e.message}`); }
    const answer = payload?.answer;
    if (typeof answer !== "string" || !answer) return jsonError(400, "answer is required");
    try { stubObeliskExecution(childId, { ok: answer }); }
    catch (e) { return jsonError(502, `stub fulfil failed: ${String(e)}`); }
    return jsonResponse({ ok: true });
}

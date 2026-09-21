// Web UI for the agent template.
//
// Server side: a small JSON API plus one static HTML shell that boots the SPA.
//   GET  /                        static shell (HTML + inline JS)
//   GET  /api/models              LLM catalog for the model dropdown
//   GET  /api/runs                run list (sidebar)
//   GET  /api/runs/:id            one run, normalised into a transcript
//   GET  /api/logs/:id            logs from the run and its derived executions
//   POST /api/submit              body: {prompt, backend?, effort?} -> {execution_id}
//   POST /api/sessions            create an empty session
//   POST /api/input/:runId        body: {offer_id, input} -> injected event
//   POST /api/interrupt/:runId    body: {offer_id} -> stop the current turn
//   POST /api/cancel/:runId       cancel the run
//   POST /api/answer/:childId     body: {answer} -> fulfil an ask_user gate
//
// The SPA polls the run list and the open run, switching to a short poll while
// the agent is working. This entry is the HTTP router only; server logic lives
// in ./lib/*, the served page in ./ui/shell.js.

import { jsonError, jsonResponse, nonNegativeInteger, parseQuery } from "./lib/http.js";
import * as obelisk from "obelisk:webhook@1.0.0";
import * as dynamic from "obelisk:webhook-dynamic@1.0.0";
import { loadModels } from "./lib/models.js";
import { detailRun, listRuns, loadExecutionTreeLogs } from "./lib/runs.js";
import {
    answerStub,
    cancelRun,
    createSession,
    interruptOffer,
    submitSessionInput,
    submit,
    configureRuntime,
} from "./lib/mutations.js";
import { htmlShell } from "./ui/shell.js";

configureRuntime(obelisk, dynamic);

export default async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
        const query = parseQuery(request.url);
        if (method === "GET" && path === "/") return htmlShell();
        if (method === "GET" && path === "/api/models") return jsonResponse(loadModels());
        if (method === "GET" && path === "/api/runs") return jsonResponse(await listRuns());
        if (method === "GET" && path.startsWith("/api/runs/")) {
            const id = decodeURIComponent(path.substring("/api/runs/".length));
            if (!id) return jsonError(400, "missing run id");
            return jsonResponse(await detailRun(id, {
                workflowId: query.workflow_id || "",
                responseCursor: nonNegativeInteger(query.response_cursor),
            }));
        }
        if (method === "GET" && path.startsWith("/api/logs/")) {
            const id = decodeURIComponent(path.substring("/api/logs/".length));
            if (!id) return jsonError(400, "missing run id");
            return jsonResponse(await loadExecutionTreeLogs(id, query.cursor || ""));
        }
        if (method === "POST" && path === "/api/submit") return await submit(request);
        if (method === "POST" && path === "/api/sessions") return await createSession(request);
        if (method === "POST" && path.startsWith("/api/cancel/")) {
            return await cancelRun(decodeURIComponent(path.substring("/api/cancel/".length)));
        }
        if (method === "POST" && path.startsWith("/api/input/")) {
            return await submitSessionInput(request, decodeURIComponent(path.substring("/api/input/".length)));
        }
        if (method === "POST" && path.startsWith("/api/interrupt/")) {
            return await interruptOffer(request, decodeURIComponent(path.substring("/api/interrupt/".length)));
        }
        if (method === "POST" && path.startsWith("/api/answer/")) {
            return await answerStub(request, decodeURIComponent(path.substring("/api/answer/".length)));
        }
    } catch (e) {
        return jsonError(500, String(e));
    }
    return jsonError(404, "not found");
}

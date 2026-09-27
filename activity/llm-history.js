const PAGE_SIZE = 200;

export async function loadMessages(historyIds, deltaJson, fetchJson) {
    const delta = parseMessages(deltaJson, "delta-json");
    if (historyIds.length === 0) return delta;

    const entries = await readLlmBatch(historyIds, fetchJson);

    const messages = [];
    for (const entry of entries) {
        messages.push(...entry.delta);
        messages.push({ role: "assistant", content: entry.content });
    }
    messages.push(...delta);
    return messages;
}

async function readLlmBatch(ids, fetchJson) {
    try {
        const response = await fetchJson("/v1/executions/events/batch", { execution_ids: ids });
        if (!Array.isArray(response)) throw "Obelisk batch history response must be an array";
        if (response.length !== ids.length) throw "Obelisk batch history response has the wrong length";
        return response.map((row, index) => {
            if (row.execution_id !== ids[index]) throw `Obelisk batch history response is out of order at ${index}`;
            return parseLlmExecution(row.execution_id, row.created?.event?.created, row.finished?.event?.finished);
        });
    } catch (e) {
        if (e?.status !== 400 && e?.status !== 404) throw e;
        const rows = [];
        for (let offset = 0; offset < ids.length; offset += 16) {
            rows.push(...await Promise.all(ids.slice(offset, offset + 16).map((id) => readLlmExecution(id, fetchJson))));
        }
        return rows;
    }
}

async function readLlmExecution(id, fetchJson) {
    let version = 0;
    let created = null;
    let finished = null;
    while (finished === null) {
        const page = await fetchJson(`/v1/executions/${encodeURIComponent(id)}/events?version=${version}&direction=newer&including_cursor=true&length=${PAGE_SIZE}`);
        const events = page?.events;
        if (!Array.isArray(events) || events.length === 0) break;
        for (const row of events) {
            if (row?.event?.created) created = row.event.created;
            if (row?.event?.finished) finished = row.event.finished;
        }
        version = events[events.length - 1].version + 1;
        if (version > page.max_version) break;
    }
    return parseLlmExecution(id, created, finished);
}

function parseLlmExecution(id, created, finished) {
    if (!created || !finished) throw `LLM history execution ${id} has no Created or Finished event`;
    const params = created.params;
    const reply = finished.retval?.ok?.value?.reply;
    if (!Array.isArray(params) || params.length < 2 || !reply) throw `LLM history execution ${id} has no accepted reply`;
    return {
        delta: parseMessages(params[1], `delta of ${id}`),
        content: parseMessages(reply.content_json, `reply of ${id}`),
    };
}

function parseMessages(json, label) {
    let value;
    try { value = JSON.parse(json); }
    catch (e) { throw `${label} is not valid JSON: ${String(e)}`; }
    if (!Array.isArray(value)) throw `${label} must be an array`;
    return value;
}

export function obeliskApi() {
    const base = process.env["OBELISK_API_URL"] || "http://127.0.0.1:5005";
    const token = process.env["OBELISK_API_TOKEN"];
    if (!token) throw "OBELISK_API_TOKEN is required for LLM history";
    return async (path, body) => {
        const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
            method: body ? "POST" : "GET",
            headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) throw Object.assign(new Error(`Obelisk history ${path}: HTTP ${response.status}`), { status: response.status });
        return response.json();
    };
}

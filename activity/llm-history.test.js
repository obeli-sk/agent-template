import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMessages } from "./llm-history.js";

const msg = (text) => ({ role: "user", content: [{ type: "text", text }] });
const reply = (text) => [{ type: "text", text }];

function child(delta, content) {
    return { events: [
        { version: 0, event: { created: { params: ["system", JSON.stringify(delta), "[]", "model", "", []] } } },
        { version: 2, event: { finished: { retval: { ok: { value: { reply: { content_json: JSON.stringify(content) } } } } } } },
    ], max_version: 2 };
}

test("reconstructs only accepted calls with one batch request", async () => {
    const calls = [];
    const pages = new Map([
        ["a", child([msg("first")], reply("one"))],
        ["b", child([msg("second")], reply("two"))],
    ]);
    const fetchJson = async (path, body) => {
        calls.push({ path, body });
        return body.execution_ids.map((id) => {
            const page = pages.get(id);
            return { execution_id: id, created: page.events[0], finished: page.events[1] };
        });
    };

    const messages = await loadMessages(["a", "b"], JSON.stringify([msg("third")]), fetchJson);
    assert.deepEqual(messages, [
        msg("first"), { role: "assistant", content: reply("one") },
        msg("second"), { role: "assistant", content: reply("two") },
        msg("third"),
    ]);
    assert.deepEqual(calls, [{ path: "/v1/executions/events/batch", body: { execution_ids: ["a", "b"] } }]);
});

test("falls back to parallel child events when the batch endpoint is unavailable", async () => {
    const paths = [];
    const fetchJson = async (path, body) => {
        if (body) throw Object.assign(new Error("not found"), { status: 404 });
        paths.push(path);
        const id = path.split("/")[3];
        return child([msg(id)], reply(id));
    };
    const messages = await loadMessages(["a", "b"], "[]", fetchJson);
    assert.deepEqual(messages, [
        msg("a"), { role: "assistant", content: reply("a") },
        msg("b"), { role: "assistant", content: reply("b") },
    ]);
    assert.equal(paths.length, 2);
});

test("first call uses only its delta", async () => {
    const messages = await loadMessages([], JSON.stringify([msg("hello")]), () => {
        throw new Error("unexpected fetch");
    });
    assert.deepEqual(messages, [msg("hello")]);
});

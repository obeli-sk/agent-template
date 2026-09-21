import { test } from "node:test";
import assert from "node:assert/strict";
import completion from "./llm-chat-mock.js";

const TOOLS = JSON.stringify([{ name: "ask_user" }, { name: "fetch_url" }]);

function blocks(res) { return JSON.parse(res.reply.content_json); }

test("step 1: a fresh prompt yields a fetch_url tool call", async () => {
    const messages = JSON.stringify([{ role: "user", content: [{ type: "text", text: "fetch it" }] }]);
    const res = await completion("", messages, TOOLS, "mock", "");
    assert.equal(res.reply.stop_reason, "tool_use");
    const call = blocks(res).find((b) => b.type === "tool_use");
    assert.equal(call.name, "fetch_url");
    assert.equal(call.input.url, "https://obeli.sk/");
});

test("step 2: a tool result yields a final answer citing the status", async () => {
    const messages = JSON.stringify([
        { role: "user", content: [{ type: "text", text: "fetch it" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "mock_call_1", name: "fetch_url", input: { url: "https://obeli.sk/" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "mock_call_1", content: JSON.stringify({ status: 200 }), is_error: false }] },
    ]);
    const res = await completion("", messages, TOOLS, "mock", "");
    assert.equal(res.reply.stop_reason, "end_turn");
    const text = blocks(res).map((b) => b.text).join("");
    assert.match(text, /HTTP 200/);
});

test("each new turn scripts a fresh tool call, not just the first", async () => {
    const messages = JSON.stringify([
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "mock_call_1", name: "fetch_url", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "mock_call_1", content: "{\"status\":200}", is_error: false }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
        { role: "user", content: [{ type: "text", text: "again" }] },
    ]);
    const res = await completion("", messages, TOOLS, "mock", "");
    assert.equal(res.reply.stop_reason, "tool_use");
});

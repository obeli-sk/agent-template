import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ASK_USER_TOOL,
    buildToolsJson,
    hasUserVisibleText,
    renderSystemPrompt,
    toolError,
    toolOk,
    toolResultMessageValue,
    userText,
    MAX_TOOL_RESULT_BYTES,
} from "./session-logic.js";

test("buildToolsJson always leads with ask_user and expands schema_json", () => {
    const tools = [{ name: "fetch_url", ffqn: "a:b/c.d", description: "get a url", schema_json: '{"type":"object","properties":{"url":{"type":"string"}}}' }];
    const specs = JSON.parse(buildToolsJson(tools));
    assert.equal(specs[0].name, "ask_user");
    assert.deepEqual(specs[0].input_schema, ASK_USER_TOOL.input_schema);
    assert.equal(specs[1].name, "fetch_url");
    assert.deepEqual(specs[1].input_schema, { type: "object", properties: { url: { type: "string" } } });
});

test("buildToolsJson tolerates a missing or invalid schema", () => {
    const specs = JSON.parse(buildToolsJson([{ name: "x", ffqn: "a:b/c.d", description: "", schema_json: "not json" }]));
    assert.deepEqual(specs[1].input_schema, { type: "object", properties: {} });
});

test("renderSystemPrompt lists ask_user and each configured tool", () => {
    const prompt = renderSystemPrompt("BASE", [{ name: "fetch_url", description: "get a url" }]);
    assert.match(prompt, /^BASE/);
    assert.match(prompt, /# Tools/);
    assert.match(prompt, /- `ask_user`:/);
    assert.match(prompt, /- `fetch_url`: get a url/);
});

test("toolOk carries the result text and toolResultMessageValue wraps it", () => {
    const ok = toolOk("id1", '{"status":200}');
    assert.deepEqual(ok, { tool_use_id: "id1", ok: true, result: '{"status":200}' });
    assert.deepEqual(toolResultMessageValue(ok), {
        type: "tool_result", tool_use_id: "id1", content: '{"status":200}', is_error: false,
    });
});

test("toolOk rejects an oversized result", () => {
    const big = "x".repeat(MAX_TOOL_RESULT_BYTES + 10);
    const block = toolOk("id2", big);
    assert.equal(block.ok, false);
    assert.match(block.message, /too large/);
});

test("toolError becomes an is_error tool_result", () => {
    assert.deepEqual(toolResultMessageValue(toolError("id3", "boom")), {
        type: "tool_result", tool_use_id: "id3", content: "Error: boom", is_error: true,
    });
});

test("userText and hasUserVisibleText round-trip", () => {
    assert.deepEqual(userText("hi"), { role: "user", content: [{ type: "text", text: "hi" }] });
    assert.equal(hasUserVisibleText([{ type: "text", text: " " }]), false);
    assert.equal(hasUserVisibleText([{ type: "text", text: "x" }]), true);
    assert.equal(hasUserVisibleText([{ type: "tool_use", id: "1", name: "x", input: {} }]), false);
});

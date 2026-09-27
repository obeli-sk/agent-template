import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { htmlShell } from "./shell.js";

test("tool cards pair results by turn and step when call IDs repeat", async () => {
    const html = await htmlShell().text();
    const script = html.split("<script>")[1].split("</script>")[0].split('el("send").onclick')[0];
    const browser = {};
    vm.runInNewContext(script, browser);
    const transcript = {
        user_messages: [],
        replies: [
            { turn_index: 0, step: 1, reply: { tool_calls: [{ id: "same", name: "fetch_url", args: { url: "https://example.com" } }] } },
            { turn_index: 1, step: 1, reply: { tool_calls: [{ id: "same", name: "fetch_url", args: { url: "https://obeli.sk" } }] } },
        ],
        sent_results: [
            { turn_index: 0, step: 1, id: "same", err: "denied" },
            { turn_index: 1, step: 1, id: "same", ok: '{"status":200}' },
        ],
    };
    const rendered = browser.renderTimeline(transcript);
    assert.match(rendered, /example\.com[\s\S]*denied[\s\S]*obeli\.sk[\s\S]*200/);
});

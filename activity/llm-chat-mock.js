// agent-template:llm/chat.completion (MOCK)
//
// A deterministic stand-in for activity/llm-chat.js: same interface, but instead
// of calling a provider it scripts one turn so the whole loop can be
// demonstrated with no LLM endpoint or key (see deployment.mock.toml). It reads
// the conversation state the workflow passes in and replies in the same
// provider-neutral shape the real client returns:
//
//   turn step 1 (a fresh user prompt, no tool result yet):
//     -> text + a `fetch_url` tool_use  (stop_reason "tool_use")
//   turn step 2 (the tool result is now in the history):
//     -> a final text answer citing the fetched HTTP status (stop_reason "end_turn")
//
// The tool call is real: the workflow dispatches it to the fetch_url activity,
// which actually GETs the URL; only the "model" is scripted. Swap
// deployment.mock.toml back to deployment.toml (the real llm-chat.js) for a live
// model.

const DEMO_URL = "https://obeli.sk/";

export default async function completion(system, messagesJson, toolsJson, model, effort) {
    void system;
    void model;
    void effort;
    const messages = parseJson(messagesJson, "messages-json", []);
    const tools = parseJson(toolsJson, "tools-json", []);
    const hasFetchUrl = tools.some((t) => t && t.name === "fetch_url");

    const result = latestToolResult(messages);
    if (result) {
        const status = statusFrom(result);
        const text = status !== null
            ? `Done. Fetching ${DEMO_URL} returned HTTP ${status}. (This reply came from the mock LLM in deployment.mock.toml.)`
            : `Done. The fetch_url tool returned: ${clip(result.content, 200)} (mock LLM.)`;
        return reply([{ type: "text", text }], "end_turn");
    }

    if (!hasFetchUrl) {
        // No fetch_url configured (TOOLS_JSON overridden): still end cleanly.
        return reply([{ type: "text", text: "Hello from the mock LLM. No fetch_url tool is configured, so there is nothing to demonstrate." }], "end_turn");
    }

    return reply(
        [
            { type: "text", text: `I'll fetch ${DEMO_URL} to demonstrate a tool call.` },
            { type: "tool_use", id: "mock_call_1", name: "fetch_url", input: { url: DEMO_URL } },
        ],
        "tool_use",
    );
}

function reply(blocks, stopReason) {
    return { reply: { content_json: JSON.stringify(blocks), stop_reason: stopReason } };
}

// The tool_result block belonging to the current turn: scan from the last real
// user prompt (a user message with text) forward for a tool_result. Scoping to
// the current turn means every fresh prompt scripts a new tool call, not just
// the first one in the session.
function latestToolResult(messages) {
    let start = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.role === "user" && blocks(msg, "text").length > 0) { start = i; break; }
    }
    for (let i = start; i < messages.length; i++) {
        const found = blocks(messages[i], "tool_result").find((b) => b.tool_use_id === "mock_call_1") || blocks(messages[i], "tool_result")[0];
        if (found) return found;
    }
    return null;
}

function statusFrom(toolResult) {
    if (toolResult.is_error) return null;
    try {
        const parsed = JSON.parse(toolResult.content);
        return Number.isInteger(parsed.status) ? parsed.status : null;
    } catch {
        return null;
    }
}

function blocks(msg, type) {
    return Array.isArray(msg?.content) ? msg.content.filter((b) => b && b.type === type) : [];
}

function clip(text, max) {
    const s = String(text ?? "");
    return s.length > max ? s.slice(0, max) + "..." : s;
}

function parseJson(text, label, fallback) {
    if (!text) return fallback;
    try { return JSON.parse(text); }
    catch (e) { throw `${label} is not valid JSON: ${String(e)}`; }
}

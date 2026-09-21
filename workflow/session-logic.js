// Pure helpers for session.js: no `obelisk` global, no host-provided WIT
// imports, so this module is importable and unit-testable with plain
// `node --test` (see session-logic.test.js). session.js itself can only be
// exercised by deploying it, so keep every bit of logic that can live here.

export const MAX_TOOL_RESULT_BYTES = 96 * 1024;
export const STEP_WARNING_FRACTION = 3;

export const EMPTY_REPLY_NUDGE =
    "Your previous reply had no message content. Reply to the user in Markdown, or call a tool to keep working.";

// The one built-in, non-HTTP tool: a human-in-the-loop gate backed by the stub
// mechanism (session.js intercepts it and drives the `ask-user` stub). Always
// offered to the model alongside the operator-configured tools.
export const ASK_USER_TOOL = {
    name: "ask_user",
    description:
        "Ask the human operator a question and wait for their answer before continuing. "
        + "Use only when you cannot proceed without input; to end your turn instead, reply in Markdown.",
    input_schema: {
        type: "object",
        properties: { question: { type: "string", description: "The question to show the user." } },
        required: ["question"],
    },
};

// Build the provider-neutral tools-json the LLM activity expects, from the
// operator-configured tool registry (config.tools: each { name, ffqn,
// description, schema_json }) plus the built-in ask_user tool.
export function buildToolsJson(tools) {
    const specs = [ASK_USER_TOOL];
    for (const tool of tools ?? []) {
        specs.push({
            name: tool.name,
            description: tool.description || "",
            input_schema: parseSchema(tool.schema_json),
        });
    }
    return JSON.stringify(specs);
}

function parseSchema(schemaJson) {
    if (typeof schemaJson !== "string" || !schemaJson.trim()) return { type: "object", properties: {} };
    try {
        const schema = JSON.parse(schemaJson);
        return schema && typeof schema === "object" && !Array.isArray(schema) ? schema : { type: "object", properties: {} };
    } catch {
        return { type: "object", properties: {} };
    }
}

// The system prompt = the operator's base prompt plus a rendered tool list, so
// the model always sees the exact tools it can call.
export function renderSystemPrompt(base, tools) {
    return `${base}\n\n# Tools\n\n${renderToolHelp(tools)}`;
}

export function renderToolHelp(tools) {
    let text = "- `ask_user`: ask the human operator a question and block for their answer.\n";
    for (const tool of tools ?? []) {
        text += tool.description ? `- \`${tool.name}\`: ${tool.description}\n` : `- \`${tool.name}\`\n`;
    }
    return text;
}

export function userText(text) {
    return { role: "user", content: [{ type: "text", text }] };
}

export function hasUserVisibleText(content) {
    return content.some((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "");
}

// A tool's result is JSON text (the tool activity's return value, or ask_user's
// answer). Cap the encoded size so a runaway response can't poison the history.
export function toolOk(id, resultText) {
    const text = typeof resultText === "string" ? resultText : JSON.stringify(resultText);
    if (JSON.stringify(text).length > MAX_TOOL_RESULT_BYTES) {
        return toolError(id, `result too large (~${JSON.stringify(text).length} encoded bytes); narrow the request`);
    }
    return { tool_use_id: id, ok: true, result: text };
}

export function toolError(id, message) {
    return { tool_use_id: id, ok: false, message };
}

// The user-role message block that carries a tool result back to the model.
export function toolResultMessageValue(block) {
    if (block.ok) {
        return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.result, is_error: false };
    }
    return { type: "tool_result", tool_use_id: block.tool_use_id, content: `Error: ${block.message}`, is_error: true };
}

export function elapsedMilliseconds(start, end) {
    return Math.max(0, end - start);
}

export function shortWarningId(warning) {
    return warning.replace(/[^A-Za-z0-9]/g, "").slice(0, 24).toLowerCase();
}

// ----- turn-ending agent-error events -----

export function stepLimitError(turnIndex, maxSteps) {
    return {
        id: `step-limit-${turnIndex}`,
        text: `exceeded MAX_STEPS=${maxSteps} without yielding an assistant response. The turn ended mid-task; re-derive position from the transcript, then finish or report. Budget resets to ${maxSteps} steps for the next turn (say "continue" to resume).`,
        turn_index: turnIndex,
    };
}

export function stepWarningThreshold(maxSteps) {
    return Math.floor(maxSteps / 4) * STEP_WARNING_FRACTION;
}

export function stepWarningText(maxSteps) {
    return `Step budget warning: you have used about ${stepWarningThreshold(maxSteps)} of ${maxSteps} allowed model invocations this turn. Stop open-ended exploration now, finish the current task with as few further tool calls as possible, and end the turn with a short Markdown summary so the next turn can continue from your report.`;
}

export function llmErrorEvent(turnIndex, message) {
    return { id: `llm-error-${turnIndex}`, text: message, turn_index: turnIndex };
}

export function interruptedError(turnIndex) {
    return {
        id: `interrupted-${turnIndex}`,
        text: 'Turn stopped by user request. The turn ended mid-task; re-derive position from the transcript, then finish or report (say "continue" to resume).',
        turn_index: turnIndex,
    };
}

export function emptyReplyError(turnIndex) {
    return { id: `empty-reply-${turnIndex}`, text: "model returned an empty response again; ending the turn", turn_index: turnIndex };
}

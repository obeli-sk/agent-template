// agent-template:config/config.discover:
//   func(execution-id: string, backend: string, effort: string)
//     -> result<record {
//          max-steps: u32,
//          tools: list<record { name, ffqn, description, schema-json }>,
//          system-prompt: string
//        }, string>
//
// Read once at session start, so operator config (the tool registry, the step
// budget, the base prompt) changes take effect on the next session without
// rebuilding the workflow. Adding a tool is a deployment edit: write its
// activity, then append a TOOLS_JSON entry pointing at its FFQN.

const DEFAULT_MAX_STEPS = 10;

const DEFAULT_SYSTEM_PROMPT =
    "You are a helpful assistant running as a durable Obelisk workflow. " +
    "You keep working across tool calls until the user's request is resolved, " +
    "then reply to the user in Markdown to end your turn. Use the provided tools " +
    "when they help; do not guess at information you can fetch.";

export default async function discover(executionId, backend, effort) {
    void executionId;
    void backend;
    void effort;
    return {
        max_steps: parseMaxSteps(process.env["MAX_STEPS"]),
        tools: parseTools(process.env["TOOLS_JSON"]),
        system_prompt: (process.env["SYSTEM_PROMPT"] ?? "").trim() || DEFAULT_SYSTEM_PROMPT,
    };
}

function parseMaxSteps(raw) {
    if (!raw || !raw.trim()) return DEFAULT_MAX_STEPS;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
        throw "MAX_STEPS must be an integer between 1 and 4294967295";
    }
    return value;
}

// TOOLS_JSON is a JSON array of { name, ffqn, description, schema } where
// `schema` is a JSON Schema object; it is serialized to `schema_json` for the
// WIT record. Empty/unset means the model gets only the built-in ask_user tool.
function parseTools(raw) {
    if (!raw || !raw.trim()) return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw `TOOLS_JSON is not valid JSON: ${error}`;
    }
    if (!Array.isArray(parsed)) throw "TOOLS_JSON must be a JSON array";
    return parsed.map((entry, index) => parseTool(entry, index));
}

function parseTool(entry, index) {
    const name = entry?.name;
    const ffqn = entry?.ffqn;
    const description = entry?.description ?? "";
    if (typeof name !== "string" || !name) throw `TOOLS_JSON[${index}] has no name`;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw `TOOLS_JSON[${index}] name must be [A-Za-z0-9_-]`;
    if (name === "ask_user") throw `TOOLS_JSON[${index}] name "ask_user" is reserved`;
    if (typeof ffqn !== "string" || !ffqn) throw `TOOLS_JSON[${index}] has no ffqn`;
    if (typeof description !== "string") throw `TOOLS_JSON[${index}] description must be a string`;
    const schema = entry?.schema ?? { type: "object", properties: {} };
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
        throw `TOOLS_JSON[${index}] schema must be a JSON object`;
    }
    return { name, ffqn, description, schema_json: JSON.stringify(schema) };
}

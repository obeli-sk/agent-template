// The tool activities this workflow is linked against, keyed by FFQN.
//
// Tool dispatch goes through a static ES module import per tool, not a
// runtime-selected `dynamic.call`: Obelisk verifies these imports when the
// deployment starts, so a typo or a missing activity fails at deploy time
// instead of mid-turn. TOOLS_JSON still decides which of them the model is
// offered, with what description and schema.
//
// Adding a tool: write the activity, add its `[[activity_js]]` block to the
// deployment, import it here, and register its FFQN in TOOLS_JSON.

import { fetchUrl } from "agent-template:tools/http";

export const TOOL_IMPLS = new Map([
    ["agent-template:tools/http.fetch-url", fetchUrl],
]);

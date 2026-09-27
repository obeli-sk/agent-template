default: serve

# Run the agent. Requires AGENT_MODELS + LLM_BASE_URL in the environment
# (see .envrc-example / the README). JS components need no build step.
serve:
  obelisk server run -d deployment.toml --server-config server.toml --app-config app.toml

# Run with a scripted mock LLM: watch the whole loop drive a turn (a fetch_url
# tool call + its real result + a final answer) with NO LLM endpoint, key, or
# catalog. Only OBELISK_API_TOKEN need be set. See activity/llm-chat-mock.js.
serve-mock:
  obelisk server run -d deployment.mock.toml --server-config server.toml --app-config app.mock.toml

# Compile, link and policy-check both deployments; needs OBELISK_API_TOKEN and AGENT_MODELS.
verify:
  obelisk server verify --server-config server.toml --app-config app.toml -d deployment.toml
  obelisk server verify --server-config server.toml --app-config app.mock.toml -d deployment.mock.toml

# Unit tests: pure logic, runnable offline (no Obelisk, no network).
test:
  node --test workflow/session-logic.test.js
  node --test shared/session-state.test.js
  node --test activity/fetch-url.test.js
  node --test activity/llm-chat-mock.test.js
  node --test webhook/ui/shell.test.js

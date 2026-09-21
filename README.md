# agent-template

> [!NOTE]
> **Preview / template.** A minimal starting point for building an agent on
> [Obelisk](https://obeli.sk). Copy it, add your own tools, and change the prompt.

A durable Obelisk workflow that *is* an agent loop, written entirely in
JavaScript (no build step). It holds a provider-neutral chat history, calls an
LLM, dispatches the tools the model asks for, and stays live between turns on a
user-input offer. Two tools ship as examples:

- **`fetch_url`** — a GET-only HTTP tool (an activity). The template's example of
  the generic tool contract: one activity, a JSON object in, a JSON object out.
- **`ask_user`** — a human-in-the-loop gate. Not an HTTP tool: the workflow
  intercepts it and drives the `ask-user` stub, publishing the question to the UI
  and blocking until you answer.

It is a stripped-down sibling of `apps/workflow-agent` (which adds a whole bash
VFS, MCP, GitHub mounts, peer sessions, and deployment editing). Everything here
is the essential skeleton: the durable loop, the stub/notification protocol, the
multi-provider LLM client, and a polling web UI.

## Architecture

```
webhook (webhook/ui-api.js) ── HTTP ──> browser SPA (webhook/ui/shell.js)
      │  schedule / cancel / inject input / answer
      ▼
workflow  (workflow/session.js)  ── the agent loop, one durable execution/session
      │        │                    self-stubs session-events ──> UI polls them
      │        └── ask_user ──> stub (ask-user)  ── human-in-the-loop
      ├── llm.completion   (activity/llm-chat.js)     ── the model
      └── tool dispatch    (activity/fetch-url.js, ...) ── your HTTP tools
config.discover (activity/config-discover.js)          ── tools + prompt + budget
```

The contract between all of these is the WIT in `wit/`. The notification
protocol — the `session-event` stream the workflow publishes and the
`session-input` the UI injects — is defined in
[`wit/deps/agent-template_stub/stub.wit`](wit/deps/agent-template_stub/stub.wit),
the source of truth for both sides.

## Run

JS components need no build. Provide an LLM catalog + endpoint, then serve:

```sh
export OBELISK_API_TOKEN=$(obelisk generate token)
export AGENT_MODELS="$(cat models.local.json)"   # pick a catalog
export LLM_BASE_URL=http://127.0.0.1:9190         # match the catalog's endpoint
just serve                                        # obelisk server run -d deployment.toml
```

`nix develop` (or direnv via `.envrc-example`) provides the pinned Obelisk and
Node. Then open <http://localhost:9090> (the webhook listener), start a
conversation, and watch the model call `fetch_url`; trigger `ask_user` and answer
it inline; use Stop to interrupt a turn or Cancel to end the run.

### Try it with no LLM (`just serve-mock`)

To see the whole loop drive a turn without any LLM setup, run the mock
deployment:

```sh
export OBELISK_API_TOKEN=$(obelisk generate token)
just serve-mock            # deployment.mock.toml + server.mock.toml
```

It swaps only the LLM client for a scripted stand-in
([`activity/llm-chat-mock.js`](activity/llm-chat-mock.js)) that replies with a
`fetch_url` tool call, then, once the real durable tool result comes back, a
final answer citing the fetched HTTP status. No LLM endpoint, key, or catalog is
needed — just `OBELISK_API_TOKEN`. Submit any prompt at
<http://localhost:9090> and watch the tool call and final answer appear. This is
the fastest way to see the architecture end to end, and it documents the
`llm/chat.completion` contract by example.

## LLM endpoint

One endpoint serves the whole catalog: the JSON catalog `AGENT_MODELS`
(required), the origin `LLM_BASE_URL`, and an optional bearer `LLM_API_KEY`. Each
catalog entry is `{ id, label, api_type, path?, wire_model, max_tokens? }`, where
`api_type` is `anthropic-messages`, `openai-chat-completions`, or
`openai-responses`. Two catalogs ship:

- `models.local.json` (keyless): a local OpenAI-compatible backend on `:9190`,
  e.g. [`agent-backed-llm-server`](https://github.com/obeli-sk/agent-backed-llm-server).
- `models.openrouter.json` (`LLM_API_KEY`): [OpenRouter](https://openrouter.ai).

Any OpenAI/Anthropic-compatible endpoint (vLLM, Ollama, the provider directly)
works: point `LLM_BASE_URL` at it and add catalog entries.

## Adding a tool

No workflow rebuild. Two edits:

1. **Write the activity.** Use the `fetch_url` contract: a default export
   `run(args-json: string) -> result<string, string>` that parses the model's
   tool input from `args-json` and returns its result as JSON text. Copy
   [`activity/fetch-url.js`](activity/fetch-url.js) as a starting point.
2. **Register it.** Add an `[[activity_js]]` block in
   [`deployment.toml`](deployment.toml) (its own FFQN, `params`/`return_type`,
   and any `allowed_host` grants), then append an entry to the `TOOLS_JSON`
   default (or set the `TOOLS_JSON` env var):

   ```json
   { "name": "my_tool", "ffqn": "agent-template:tools/http.my-tool",
     "description": "what it does", "schema": { "type": "object", "properties": { ... } } }
   ```

The workflow reads `TOOLS_JSON` at session start, offers each tool to the model
alongside `ask_user`, and dispatches a `tool_use` by calling the matching FFQN
with the input serialized as its single argument. The `schema` is the JSON Schema
the model sees for the tool's input.

Network reach is exactly what the tool's `allowed_host` grants (and its mirror in
`server.toml`). `fetch_url` defaults to `https://obeli.sk` only; widen
`FETCH_ALLOWED_HOST` or add grants for the hosts your agent should reach.

## Configuration

Everything is an env var with a default in `deployment.toml`:

| Var | Default | Meaning |
|-----|---------|---------|
| `AGENT_MODELS` | (required) | LLM catalog JSON |
| `LLM_BASE_URL` | `http://127.0.0.1:9190` | LLM endpoint origin |
| `LLM_API_KEY` | (unset) | LLM bearer, keyless if unset |
| `MAX_STEPS` | `10` | model invocations per turn |
| `TOOLS_JSON` | `[fetch_url]` | model-facing tool registry |
| `SYSTEM_PROMPT` | built-in | base system prompt |
| `FETCH_ALLOWED_HOST` | `https://obeli.sk` | fetch_url's allowed host |
| `OBELISK_API_URL` | `http://127.0.0.1:5005` | the agent's own instance (UI + control) |

## Tests

`just test` runs the offline unit suites (`node --test`): the pure loop helpers
(`workflow/session-logic.test.js`), the UI state projection
(`shared/session-state.test.js`), and the `fetch_url` tool
(`activity/fetch-url.test.js`). `just verify` compiles and links the whole
deployment against the WIT without a running server.

## License

MIT (`LICENSE`).

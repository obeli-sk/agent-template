// Dummy page served only by deployment.mock.toml: the mock LLM's fetch_url
// target, so the demo and e2e need no outbound network.

export default function handle() {
    return new Response("<!doctype html><title>agent-template demo</title><p>Hello from the mock demo page.</p>\n", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

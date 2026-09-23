// agent-template:tools/http.fetch-url:
//   func(args-json: string) -> result<string, string>
//
// A model-facing HTTP GET tool. `args-json` is the tool_use input the workflow
// hands over verbatim: { url: string, headers?: object }. It returns JSON text
// { status, headers, body, truncated } (the shape the model reads back). The
// deployment's allowed_host grant is the security boundary: only granted hosts
// (and methods; GET only here) leave the sandbox, redirects included.
//
// This is the template's example of the generic tool contract every HTTP tool
// follows: one activity, one JSON object in, one JSON object out. Copy it,
// change the fetch, import the new activity in workflow/tools.js, and register
// it in TOOLS_JSON.

const MAX_REDIRECTS = 10;
const DEFAULT_MAX_BYTES = 64 * 1024;

export default async function fetchUrl(argsJson) {
    let args;
    try {
        args = JSON.parse(argsJson || "{}");
    } catch (e) {
        throw `args must be valid JSON: ${e.message}`;
    }
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url) throw "url is required";

    let target;
    try {
        target = parseUrl(url);
    } catch (e) {
        throw `invalid url: ${message(e)}`;
    }

    const headers = normalizeHeaders(args.headers);
    const maxBytes = Number.isFinite(args.max_bytes) && args.max_bytes > 0
        ? Math.min(Math.trunc(args.max_bytes), 1024 * 1024)
        : DEFAULT_MAX_BYTES;

    let redirects = 0;
    while (true) {
        let response;
        try {
            // No AbortSignal: the activity runtime has no real timer to fire it,
            // and the deployment's exec.lock_expiry is the durable timeout that
            // actually bounds this call. (workflow-agent's curl.js is the same.)
            response = await fetch(target.href, { method: "GET", headers, redirect: "manual" });
        } catch (e) {
            throw `request failed: ${message(e)}`;
        }

        if (isRedirect(response.status)) {
            const location = response.headers.get("location");
            if (!location) throw `redirect ${response.status} without a Location header`;
            if (redirects++ >= MAX_REDIRECTS) throw `too many redirects (> ${MAX_REDIRECTS})`;
            void response.body?.cancel();
            try {
                target = parseUrl(new URL(location, target).href);
            } catch (e) {
                throw `invalid redirect target: ${message(e)}`;
            }
            continue;
        }

        const raw = await response.text();
        const truncated = byteLength(raw) > maxBytes;
        return JSON.stringify({
            status: response.status,
            headers: headerObject(response),
            body: truncated ? truncateToBytes(raw, maxBytes) : raw,
            truncated,
        });
    }
}

function normalizeHeaders(input) {
    const headers = { accept: "*/*" };
    if (input && typeof input === "object" && !Array.isArray(input)) {
        for (const [key, value] of Object.entries(input)) {
            if (typeof key === "string" && key && typeof value === "string") {
                headers[key.toLowerCase()] = value;
            }
        }
    }
    return headers;
}

function parseUrl(input) {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`unsupported scheme ${url.protocol}`);
    }
    return url;
}

function isRedirect(status) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function headerObject(response) {
    const out = {};
    for (const [name, value] of response.headers.entries()) out[name] = value;
    return out;
}

function byteLength(text) {
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;
}

// Cut to at most maxBytes UTF-8 bytes without splitting a code point.
function truncateToBytes(text, maxBytes) {
    if (typeof TextEncoder === "undefined") return text.slice(0, maxBytes);
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= maxBytes) return text;
    const slice = bytes.subarray(0, maxBytes);
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

function message(error) {
    return error instanceof Error ? error.message : String(error);
}

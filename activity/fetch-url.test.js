import { test } from "node:test";
import assert from "node:assert/strict";
import fetchUrl from "./fetch-url.js";

function response(status, { headers = {}, body = "", location } = {}) {
    const map = new Map(Object.entries(location ? { ...headers, location } : headers));
    return {
        status,
        headers: {
            get: (name) => map.get(name.toLowerCase()) ?? null,
            entries: () => map.entries(),
        },
        text: async () => body,
        body: { cancel() {} },
    };
}

function withFetch(fn, run) {
    const original = globalThis.fetch;
    globalThis.fetch = fn;
    return run().finally(() => { globalThis.fetch = original; });
}

test("rejects missing and malformed input before any request", async () => {
    await assert.rejects(fetchUrl("not json"), /must be valid JSON/);
    await assert.rejects(fetchUrl("{}"), /url is required/);
    await assert.rejects(fetchUrl(JSON.stringify({ url: "ftp://x/y" })), /unsupported scheme/);
});

test("returns status, headers, and body as JSON text", async () => {
    await withFetch(async () => response(200, { headers: { "content-type": "text/plain" }, body: "hi" }), async () => {
        const out = JSON.parse(await fetchUrl(JSON.stringify({ url: "https://obeli.sk/x" })));
        assert.equal(out.status, 200);
        assert.equal(out.headers["content-type"], "text/plain");
        assert.equal(out.body, "hi");
        assert.equal(out.truncated, false);
    });
});

test("follows redirects then reads the final body", async () => {
    let call = 0;
    await withFetch(async (url) => {
        call += 1;
        if (call === 1) {
            assert.equal(url, "https://obeli.sk/a");
            return response(302, { location: "/b" });
        }
        assert.equal(url, "https://obeli.sk/b");
        return response(200, { body: "final" });
    }, async () => {
        const out = JSON.parse(await fetchUrl(JSON.stringify({ url: "https://obeli.sk/a" })));
        assert.equal(out.body, "final");
        assert.equal(call, 2);
    });
});

test("caps the body at max_bytes and flags truncation", async () => {
    await withFetch(async () => response(200, { body: "abcdefghij" }), async () => {
        const out = JSON.parse(await fetchUrl(JSON.stringify({ url: "https://obeli.sk/x", max_bytes: 4 })));
        assert.equal(out.body, "abcd");
        assert.equal(out.truncated, true);
    });
});

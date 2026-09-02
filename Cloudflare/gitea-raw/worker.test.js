import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import worker from "./worker.js";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

afterEach(() => {
    globalThis.fetch = originalFetch;

    if (originalCaches === undefined) {
        delete globalThis.caches;
    } else {
        globalThis.caches = originalCaches;
    }
});

function createEnv(overrides = {}) {
    return {
        TOKEN: "external-secret",
        GITEA_TOKEN: "gitea-secret",
        GITEA_URL: "https://git.example.com",
        GITEA_OWNER: "orion",
        ALLOWED_REPOSITORIES: '["public-repo","private-repo"]',
        ...overrides
    };
}

function installCache() {
    const entries = new Map();
    const counters = { matches: 0, puts: 0 };

    globalThis.caches = {
        default: {
            async match(request) {
                counters.matches++;
                return entries.get(request.url)?.clone();
            },
            async put(request, response) {
                counters.puts++;
                entries.set(request.url, response.clone());
            }
        }
    };

    return counters;
}

function createContext() {
    const pending = [];

    return {
        ctx: {
            waitUntil(promise) {
                pending.push(promise);
            }
        },
        async flush() {
            await Promise.all(pending);
        }
    };
}

function installFetch(handler) {
    const calls = [];

    globalThis.fetch = async (input, init = {}) => {
        const call = {
            url: typeof input === "string" ? input : input.url,
            method: init.method || "GET",
            headers: new Headers(init.headers)
        };
        calls.push(call);
        return handler(call, calls.length - 1);
    };

    return calls;
}

test("unit: exposes service information at the root", async () => {
    const response = await worker.fetch(new Request("https://raw.example.com/"), {}, {});

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        status: "ok",
        service: "Gitea Raw Proxy",
        format: "/{repository}/{path}"
    });
});

test("unit: rejects unsupported methods and invalid paths", async t => {
    await t.test("unsupported method", async () => {
        const response = await worker.fetch(
            new Request("https://raw.example.com/public-repo/file.txt", { method: "POST" }),
            {},
            {}
        );
        assert.equal(response.status, 405);
    });

    await t.test("missing file path", async () => {
        const response = await worker.fetch(
            new Request("https://raw.example.com/public-repo"),
            {},
            {}
        );
        assert.equal(response.status, 400);
    });

    await t.test("path traversal", async () => {
        const response = await worker.fetch(
            new Request("https://raw.example.com/public-repo/%2E%2E/secret.txt"),
            {},
            {}
        );
        assert.equal(response.status, 400);
    });
});

test("unit: enforces a valid repository allowlist", async t => {
    await t.test("repository is not allowed", async () => {
        const response = await worker.fetch(
            new Request("https://raw.example.com/other-repo/file.txt"),
            createEnv(),
            {}
        );
        assert.equal(response.status, 404);
        assert.equal(await response.text(), "Repository not found.");
    });

    await t.test("allowlist is invalid", async () => {
        const response = await worker.fetch(
            new Request("https://raw.example.com/public-repo/file.txt"),
            createEnv({ ALLOWED_REPOSITORIES: '{"public-repo":true}' }),
            {}
        );
        assert.equal(response.status, 500);
        assert.match(await response.text(), /JSON array/);
    });
});

test("integration: serves a public repository without an external token", async () => {
    const cache = installCache();
    const context = createContext();
    const calls = installFetch(call => {
        if (call.url.includes("/api/v1/repos/")) {
            return Response.json({ default_branch: "main" });
        }

        return new Response("payload", {
            headers: {
                "Content-Type": "application/octet-stream",
                "ETag": '"file-etag"'
            }
        });
    });

    const response = await worker.fetch(
        new Request("https://raw.example.com/public-repo/config/test.yaml"),
        createEnv(),
        context.ctx
    );
    await context.flush();

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "payload");
    assert.equal(response.headers.get("Content-Type"), "text/yaml; charset=utf-8");
    assert.equal(response.headers.get("ETag"), '"file-etag"');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.get("Authorization"), null);
    assert.equal(calls[1].headers.get("Authorization"), null);
    assert.equal(
        calls[1].url,
        "https://git.example.com/orion/public-repo/raw/branch/main/config/test.yaml"
    );
    assert.deepEqual(cache, { matches: 1, puts: 1 });
});

test("integration: requires the external token before serving a private repository", async () => {
    const cache = installCache();
    const context = createContext();
    const calls = installFetch(call => {
        if (call.url.includes("/api/v1/repos/")) {
            if (!call.headers.has("Authorization")) {
                return new Response("not found", { status: 404 });
            }
            return Response.json({ default_branch: "release/v1" });
        }

        return new Response("private payload", {
            headers: { "Content-Type": "text/plain" }
        });
    });

    const authorizedResponse = await worker.fetch(
        new Request("https://raw.example.com/private-repo/private.txt?token=external-secret"),
        createEnv(),
        context.ctx
    );
    await context.flush();

    assert.equal(authorizedResponse.status, 200);
    assert.equal(await authorizedResponse.text(), "private payload");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].headers.get("Authorization"), null);
    assert.equal(calls[1].headers.get("Authorization"), "token gitea-secret");
    assert.equal(calls[2].headers.get("Authorization"), "token gitea-secret");
    assert.equal(calls.some(call => call.url.includes("external-secret")), false);
    assert.equal(
        calls[2].url,
        "https://git.example.com/orion/private-repo/raw/branch/release/v1/private.txt"
    );
    assert.deepEqual(cache, { matches: 1, puts: 1 });

    const unauthorizedResponse = await worker.fetch(
        new Request("https://raw.example.com/private-repo/private.txt"),
        createEnv(),
        createContext().ctx
    );

    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(await unauthorizedResponse.text(), "Unauthorized.");
    assert.equal(calls.length, 3);
    assert.deepEqual(cache, { matches: 1, puts: 1 });
});

test("integration: forwards range requests without using the file cache", async () => {
    const cache = installCache();
    const calls = installFetch(call => {
        if (call.url.includes("/api/v1/repos/")) {
            return Response.json({ default_branch: "main" });
        }

        assert.equal(call.headers.get("Range"), "bytes=0-3");
        return new Response("data", {
            status: 206,
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Range": "bytes 0-3/10"
            }
        });
    });

    const response = await worker.fetch(
        new Request("https://raw.example.com/public-repo/archive.bin", {
            headers: { "Range": "bytes=0-3" }
        }),
        createEnv(),
        createContext().ctx
    );

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 0-3/10");
    assert.equal(calls.at(-1).headers.get("Range"), "bytes=0-3");
    assert.deepEqual(cache, { matches: 0, puts: 0 });
});

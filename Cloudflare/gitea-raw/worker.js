/**
 * Gitea Raw Proxy (Cloudflare Worker, ES module)
 *
 * Public repository URL:  https://raw.example.com/{repository}/{path}
 * Private repository URL: https://raw.example.com/{repository}/{path}?token=xxxx
 *
 * Worker secrets:
 *   TOKEN        External access token required for private repositories
 *   GITEA_TOKEN  Gitea token used only when an anonymous lookup cannot access
 *                the repository (normally a private repository)
 *
 * Worker variables:
 *   GITEA_URL    Gitea base URL, for example https://git.example.com
 *   GITEA_OWNER  Repository owner
 *   ALLOWED_REPOSITORIES  JSON array of repository names exposed by this Worker
 */

const CONFIG = {
    REQUIRE_TOKEN: true,
    ENABLE_CACHE: true,
    CACHE_TTL: 60,
    ENABLE_CORS: true,
    REPOSITORY_INFO_TTL: 300
};

const MIME_TYPES = {
    ".txt": "text/plain; charset=utf-8",
    ".conf": "text/plain; charset=utf-8",
    ".list": "text/plain; charset=utf-8",
    ".rules": "text/plain; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".ts": "application/typescript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".ini": "text/plain; charset=utf-8",
    ".toml": "text/plain; charset=utf-8"
};

// This cache is per Worker isolate. It avoids an API lookup on every cache miss.
const repositoryInfoCache = new Map();

export default {
    async fetch(request, env, ctx) {
        try {
            if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
                return errorResponse("Method Not Allowed", 405);
            }

            if (request.method === "OPTIONS") {
                return new Response(null, { status: 204, headers: corsHeaders() });
            }

            const url = new URL(request.url);
            let pathname;

            try {
                pathname = decodeURIComponent(url.pathname);
            } catch {
                return errorResponse("Invalid path.", 400);
            }

            const path = pathname.replace(/^\/+/, "");

            if (!path) {
                return jsonResponse({
                    status: "ok",
                    service: "Gitea Raw Proxy",
                    format: "/{repository}/{path}"
                });
            }

            if (path.includes("..") || path.includes("\\")) {
                return errorResponse("Invalid path.", 400);
            }

            const parts = path.split("/").filter(Boolean);

            if (parts.length < 2) {
                return errorResponse("Invalid path. Expected /{repository}/{path}", 400);
            }

            const repositoryName = parts[0];
            const filePath = parts.slice(1).join("/");

            const gitea = getGiteaConfig(env);
            const repo = getAllowedRepositoryName(repositoryName, env);
            const repository = await getRepositoryInfo(repo, env, gitea);

            if (repository.requiresAuth) {
                const tokenResult = await verifyToken(request, env);

                if (!tokenResult.success) {
                    return errorResponse(tokenResult.message, 401);
                }
            }

            const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });

            if (CONFIG.ENABLE_CACHE && request.method === "GET" && !request.headers.has("Range")) {
                const cached = await caches.default.match(cacheKey);

                if (cached) {
                    return addCorsHeaders(cached);
                }
            }

            const branch = repository.defaultBranch;
            const giteaUrl = buildGiteaRawUrl(gitea, repo, branch, filePath);

            console.log(JSON.stringify({
                repo,
                branch,
                private: repository.requiresAuth,
                filePath,
                giteaUrl
            }));

            const giteaResponse = await fetch(giteaUrl, {
                method: request.method,
                headers: buildGiteaHeaders(env, request, repository.requiresAuth),
                redirect: "follow"
            });

            if (!giteaResponse.ok) {
                console.error(JSON.stringify({
                    status: giteaResponse.status,
                    statusText: giteaResponse.statusText,
                    giteaUrl
                }));
                return handleGiteaError(giteaResponse);
            }

            const responseHeaders = buildResponseHeaders(filePath, giteaResponse);

            if (request.method === "HEAD") {
                return new Response(null, {
                    status: giteaResponse.status,
                    headers: responseHeaders
                });
            }

            const response = new Response(giteaResponse.body, {
                status: giteaResponse.status,
                statusText: giteaResponse.statusText,
                headers: responseHeaders
            });

            if (
                CONFIG.ENABLE_CACHE &&
                giteaResponse.status === 200 &&
                !request.headers.has("Range")
            ) {
                ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
            }

            return response;
        } catch (error) {
            if (error instanceof RepositoryLookupError) {
                return errorResponse(error.message, error.status);
            }

            console.error("Worker Error:", error);
            return errorResponse("Internal Server Error.", 500);
        }
    }
};

/**
 * First query anonymously. Only retry with GITEA_TOKEN when the repository is
 * not anonymously accessible. This keeps the token out of public repo calls.
 */
async function getRepositoryInfo(repo, env, gitea) {
    const cacheKey = `${gitea.baseUrl}\u0000${gitea.owner}\u0000${repo}`;
    const cached = repositoryInfoCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
        if (cached.value.requiresAuth && !env.GITEA_TOKEN) {
            throw new RepositoryLookupError(
                "GITEA_TOKEN is required to access this repository.",
                502
            );
        }

        return cached.value;
    }

    const apiUrl = buildGiteaRepositoryApiUrl(gitea, repo);
    const anonymousResponse = await fetch(apiUrl, {
        headers: buildGiteaApiHeaders(),
        redirect: "follow"
    });

    if (anonymousResponse.ok) {
        const info = await parseRepositoryInfo(anonymousResponse, false);
        cacheRepositoryInfo(cacheKey, info);
        return info;
    }

    if (![401, 403, 404].includes(anonymousResponse.status)) {
        throw new RepositoryLookupError(
            `Gitea repository API returned HTTP ${anonymousResponse.status}.`,
            502
        );
    }

    if (!env.GITEA_TOKEN) {
        const message = anonymousResponse.status === 404
            ? `Repository "${repo}" was not found or is private.`
            : "GITEA_TOKEN is required to access this repository.";
        throw new RepositoryLookupError(message, anonymousResponse.status === 404 ? 404 : 502);
    }

    const authenticatedResponse = await fetch(apiUrl, {
        headers: buildGiteaApiHeaders(env.GITEA_TOKEN),
        redirect: "follow"
    });

    if (!authenticatedResponse.ok) {
        if ([401, 403].includes(authenticatedResponse.status)) {
            throw new RepositoryLookupError(
                `Gitea authentication failed (${authenticatedResponse.status}). Check GITEA_TOKEN.`,
                502
            );
        }

        if (authenticatedResponse.status === 404) {
            throw new RepositoryLookupError(`Repository "${repo}" was not found.`, 404);
        }

        throw new RepositoryLookupError(
            `Gitea repository API returned HTTP ${authenticatedResponse.status}.`,
            502
        );
    }

    // Anonymous access failed, so raw content must use the Gitea token too.
    const info = await parseRepositoryInfo(authenticatedResponse, true);
    cacheRepositoryInfo(cacheKey, info);
    return info;
}

async function parseRepositoryInfo(response, requiresAuth) {
    let data;

    try {
        data = await response.json();
    } catch {
        throw new RepositoryLookupError("Gitea repository API returned invalid JSON.", 502);
    }

    if (!data.default_branch || typeof data.default_branch !== "string") {
        throw new RepositoryLookupError("Gitea repository has no default branch.", 502);
    }

    return {
        defaultBranch: data.default_branch,
        requiresAuth
    };
}

function cacheRepositoryInfo(cacheKey, value) {
    repositoryInfoCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + CONFIG.REPOSITORY_INFO_TTL * 1000
    });
}

function getGiteaConfig(env) {
    const baseUrl = env.GITEA_URL?.trim().replace(/\/+$/, "");
    const owner = env.GITEA_OWNER?.trim();

    if (!baseUrl || !owner) {
        throw new RepositoryLookupError(
            "Worker variables GITEA_URL and GITEA_OWNER must be configured.",
            500
        );
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(baseUrl);
    } catch {
        throw new RepositoryLookupError("Worker variable GITEA_URL is invalid.", 500);
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new RepositoryLookupError("Worker variable GITEA_URL must use HTTP or HTTPS.", 500);
    }

    return { baseUrl, owner };
}

function getAllowedRepositoryName(repositoryName, env) {
    if (!env.ALLOWED_REPOSITORIES) {
        throw new RepositoryLookupError(
            "Worker variable ALLOWED_REPOSITORIES must be configured.",
            500
        );
    }

    let allowedRepositories;
    try {
        allowedRepositories = JSON.parse(env.ALLOWED_REPOSITORIES);
    } catch {
        throw new RepositoryLookupError("Worker variable ALLOWED_REPOSITORIES is invalid JSON.", 500);
    }

    if (
        !Array.isArray(allowedRepositories) ||
        allowedRepositories.some(repo => typeof repo !== "string" || !repo.trim())
    ) {
        throw new RepositoryLookupError(
            "Worker variable ALLOWED_REPOSITORIES must be a JSON array of repository names.",
            500
        );
    }

    if (!allowedRepositories.includes(repositoryName)) {
        throw new RepositoryLookupError("Repository not found.", 404);
    }

    return repositoryName;
}

function buildGiteaRepositoryApiUrl(gitea, repo) {
    return `${gitea.baseUrl}/api/v1/repos/${encodeURIComponent(gitea.owner)}/${encodeURIComponent(repo)}`;
}

function buildGiteaRawUrl(gitea, repo, branch, filePath) {
    const owner = encodeURIComponent(gitea.owner);
    const encodedRepo = encodeURIComponent(repo);
    const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");

    return `${gitea.baseUrl}/${owner}/${encodedRepo}/raw/branch/${encodedBranch}/${encodedPath}`;
}

function buildGiteaApiHeaders(token) {
    const headers = {
        "User-Agent": "Cloudflare-Gitea-Raw-Proxy",
        "Accept": "application/json"
    };

    if (token) {
        headers.Authorization = `token ${token}`;
    }

    return headers;
}

function buildGiteaHeaders(env, request, requiresAuth) {
    const headers = {
        "User-Agent": "Cloudflare-Gitea-Raw-Proxy",
        "Accept": "*/*"
    };

    if (requiresAuth) {
        headers.Authorization = `token ${env.GITEA_TOKEN}`;
    }

    const range = request.headers.get("Range");

    if (range) {
        headers.Range = range;
    }

    return headers;
}

function buildResponseHeaders(filePath, giteaResponse) {
    const headers = new Headers();
    headers.set("Content-Type", getContentType(filePath, giteaResponse.headers.get("Content-Type")));

    for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
        const value = giteaResponse.headers.get(name);
        if (value) headers.set(name, value);
    }

    headers.set("Cache-Control", `public, max-age=${CONFIG.CACHE_TTL}`);
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Proxy-By", "Cloudflare-Gitea-Raw");

    for (const [key, value] of Object.entries(corsHeaders())) {
        headers.set(key, value);
    }

    return headers;
}

async function verifyToken(request, env) {
    if (!CONFIG.REQUIRE_TOKEN) return { success: true };

    const url = new URL(request.url);
    let suppliedToken = url.searchParams.get("token");

    if (!suppliedToken) {
        const authorization = request.headers.get("Authorization");
        if (authorization?.toLowerCase().startsWith("bearer ")) {
            suppliedToken = authorization.substring(7).trim();
        }
    }

    if (!env.TOKEN) {
        console.error("Worker Secret TOKEN is not configured.");
        return { success: false, message: "Worker authentication is not configured." };
    }

    if (!suppliedToken) return { success: false, message: "Unauthorized." };

    return await safeEqual(suppliedToken, env.TOKEN)
        ? { success: true }
        : { success: false, message: "Invalid token." };
}

async function safeEqual(a, b) {
    if (!a || !b) return false;

    const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
    if (hashA.length !== hashB.length) return false;

    let result = 0;
    for (let i = 0; i < hashA.length; i++) {
        result |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i);
    }
    return result === 0;
}

async function sha256(value) {
    const data = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function getContentType(filePath, giteaContentType) {
    const lowerPath = filePath.toLowerCase();
    const index = lowerPath.lastIndexOf(".");

    if (index !== -1 && MIME_TYPES[lowerPath.substring(index)]) {
        return MIME_TYPES[lowerPath.substring(index)];
    }

    if (giteaContentType && !giteaContentType.toLowerCase().startsWith("text/html")) {
        return giteaContentType;
    }

    return "text/plain; charset=utf-8";
}

function corsHeaders() {
    if (!CONFIG.ENABLE_CORS) return {};

    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Range, Content-Type",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
        "Access-Control-Max-Age": "86400"
    };
}

function addCorsHeaders(response) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

async function handleGiteaError(response) {
    if ([401, 403].includes(response.status)) {
        return errorResponse(
            `Gitea authentication failed (${response.status}). Check GITEA_TOKEN.`,
            502
        );
    }

    if (response.status === 404) return errorResponse("File not found on Gitea.", 404);
    return errorResponse(`Gitea returned HTTP ${response.status}.`, 502);
}

function errorResponse(message, status) {
    return new Response(message, {
        status,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders()
        }
    });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders()
        }
    });
}

class RepositoryLookupError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "RepositoryLookupError";
        this.status = status;
    }
}

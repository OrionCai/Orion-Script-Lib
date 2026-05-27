const DEFAULT_MAX_FILE_MB = 500;
const DEFAULT_MAX_UPLOAD_QUEUE_IMAGES = 500;

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/init") {
            if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) {
                return new Response("Unauthorized", { status: 401 });
            }

            await initDb(env);
            return new Response("DB initialized");
        }

        if (request.method === "GET") {
            return new Response("Lsky Telegram Worker OK - code-block-max500mb-queue500-2026-05-27");
        }

        if (url.pathname !== "/webhook" || request.method !== "POST") {
            return new Response("Not Found", { status: 404 });
        }

        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
            return new Response("Unauthorized", { status: 401 });
        }

        const update = await request.json();
        ctx.waitUntil(handleUpdate(update, env));
        return new Response("OK");
    },
};

async function initDb(env) {
    await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS album_groups (
      group_key TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      reply_to INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

    await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS album_messages (
      group_key TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (group_key, message_id)
    )
  `).run();
}

async function handleUpdate(update, env) {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat?.id;
    const userId = message.from?.id;
    const messageId = message.message_id;

    if (!isAllowedUser(userId, env.ALLOWED_TELEGRAM_USER_IDS)) {
        await sendTelegramText(env, chatId, "未授权。", messageId);
        return;
    }

    if (message.text?.startsWith("/start")) {
        await sendTelegramText(env, chatId, "发图片或图片文件给我，我会上传到 Lsky Pro。", messageId);
        return;
    }

    if (message.media_group_id) {
        const groupKey = `${chatId}:${message.media_group_id}`;
        const now = Date.now();

        await env.DB.prepare(`
      INSERT OR IGNORE INTO album_groups (group_key, chat_id, reply_to, status, updated_at)
      VALUES (?, ?, ?, 'collecting', ?)
    `).bind(groupKey, String(chatId), messageId, now).run();

        await env.DB.prepare(`
      UPDATE album_groups
      SET updated_at = ?
      WHERE group_key = ? AND status = 'collecting'
    `).bind(now, groupKey).run();

        const maxQueueImages = getMaxUploadQueueImages(env);
        const queued = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM album_messages
      WHERE group_key = ?
    `).bind(groupKey).first();

        if (Number(queued?.count || 0) >= maxQueueImages) {
            await sendTelegramText(env, chatId, `上传队列已满，最多 ${maxQueueImages} 张。`, messageId);
            return;
        }

        await env.DB.prepare(`
      INSERT OR IGNORE INTO album_messages (group_key, message_id, payload)
      VALUES (?, ?, ?)
    `).bind(groupKey, messageId, JSON.stringify(message)).run();

        await sleep((Number(env.ALBUM_WAIT_SECONDS || "5") + 1) * 1000);
        await processAlbum(env, groupKey);
        return;
    }

    try {
        const image = await uploadTelegramMessageToLsky(env, message);
        await sendTelegramText(env, chatId, toTelegramCodeBlock(toMarkdownImage(image.url, image.filename)), messageId, "HTML");
    } catch (err) {
        await sendTelegramText(env, chatId, `上传失败：${err.message}`, messageId);
    }
}

async function processAlbum(env, groupKey) {
    const waitMs = Number(env.ALBUM_WAIT_SECONDS || "5") * 1000;
    const group = await env.DB.prepare(`
    SELECT * FROM album_groups WHERE group_key = ?
  `).bind(groupKey).first();

    if (!group || group.status !== "collecting") return;
    if (Date.now() - group.updated_at < waitMs) return;

    const lock = await env.DB.prepare(`
    UPDATE album_groups
    SET status = 'processing'
    WHERE group_key = ? AND status = 'collecting'
  `).bind(groupKey).run();

    if (!lock.meta || lock.meta.changes !== 1) return;

    const rows = await env.DB.prepare(`
    SELECT message_id, payload
    FROM album_messages
    WHERE group_key = ?
    ORDER BY message_id ASC
  `).bind(groupKey).all();

    const messages = rows.results.map((row) => JSON.parse(row.payload));
    const images = [];
    const errors = [];

    for (let i = 0; i < messages.length; i++) {
        try {
            images.push(await uploadTelegramMessageToLsky(env, messages[i]));
        } catch (err) {
            errors.push(`${i + 1}. ${err.message}`);
        }
    }

    let text = images.length
        ? "上传完成：\n\n" + images.map((image, i) => `${i + 1}.\n${toTelegramCodeBlock(toMarkdownImage(image.url, image.filename))}`).join("\n")
        : "这一组图片全部上传失败。";

    if (errors.length) {
        text += "\n\n失败：\n" + errors.join("\n");
    }

    await sendTelegramLongText(env, group.chat_id, text, group.reply_to, images.length ? "HTML" : undefined);

    await env.DB.prepare(`DELETE FROM album_messages WHERE group_key = ?`).bind(groupKey).run();
    await env.DB.prepare(`DELETE FROM album_groups WHERE group_key = ?`).bind(groupKey).run();
}

function isAllowedUser(userId, allowList) {
    return String(allowList || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .includes(String(userId));
}

function toMarkdownImage(url, filename = "image") {
    return `![${escapeMarkdownAlt(filename)}](${url})`;
}

function escapeMarkdownAlt(value) {
    return String(value || "image")
        .replaceAll("\\", "\\\\")
        .replaceAll("]", "\\]");
}

function toTelegramCodeBlock(text) {
    return `<pre>${escapeHtml(text)}</pre>`;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function getMaxFileMb(env) {
    const value = Number(env.MAX_FILE_MB || DEFAULT_MAX_FILE_MB);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_FILE_MB;
}

function formatFileMb(value) {
    return value.toFixed(2);
}

function getMaxUploadQueueImages(env) {
    const value = Number(env.MAX_UPLOAD_QUEUE_IMAGES || DEFAULT_MAX_UPLOAD_QUEUE_IMAGES);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_UPLOAD_QUEUE_IMAGES;
}

async function uploadTelegramMessageToLsky(env, message) {
    const image = extractImage(message, env);

    const fileInfo = await telegramApi(env, "getFile", {
        file_id: image.fileId,
    });

    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    const fileResp = await fetch(fileUrl);

    if (!fileResp.ok) {
        throw new Error(`下载 Telegram 文件失败: HTTP ${fileResp.status}`);
    }

    const bytes = await fileResp.arrayBuffer();
    const filename = image.filename || guessFilename(fileInfo.file_path, image.mimeType);
    const url = await uploadToLsky(env, bytes, filename, image.mimeType);

    return { url, filename };
}

function extractImage(message, env) {
    const maxFileMb = getMaxFileMb(env);
    const maxBytes = maxFileMb * 1024 * 1024;

    if (message.photo?.length) {
        const photo = message.photo[message.photo.length - 1];

        if (photo.file_size && photo.file_size > maxBytes) {
            throw new Error(`图片超过 ${formatFileMb(maxFileMb)} MB`);
        }

        return {
            fileId: photo.file_id,
            filename: `${photo.file_unique_id || photo.file_id}.jpg`,
            mimeType: "image/jpeg",
        };
    }

    if (message.document) {
        const doc = message.document;
        const mimeType = doc.mime_type || "application/octet-stream";

        if (!mimeType.startsWith("image/")) {
            throw new Error("请发送图片，或以文件形式发送图片");
        }

        if (doc.file_size && doc.file_size > maxBytes) {
            throw new Error(`文件超过 ${formatFileMb(maxFileMb)} MB`);
        }

        return {
            fileId: doc.file_id,
            filename: doc.file_name || `${doc.file_unique_id || doc.file_id}`,
            mimeType,
        };
    }

    throw new Error("请发送图片，或以文件形式发送图片");
}

async function uploadToLsky(env, bytes, filename, mimeType) {
    const form = new FormData();
    form.append("file", new File([bytes], filename, { type: mimeType }));
    form.append("permission", env.LSKY_PERMISSION || "1");

    if (env.LSKY_STRATEGY_ID) {
        form.append("strategy_id", env.LSKY_STRATEGY_ID);
    }

    const resp = await fetch(env.LSKY_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.LSKY_TOKEN}`,
            Accept: "application/json",
        },
        body: form,
    });

    const raw = await resp.text();
    let result;

    try {
        result = JSON.parse(raw);
    } catch {
        throw new Error(`Lsky 返回非 JSON: HTTP ${resp.status} ${raw.slice(0, 200)}`);
    }

    if (!resp.ok || result.status !== true) {
        throw new Error(`Lsky 上传失败: HTTP ${resp.status} ${JSON.stringify(result)}`);
    }

    const data = result.data || {};
    const links = data.links || {};
    const url = links.url || data.url || data.pathname || data.path;

    if (!url) {
        throw new Error(`Lsky 返回中找不到图片链接`);
    }

    return url;
}

async function telegramApi(env, method, payload) {
    const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
    });

    const raw = await resp.text();
    const result = JSON.parse(raw);

    if (!resp.ok || result.ok !== true) {
        throw new Error(`Telegram API ${method} 失败: ${JSON.stringify(result)}`);
    }

    return result.result;
}

async function sendTelegramText(env, chatId, text, replyToMessageId, parseMode) {
    if (!chatId) return;

    const payload = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
    };

    if (parseMode) {
        payload.parse_mode = parseMode;
    }

    if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
    }

    await telegramApi(env, "sendMessage", payload);
}

async function sendTelegramLongText(env, chatId, text, replyToMessageId, parseMode) {
    const limit = 3900;
    const chunks = splitTelegramText(text, limit);

    for (let i = 0; i < chunks.length; i++) {
        await sendTelegramText(
            env,
            chatId,
            chunks[i],
            i === 0 ? replyToMessageId : undefined,
            parseMode
        );
    }
}

function splitTelegramText(text, limit) {
    const chunks = [];
    let current = "";

    for (const line of String(text || "").split("\n")) {
        const next = current ? `${current}\n${line}` : line;

        if (next.length <= limit) {
            current = next;
            continue;
        }

        if (current) {
            chunks.push(current);
            current = "";
        }

        if (line.length <= limit) {
            current = line;
            continue;
        }

        for (let i = 0; i < line.length; i += limit) {
            chunks.push(line.slice(i, i + limit));
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks.length ? chunks : [""];
}

function guessFilename(filePath, mimeType) {
    const base = filePath.split("/").pop() || "image";

    if (base.includes(".")) return base;
    if (mimeType === "image/png") return `${base}.png`;
    if (mimeType === "image/webp") return `${base}.webp`;
    if (mimeType === "image/gif") return `${base}.gif`;

    return `${base}.jpg`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
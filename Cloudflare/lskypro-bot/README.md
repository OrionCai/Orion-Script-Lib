# Lsky Pro Telegram Worker

`lskypro-telegram-worker.js` 是一个部署在 Cloudflare Workers 上的 Telegram 图片上传 Bot。用户把图片或图片文件发送给 Bot 后，Worker 会从 Telegram 下载原文件，上传到 Lsky Pro，并返回可直接复制使用的 Markdown 图片链接。

## 功能特性

- 支持 Telegram 普通图片和以文件形式发送的图片。
- 支持相册媒体组，按消息顺序批量上传并汇总返回链接。
- 返回内容使用 Telegram 代码块包裹，便于复制 Markdown。
- 支持用户白名单，只允许指定 Telegram 用户使用。
- 支持 Webhook secret 校验，拒绝非授权请求。
- 使用 Cloudflare D1 暂存相册消息，避免媒体组拆散处理。
- 可配置单文件大小上限、相册等待时间、上传队列数量、Lsky Pro 权限和存储策略。

## 文件

```text
Cloudflare/lskypro-bot/
├── README.md
└── lskypro-telegram-worker.js
```

## 运行环境

- Cloudflare Workers
- Cloudflare D1 数据库
- Telegram Bot Token
- Lsky Pro API Token

## D1 绑定

Worker 需要绑定一个 D1 数据库，绑定名必须是：

```text
DB
```

初始化时会创建以下表：

- `album_groups`：记录媒体组收集状态。
- `album_messages`：保存媒体组内每条 Telegram 消息的原始 payload。

## 环境变量

### 必需变量

| 变量名 | 说明 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram Webhook secret token，同时用于 `/init` 初始化鉴权 |
| `ALLOWED_TELEGRAM_USER_IDS` | 允许使用 Bot 的 Telegram user id，多个 ID 用英文逗号分隔 |
| `LSKY_API_URL` | Lsky Pro 上传接口地址，例如 `https://example.com/api/v1/upload` |
| `LSKY_TOKEN` | Lsky Pro API Token |

### 可选变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `LSKY_PERMISSION` | `1` | Lsky Pro 图片权限，按你的 Lsky Pro 实例配置填写 |
| `LSKY_STRATEGY_ID` | 空 | Lsky Pro 存储策略 ID，留空则使用默认策略 |
| `MAX_FILE_MB` | `500` | 单张图片或图片文件最大体积，单位 MB |
| `MAX_UPLOAD_QUEUE_IMAGES` | `500` | 单个相册媒体组最多排队图片数量 |
| `ALBUM_WAIT_SECONDS` | `5` | 相册媒体组收集等待时间，单位秒 |

## 部署流程

1. 在 Telegram 通过 BotFather 创建 Bot，拿到 `TELEGRAM_BOT_TOKEN`。
2. 在 Lsky Pro 后台创建 API Token，确认可访问上传接口。
3. 在 Cloudflare 创建 Worker，并使用 [lskypro-telegram-worker.js](lskypro-telegram-worker.js) 作为 Worker 代码。
4. 创建 D1 数据库，并绑定到 Worker，绑定名设置为 `DB`。
5. 配置必需环境变量和需要的可选变量。
6. 访问初始化接口创建 D1 表：

```bash
curl "https://<WORKER_HOST>/init?secret=<TELEGRAM_WEBHOOK_SECRET>"
```

返回 `DB initialized` 表示初始化完成。

7. 设置 Telegram Webhook：

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<WORKER_HOST>/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

8. 访问 Worker 根路径，若返回 `Lsky Telegram Worker OK ...`，说明 Worker 基本可访问。

## 使用方式

1. 使用白名单里的 Telegram 账号私聊 Bot。
2. 发送 `/start`，Bot 会返回简短说明。
3. 发送图片、图片文件或 Telegram 相册。
4. Bot 上传成功后会回复 Markdown 图片链接：

```markdown
![filename](https://example.com/path/to/image.jpg)
```

相册会按顺序返回多条链接；如果部分图片失败，会在回复末尾列出失败原因。

## 路由

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/` | `GET` | 健康检查 |
| `/init?secret=...` | `GET` | 初始化 D1 表 |
| `/webhook` | `POST` | Telegram Webhook 入口 |

## 注意事项

- `ALLOWED_TELEGRAM_USER_IDS` 必须填写真实 Telegram user id，不是用户名。
- `/webhook` 会校验请求头 `X-Telegram-Bot-Api-Secret-Token`，需要通过 `setWebhook` 同步设置 `secret_token`。
- 脚本只接受 `photo` 或 MIME 类型以 `image/` 开头的 `document`，其他文件会被拒绝。
- Telegram Bot API 自身也有文件大小限制；`MAX_FILE_MB` 只是在脚本侧额外限制。
- Lsky Pro 返回结果中必须包含可识别的图片 URL，脚本会依次尝试读取 `data.links.url`、`data.url`、`data.pathname` 或 `data.path`。
- 不要把 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`LSKY_TOKEN` 提交到公开仓库。

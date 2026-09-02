# Telegram 跳转

Surge 模块，用于把 `t.me` 和 `telegram.me` 链接重定向到指定 Telegram 客户端。

## 安装

在 Surge 中通过模块 URL 添加：

```text
https://raw.githubusercontent.com/OrionG-hub/Script-Lib/refs/heads/master/module/surge/telegram/Telegram.sgmodule
```

启用模块后按需修改参数 `CLIENT`。

## 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `CLIENT` | `Telegram` | 目标客户端名称。选择 `Telegram` 时保持原链接，不重定向。 |

支持的客户端：

- `Telegram`
- `Nagram`
- `Swiftgram`
- `Turrit`
- `iMe`
- `Nicegram`
- `Lingogram`

## 支持的链接

- 用户、频道、群组：`https://t.me/name`
- 帖子链接：`https://t.me/name/123`
- 邀请链接：`https://t.me/+invite`、`https://t.me/joinchat/invite`
- 贴纸包：`https://t.me/addstickers/set`
- 分享链接：`https://t.me/share/url?url=...&text=...`

## MITM

模块会追加以下主机名：

```text
t.me, telegram.me
```

如果 Surge 未生效，检查 MITM、证书信任和模块是否启用。

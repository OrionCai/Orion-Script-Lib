# TeleBox Scripts

TeleBox 部署和管理脚本集合，提供直接安装、生产级 PM2 部署，以及 Docker Compose 菜单式管理三种入口。

## 文件

| 文件 | 说明 | 推荐场景 |
| --- | --- | --- |
| `telebox.sh` | 生产级部署脚本，包含依赖检查、清理、克隆、登录、PM2 守护和开机自启 | 普通 VPS 直接部署，推荐优先使用 |
| `installTeleBox.sh` | 较早版本的一键安装脚本，会清理旧 TeleBox 后重新安装并交给 PM2 托管 | 需要简单全新安装时使用 |
| `telebox-docker.sh` | Docker Compose 菜单式管理脚本，支持安装、卸载、启停、重装、日志、备份、恢复 | 希望容器化部署和管理时使用 |

## 直接部署

推荐使用：

```bash
chmod +x telebox.sh
./telebox.sh
```

脚本会执行：

- 清理旧 TeleBox 进程和 `$HOME/telebox`。
- 安装基础依赖和 Node.js 20。
- 克隆 `https://github.com/TeleBoxDev/TeleBox.git`。
- 进入交互式 Telegram 登录流程。
- 生成 PM2 `ecosystem.config.js`。
- 启动 `telebox` 服务并尝试配置开机自启。

服务目录：

```text
$HOME/telebox
```

常用命令：

```bash
pm2 status telebox
pm2 logs telebox
pm2 restart telebox
pm2 stop telebox
pm2 delete telebox
```

## 旧版一键安装

```bash
chmod +x installTeleBox.sh
./installTeleBox.sh
```

这个脚本同样会删除旧 TeleBox 配置和目录，并进行全新安装。它适合快速部署，但推荐优先使用结构更清晰的 `telebox.sh`。

## Docker Compose 部署

```bash
chmod +x telebox-docker.sh
sudo ./telebox-docker.sh
```

脚本启动后会进入菜单，支持：

- 安装 TeleBox
- 卸载 TeleBox
- 关闭、启动、重启 TeleBox
- 重装 TeleBox
- 查看日志
- 进入容器
- 查看容器信息
- 备份和恢复 TeleBox

默认数据目录：

```text
/root/Docker_Telebox/<容器名称>
```

默认临时 Compose 目录：

```text
/tmp/telebox-compose-<容器名称>
```

## 运行环境

直接部署需要：

- Debian / Ubuntu
- `sudo`
- `curl`
- `git`
- Node.js 20，脚本会尝试安装
- PM2，脚本会尝试安装

Docker 部署需要：

- root 权限
- Docker
- Docker Compose v1 或 Docker Compose Plugin

## 交互式登录

直接部署和 Docker 部署都需要首次登录 Telegram 账号。看到类似：

```text
You should now be connected.
```

再按 `Ctrl+C` 退出登录阶段，脚本会继续进入后台服务配置。

## 安全注意

- 这些脚本包含清理、重装、删除容器和删除数据目录的逻辑，执行前请确认目标路径。
- `telebox.sh` 和 `installTeleBox.sh` 会清理 `$HOME/telebox`。
- `telebox-docker.sh` 的卸载和重装功能可能删除 `/root/Docker_Telebox/<容器名称>` 下的数据。
- Telegram API ID、API Hash 和登录状态属于敏感信息，不要公开泄露。

## 排错

查看 PM2 日志：

```bash
pm2 logs telebox --lines 50
```

查看 Docker 日志：

```bash
sudo ./telebox-docker.sh
```

然后选择 `查看日志`。

如果服务无法开机自启，手动执行：

```bash
pm2 startup
pm2 save
```

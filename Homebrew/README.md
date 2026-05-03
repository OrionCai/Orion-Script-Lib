# Homebrew Upgrade Manager

macOS Homebrew 智能升级脚本，用于统一执行 Homebrew 仓库更新、健康检查、命令行工具升级、GUI 应用升级和缓存清理。

## 文件

| 文件 | 说明 |
| --- | --- |
| `brew-upgrade-manager.sh` | Homebrew 升级维护主脚本 |

## 功能

- 执行 `brew update -v` 更新 Homebrew 仓库。
- 执行 `brew doctor` 检查 Homebrew 环境。
- 检查并安装 `buo/cask-upgrade` tap。
- 执行 `brew upgrade --formula` 升级命令行工具。
- 执行 `brew cu -yaq` 强制升级 Cask GUI 应用。
- 执行 `brew cleanup --prune=all` 清理旧版本和缓存。
- 支持终端宽度兜底，避免 `brew cu` 在部分 PTY 环境下渲染崩溃。

## 使用方式

```bash
chmod +x brew-upgrade-manager.sh
./brew-upgrade-manager.sh
```

指定终端宽度：

```bash
./brew-upgrade-manager.sh --width 130
```

也可以通过环境变量指定：

```bash
HB_TERMINAL_WIDTH=130 ./brew-upgrade-manager.sh
```

## 参数

| 参数 | 说明 |
| --- | --- |
| `--width <number>` | 手动指定输出宽度 |
| `--width=<number>` | 同上 |

## 运行前检查

确认系统已安装：

- macOS
- Homebrew
- Python 3

脚本会自动检查 `buo/cask-upgrade` tap，不存在时会执行：

```bash
brew tap buo/cask-upgrade
```

## 安全注意

脚本中有 `SUDO_PWD` 占位变量，用于在 `brew cu` 触发 sudo 时自动输入密码。

建议：

- 不要把真实密码提交到仓库。
- 运行前本地临时填写，运行后立即清空。
- 如果要长期使用，建议改造成运行时交互输入或 macOS Keychain 读取。

## 排错

如果遇到 Ruby 或表格渲染相关的终端宽度错误，优先尝试：

```bash
./brew-upgrade-manager.sh --width 130
```

如果 `brew cu` 不存在，确认 tap 是否安装成功：

```bash
brew tap | rg "buo/cask-upgrade"
```

如果升级过程卡在 sudo 密码提示，请检查 `SUDO_PWD` 是否为空，或改为手动运行相关 `brew cu` 命令。

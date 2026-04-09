#!/usr/bin/env bash
# Homebrew 智能升级脚本（强制 Cask 更新增强版 v5.2 - 修复 PTY 终端尺寸导致 Ruby 渲染崩溃问题）
# ❗️使用前请搜索 SUDO_PWD 并添加自己的 root 密码！！！

# ================== 脚本环境设置 ==================

# set -e：当命令返回非零退出状态（表示失败）时，脚本会立即退出。
set -e
# set -o pipefail：在管道命令中，如果任何一个子命令失败，整个管道即为失败。
set -o pipefail

# --- 颜色定义 (自动检测终端是否支持) ---
if [ -t 1 ]; then
    GREEN='\033[1;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[1;34m'
    CYAN='\033[1;36m'
    NC='\033[0m'
else
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    NC=''
fi

# --- 终端宽度和打印函数 ---
DEFAULT_FALLBACK_WIDTH="130"
TERMINAL_WIDTH_OVERRIDE=""

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --width)
            if [[ -n "$2" && "$2" =~ ^[0-9]+$ ]]; then
                TERMINAL_WIDTH_OVERRIDE="$2"
                shift 2
            else
                echo -e "${YELLOW}Error: '--width' parameter requires a valid numeric value.${NC}"
                exit 1
            fi
            ;;
        --width=*)
            TERMINAL_WIDTH_OVERRIDE="${1#*=}"
            if ! [[ "$TERMINAL_WIDTH_OVERRIDE" =~ ^[0-9]+$ ]]; then
                echo -e "${YELLOW}Error: '--width' parameter requires a valid numeric value.${NC}"
                exit 1
            fi
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# 确定最终的 TERMINAL_WIDTH
if [[ -n "$TERMINAL_WIDTH_OVERRIDE" ]]; then
    TERMINAL_WIDTH="$TERMINAL_WIDTH_OVERRIDE"
elif [[ -n "$HB_TERMINAL_WIDTH" && "$HB_TERMINAL_WIDTH" =~ ^[0-9]+$ ]]; then
    TERMINAL_WIDTH="$HB_TERMINAL_WIDTH"
elif command -v stty &>/dev/null && stty size &>/dev/null; then
    TERMINAL_WIDTH=$(stty size 2>/dev/null | awk '{print $2}')
    if [[ -z "$TERMINAL_WIDTH" || "$TERMINAL_WIDTH" -le 0 ]]; then
        TERMINAL_WIDTH=$(tput cols 2>/dev/null || echo "$DEFAULT_FALLBACK_WIDTH")
    fi
else
    TERMINAL_WIDTH=$(tput cols 2>/dev/null || echo "$DEFAULT_FALLBACK_WIDTH")
fi

separator() { printf '=%.0s' $(seq 1 "$TERMINAL_WIDTH"); printf "\n"; }
print_header() { echo -e "${BLUE}$1${NC}"; }

# ================== 流程开始 ==================
separator

print_header "Step 1: Updating Homebrew repositories (brew update -v)"
brew update -v
separator
printf "\n"

separator
print_header "Step 2: Performing health check (brew doctor)"
if ! brew doctor; then
    echo -e "${YELLOW}Warning: 'brew doctor' detected issues. Manual review and resolution are recommended.${NC}"
else
    echo "Homebrew environment is in good health."
fi
separator
printf "\n"

separator
print_header "Step 3: Verifying brew-cu extension for GUI Apps"
if ! brew tap | grep -q "buo/cask-upgrade"; then
    echo -e "${YELLOW}Extension 'brew-cu' not found. Installing now...${NC}"
    brew tap buo/cask-upgrade
else
    echo -e "${GREEN}Extension 'brew-cu' is already active.${NC}"
fi
separator
printf "\n"

separator
print_header "Step 4: Executing comprehensive upgrades (Formulae & Casks)"
echo -e "${NC}"

# 使用前请先修改这里的密码！！
SUDO_PWD=""

# 1. 升级命令行工具 (Formulae)
echo -e "\n${CYAN}>>> [1/2] Upgrading CLI Formulae (brew upgrade --formula)...${NC}"
brew upgrade --formula

# 2. 升级图形界面软件 (Casks)
echo -e "\n${CYAN}>>> [2/2] Upgrading GUI Casks (brew cu -yaq)...${NC}"

# 强制注入环境变量，确保终端输出依然保留 ANSI 颜色格式
export HOMEBREW_COLOR=1

# --- 核心修复：环境变量宽度兜底 ---
# 强制将 Bash 计算好的真实终端宽度传递给底层，防止 Ruby 绘表时发生 negative argument 崩溃
export COLUMNS="$TERMINAL_WIDTH"

# 使用 Python 原生 PTY 自建极简轮询引擎
python3 -c '
import pty, os, sys, select, fcntl, termios, struct

# 将传入的明文密码转换为底层的原始字节流，并在末尾追加换行符模拟按下回车键
pwd = sys.argv[1].encode() + b"\n"
cmd = sys.argv[2:]

# 在操作系统底层分叉出一个携带完整伪终端(PTY)特性的子进程
pid, fd = pty.fork()

if pid == 0:
    # --- 逻辑分支：子进程空间 ---
    # 使用 execvp 顶替当前进程，正式开始执行 brew cu 命令
    os.execvp(cmd[0], cmd)
else:
    # --- 逻辑分支：父进程空间 (监控端) ---

    # --- 核心修复：物理终端尺寸投影 ---
    # 尝试捕获外层真实物理终端的行列尺寸，并硬塞进伪终端的文件描述符中
    try:
        # 打包一个空的 4 短整型结构体准备接收数据
        s = struct.pack("HHHH", 0, 0, 0, 0)
        # 通过 ioctl 系统调用，向操作系统的标准输出请求 TIOCGWINSZ (获取窗口大小)
        winsize = fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, s)
        # 将获取到的真实尺寸，立刻通过 TIOCSWINSZ (设置窗口大小) 写入刚刚生成的伪终端 fd 中
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        # 如果当前环境不是交互式终端(如 crontab 后台运行)，捕获异常静默跳过，
        # 此时外层 bash 注入的 export COLUMNS="$TERMINAL_WIDTH" 将作为完美兜底
        pass

    exit_code = 0
    while True:
        try:
            # 开启 IO 多路复用轮询，设置 0.1 秒的极短超时时间防止物理死锁
            rfds, _, _ = select.select([fd], [], [], 0.1)

            # 如果伪终端有数据吐出
            if fd in rfds:
                # 以 8KB 为块，读取原始字节流 (Raw Bytes)
                data = os.read(fd, 8192)
                # 读到空字节代表通道已被操作系统关闭
                if not data:
                    break

                # 在纯净字节流中精准狙击 sudo 发出的密码请求信号
                if b"assword:" in data or b"Password:" in data:
                    # 发现目标，将密码字节流强行注入到伪终端标准输入中
                    os.write(fd, pwd)

                # 将读取到的原汁原味的字节流直接刷入真实屏幕，确保 Emoji 不乱码
                os.write(sys.stdout.fileno(), data)

        except OSError:
            # 捕获对侧进程已死导致的 EIO 错误，安全打破循环
            break

        # 主动进程心跳侦测：非阻塞探查子进程生死
        try:
            wpid, wstatus = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                if os.WIFEXITED(wstatus):
                    exit_code = os.WEXITSTATUS(wstatus)
                else:
                    exit_code = 1
                break
        except ChildProcessError:
            break

    # 将真实状态码原样返回给外层的 shell
    sys.exit(exit_code)
' "$SUDO_PWD" brew cu -yaq

separator
printf "\n"

separator
print_header "Step 5: Cleaning up old files and caches (brew cleanup --prune=all)"
brew cleanup --prune=all
separator
printf "\n"

echo -e "${GREEN}All operations completed!${NC}"
printf "\n"
#!/bin/bash
# TeleBox 生产级部署脚本 (Refactored)
# 适用于 Debian / Ubuntu 体系

# 开启严格模式：遇到错误立即退出、禁止使用未定义变量、管道命令中任何子命令失败即失败
set -euo pipefail

# ==========================================
# 1. 全局常量配置区域
# ==========================================
readonly APP_DIR="$HOME/telebox"
readonly NODE_VERSION="20"
readonly GITHUB_REPO="https://github.com/TeleBoxDev/TeleBox.git"

# 定义终端颜色，提升可读性
readonly C_RED='\033[0;31m'
readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[1;33m'
readonly C_BLUE='\033[0;34m'
readonly C_NC='\033[0m'

# ==========================================
# 2. 核心工具函数区域
# ==========================================

# 标准化日志输出函数，便于后续统一接管日志输出流
log_info()  { echo -e "${C_GREEN}[INFO] $1${C_NC}"; }
log_warn()  { echo -e "${C_YELLOW}[WARN] $1${C_NC}"; }
log_err()   { echo -e "${C_RED}[ERROR] $1${C_NC}"; }
log_step()  { echo -e "\n${C_BLUE}==== $1 ====${C_NC}"; }

# 增强型错误处理函数：不仅输出行号，还输出具体失败的命令
handle_error() {
    local line_no=$1
    local failed_command=$2
    log_err "脚本执行中止！"
    log_err "故障位置: 第 ${line_no} 行"
    log_err "失败命令: ${failed_command}"
    exit 1
}

# 绑定 ERR 信号。$LINENO 获取行号，$BASH_COMMAND 获取触发错误的具体命令
trap 'handle_error ${LINENO} "${BASH_COMMAND}"' ERR

# ==========================================
# 3. 业务执行函数区域
# ==========================================

cleanup_env() {
    log_step "环境清理阶段"

    # 1. 优雅终止 PM2 托管的同名服务
    if command -v pm2 >/dev/null 2>&1; then
        log_info "正在清理 PM2 历史服务..."
        pm2 delete telebox 2>/dev/null || true
    fi

    # 2. 精准杀除残余进程，避免端口占用
    log_info "正在终止僵尸进程..."
    pkill -f "node.*telebox" 2>/dev/null || true
    sleep 1

    # 3. 安全清理应用目录
    if [ -d "$APP_DIR" ]; then
        log_info "正在移除旧应用目录: $APP_DIR"
        rm -rf "$APP_DIR"
    fi

    # 4. 修复通配符漏洞：仅删除确切的已知缓存目录，避免误删用户其他文件
    log_info "正在清理特定缓存..."
    rm -rf "$HOME/.telebox" 2>/dev/null || true
    # 如果有特定前缀的临时文件，应使用 find 精确匹配，例如：
    find /tmp -maxdepth 1 -name "telebox-*" -type f -delete 2>/dev/null || true
}

install_system_deps() {
    log_step "系统依赖核对与安装"

    # 检查核心构建工具是否完整
    if ! command -v curl >/dev/null || ! command -v git >/dev/null || ! dpkg -l | grep -q build-essential; then
        log_info "正在补全基础工具 (curl, git, build-essential)..."
        sudo apt-get update -y
        sudo apt-get install -y curl git build-essential
    else
        log_info "基础工具链已就绪，跳过安装。"
    fi

    # 幂等性检测：验证当前 Node.js 版本是否符合要求
    local need_install_node=true
    if command -v node >/dev/null 2>&1; then
        # 提取当前 node 版本的的主版本号，例如 v20.11.0 提取出 20
        local current_node_ver
        current_node_ver=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$current_node_ver" == "$NODE_VERSION" ]; then
            log_info "检测到 Node.js v${NODE_VERSION}.x 已正确安装，跳过覆盖安装。"
            need_install_node=false
        fi
    fi

    if $need_install_node; then
        log_info "开始安装 Node.js ${NODE_VERSION}.x 环境..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
}

deploy_application() {
    log_step "代码拉取与依赖构建"

    mkdir -p "$APP_DIR"
    cd "$APP_DIR"

    log_info "克隆目标仓库: $GITHUB_REPO"
    git clone "$GITHUB_REPO" .

    log_info "安装项目依赖 (开启本地离线缓存加速)..."
    # 保留 --no-audit，因为这属于第三方代码的部署，此处审计可能会阻断流程，
    # 但需注意这会让潜在的第三方 npm 依赖漏洞被忽略。
    npm install --prefer-offline --no-audit
}

interactive_login() {
    log_step "TeleBox 首次身份验证"

    log_warn ">>> 即将进入交互式登录模式 <<<"
    log_warn ">>> 1. 按提示输入您的 Telegram 账户信息"
    log_warn ">>> 2. 看到 'You should now be connected.' 字样后，手动按 CTRL+C 结束"
    echo -e "${C_GREEN}按 <回车键> 立即开始登录过程...${C_NC}"
    read -r

    # 暂时剥离严格报错与中断信号，保障用户正常中断 Node 进程而不引发脚本崩溃
    set +e
    trap - ERR
    trap 'log_info "\n捕获到中断信号，登录阶段结束，正在进入守护进程配置..."' SIGINT

    npm start || true

    # 恢复系统的严格状态
    trap - SIGINT
    trap 'handle_error ${LINENO} "${BASH_COMMAND}"' ERR
    set -e

    sleep 2
}

setup_pm2_daemon() {
    log_step "PM2 守护进程部署与开机自启"

    if ! command -v pm2 >/dev/null 2>&1; then
        log_info "全局安装 PM2 进程管理器..."
        sudo npm install -g pm2
    fi

    mkdir -p "$APP_DIR/logs"

    log_info "生成 PM2 生产级 Ecosystem 配置..."
    cat > "$APP_DIR/ecosystem.config.js" <<'EOF'
module.exports = {
  apps: [{
    name: "telebox",
    script: "npm",
    args: "start",
    cwd: __dirname,
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    merge_logs: true,
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 4000,
    env: {
      NODE_ENV: "production"
    }
  }]
}
EOF

    cd "$APP_DIR"
    log_info "启动 TeleBox 服务集群..."
    pm2 start ecosystem.config.js
    pm2 save

    log_info "注册 Systemd 开机自启服务..."
    # 修复漏洞：不再使用脆弱的管道注入，而是利用 env 指定环境变量，显式执行 PM2 内部的启动脚本
    # 这样确保了在不同 npm 安装路径和不同权限下的极高执行成功率
    local node_path
    local pm2_path
    node_path=$(dirname "$(command -v node)")
    pm2_path=$(command -v pm2)

    if sudo env PATH="$PATH:$node_path" "$pm2_path" startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1; then
        log_info "开机自启配置成功！"
    else
        log_warn "自动注册自启失败，请在安装完成后手动运行命令: pm2 startup"
    fi
}

# ==========================================
# 4. 主干流程调度
# ==========================================

main() {
    log_step "TeleBox 全自动部署矩阵"
    log_warn "此操作将清除旧有的 TeleBox 数据，但不干扰其他 PM2 服务。"

    # 交互确认防护
    read -p "确认执行初始化部署? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warn "操作已由用户主动取消。"
        exit 0
    fi

    # 严格按照顺序执行子模块
    cleanup_env
    install_system_deps
    deploy_application
    interactive_login
    setup_pm2_daemon

    log_step "部署已顺利完结"
    log_info "当前服务状态如下："
    pm2 status telebox || true
    log_info "使用指南："
    log_info "  - 监控运行日志: pm2 logs telebox"
    log_info "  - 重启核心服务: pm2 restart telebox"
}

# 透传所有外部参数，触发主干执行
main "$@"
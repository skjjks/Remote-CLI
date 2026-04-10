# Remote CLI

通过飞书聊天远程控制终端和 AI 编码助手的 Bot。支持 Claude Code 和 opencode 双后端。

## 功能

**三模式运行：**
- **Terminal 模式** — 在飞书中执行 shell 命令，支持交互式程序（vim、htop、less 等）
- **Claude 模式** — 与 Claude Code 对话，支持流式输出和智能卡片
- **Opencode 模式** — 与 opencode 对话，同样的 tmux 架构，可随时切换

**交互式终端：**
- 自动检测 vim/nano/htop 等交互式程序，切换为原始输入模式（不追加 Enter）
- `!esc`、`!enter`、`!tab` 等快捷键命令
- `!screen` 查看当前终端屏幕
- `!raw` / `!raw off` 手动切换原始模式

**会话管理：**
- 多会话支持，tmux 持久化
- Bot 重启后自动重连
- 24 小时不活跃自动清理
- 命令历史记录

## 快速开始

### 前置条件

- Node.js >= 18
- tmux
- 飞书开放平台应用（需要 Bot 能力）

### 安装

```bash
git clone <repo-url>
cd remote-cli
npm install
```

### 配置

复制环境变量模板并填写：

```bash
cp .env.example .env
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | Yes | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | Yes | 飞书应用 App Secret |
| `ALLOWED_USERS` | Yes | 允许使用的飞书用户 ID，逗号分隔 |
| `PORT` | No | HTTP 端口（默认 3000） |
| `TERMINAL_COLS` | No | 终端宽度（默认 80） |
| `TERMINAL_ROWS` | No | 终端高度（默认 24） |
| `CLAUDE_TIMEOUT` | No | Claude 响应超时，毫秒（默认 300000） |
| `CLAUDE_DEFAULT_MODE` | No | Claude 权限模式：`default` 或 `auto` |
| `OPENCODE_TIMEOUT` | No | opencode 响应超时，毫秒（默认 300000） |
| `OPENCODE_DEFAULT_MODE` | No | opencode 模式：`default` 或 `auto`（auto = --pure） |

### 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

## 生产部署（PM2）

使用 PM2 管理进程，支持自动重启、日志管理：

```bash
# 首次部署（构建 + 启动）
npm run deploy

# 查看状态
npm run pm2:status

# 查看日志
npm run pm2:logs

# 重启
npm run pm2:restart

# 停止
npm run pm2:stop

# 开机自启（运行后按提示操作）
pm2 startup
pm2 save
```

确保 `.env` 文件已配置好后再部署。

## 命令

| 命令 | 说明 |
|------|------|
| `!sh <command>` | 执行 shell 命令 |
| `!claude <prompt>` | 发送消息给 Claude |
| `!opencode <prompt>` / `!oc` | 发送消息给 opencode |
| `!new` | 创建新 Claude 会话 |
| `!list` | 列出所有会话 |
| `!switch <id>` | 切换会话 |
| `!kill <id>` | 终止会话 |
| `!interrupt` | 中断当前操作（Ctrl+C） |
| `!key <key>` | 发送特殊键（escape, ctrl+c 等） |
| `!esc` / `!enter` / `!tab` | 快捷键 |
| `!up` / `!down` / `!left` / `!right` | 方向键 |
| `!raw` | 强制进入原始输入模式 |
| `!raw off` | 恢复自动检测 |
| `!screen` | 查看当前终端屏幕 |
| `!history` | 查看命令历史 |
| `!cd <path>` | 切换 Claude 工作目录 |
| `!mode auto\|default` | 切换 Claude 权限模式 |

直接发消息（不带 `!` 前缀）会发送到当前活跃会话（Claude 或 opencode）。

## 架构

```
飞书 WebSocket ──→ 消息路由 (index.ts)
                      ├──→ Terminal 处理器 (handlers/terminal.ts)
                      │      └── tmux 会话
                      ├──→ AI 处理器 (handlers/ai.ts)
                      │      ├── Claude Code tmux 会话
                      │      └── opencode tmux 会话
                      ├──→ 会话管理 (handlers/session.ts)
                      └──→ 卡片动作 (handlers/card-action.ts)
```

**核心模块：**

| 目录 | 说明 |
|------|------|
| `src/index.ts` | 消息路由 + 入口 |
| `src/state.ts` | 共享状态 |
| `src/config.ts` | 环境变量配置 |
| `src/handlers/` | 命令处理器 |
| `src/bot/` | 飞书 API 客户端 + 卡片构建 |
| `src/terminal/` | tmux 封装 + 交互检测 |
| `src/claude/` | Claude Code 进程管理 |

## 开发

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch

# 代码检查
npm run lint

# 构建
npm run build
```

## License

MIT

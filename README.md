<p align="center">
  <h1 align="center">Remote CLI</h1>
  <p align="center">
    <strong>在飞书中远程操控终端和 AI 编码助手</strong>
  </p>
  <p align="center">
    <a href="#快速开始">快速开始</a> &bull;
    <a href="#功能特性">功能特性</a> &bull;
    <a href="#命令参考">命令参考</a> &bull;
    <a href="#架构设计">架构设计</a>
  </p>
</p>

---

**Remote CLI** 是一个飞书 Bot，让你在手机或电脑的飞书聊天窗口中远程控制服务器终端、与 AI 编码助手（Claude Code / opencode）对话。就像把 VS Code Terminal + AI Copilot 装进了飞书。

## 为什么需要它？

- 在手机上随时查看服务器状态、执行命令
- 随时随地与 Claude Code / opencode 对话，让 AI 帮你写代码、审查 PR、修 Bug
- 一键连接工程云服务器，自动化 SSH 堡垒机认证流程
- 不需要 SSH 客户端，一个飞书就够了
- 支持 vim、htop 等交互式程序的远程操作

## 功能特性

### AI 双后端

同时支持 **Claude Code** 和 **opencode** 两个 AI 编码助手，通过 SDK 获取结构化输出：

- `!claude` — 使用 Claude Agent SDK，支持 skills、工具权限确认
- `!opencode` — 使用 opencode SDK，支持多 provider 模型切换
- `!model` — 随时切换模型（opus / sonnet / haiku / gemini / gpt-5 等）
- 流式输出 — AI 回复实时更新飞书卡片
- 会话恢复 — Bot 重启后自动恢复上次对话

### 工程云连接

一键连接小米工程云服务器，自动化 SSH 堡垒机多步认证：

- `!cloud` — 自动 SSH → 认证 → sync → 进入工程云，全程飞书卡片实时显示
- 支持扫码认证（飞书卡片显示扫码链接）和密码认证（自动填入密码，提示输入 token）
- 连接后与本地终端操作完全一致

### 远程终端

通过飞书聊天执行 shell 命令，支持完整的终端交互：

- `!sh <command>` — 执行任意 shell 命令
- 自动检测 vim/nano/htop 等交互式程序，切换原始输入模式
- `!esc` / `!enter` / `!tab` / `!up` / `!down` / `!backspace` — 快捷键发送
- `!screen` — 随时查看终端当前画面
- `!raw` / `!raw off` — 手动切换输入模式

### 会话管理

- `!new` / `!new claude` / `!new oc` — 创建终端 / Claude / opencode 会话
- 多会话共存 — Claude、opencode、终端、工程云会话可同时运行
- `!switch <id>` — 在会话间自由切换，AI 对话上下文完整保留
- `!cd <path>` — 切换 AI 工作目录，不销毁当前对话
- 会话归属隔离 — 每个飞书会话只能看到和操作自己的 session
- 24 小时不活跃自动清理，Bot 重启后自动重连

### 智能卡片

AI 回复以飞书卡片呈现，信息丰富：

- 卡片标题显示后端名称 + Session ID + 当前状态
- 卡片底部显示模型、工作路径、Token 消耗、费用
- 工具权限确认以飞书卡片交互
- Markdown 表格自动转换为飞书原生表格组件
- Claude 橙色、opencode 灰色、终端蓝色、CloudDev 蓝色 — 一眼区分

### 终端输出优化

- ANSI 转义序列自动清理 — 彩色命令输出不再显示乱码
- 语法高亮检测 — JSON / diff / YAML 输出自动匹配语法高亮
- 错误标色 — 输出包含错误信息时卡片标题变红
- 短输出优化 — 3 行以内的简短输出以加粗文本展示，不用代码块
- 执行耗时 — 卡片底部显示命令执行时间

## 快速开始

### 前置条件

- **Node.js** >= 18
- **tmux**（终端模式使用）
- **飞书开放平台应用**（需要 Bot 能力 + WebSocket 模式）
- **Anthropic API Key**（Claude 使用）
- **opencode**（可选，opencode 模式使用）

### 安装

```bash
git clone https://github.com/your-username/remote-cli.git
cd remote-cli
npm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env 填入你的飞书应用凭据和 API Key
```

<details>
<summary><b>完整配置项</b></summary>

| 变量 | 必填 | 说明 | 默认值 |
|------|:----:|------|--------|
| `FEISHU_APP_ID` | Yes | 飞书应用 App ID | — |
| `FEISHU_APP_SECRET` | Yes | 飞书应用 App Secret | — |
| `ALLOWED_USERS` | Yes | 允许使用的飞书用户 ID，逗号分隔 | — |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API Key | — |
| `ANTHROPIC_BASE_URL` | No | API 代理地址 | — |
| `TERMINAL_COLS` | No | 终端宽度 | `200` |
| `TERMINAL_ROWS` | No | 终端高度 | `24` |
| `CLAUDE_TIMEOUT` | No | Claude 响应超时（ms） | `300000` |
| `CLAUDE_DEFAULT_MODE` | No | 权限模式 `default` / `auto` | `default` |
| `OPENCODE_TIMEOUT` | No | opencode 响应超时（ms） | `300000` |
| `CLOUDDEV_USERNAME` | No | 工程云用户名（邮箱前缀） | — |
| `CLOUDDEV_IMAGE_TYPE` | No | 镜像类型 `android` / `vela` | `android` |
| `CLOUDDEV_RELAY_HOST` | No | 堡垒机地址 | `relay.xiaomi.com` |
| `CLOUDDEV_EMAIL_PASSWORD` | No | 邮箱密码（自动填入，仍需手动输入 token） | — |

</details>

### 启动

```bash
# 开发模式
npm run dev

# 生产部署（PM2）
npm run deploy
```

### 验证

在飞书中给 Bot 发消息：

```
!sh echo hello world
```

如果返回 `hello world`，恭喜 -- 一切就绪！

## 命令参考

### AI 交互

| 命令 | 说明 |
|------|------|
| `!claude <prompt>` | 发送消息给 Claude |
| `!opencode <prompt>` / `!oc` | 发送消息给 opencode |
| `!model` | 查看可用模型列表 |
| `!model <name>` | 切换模型（如 `!model sonnet`） |
| `!model reset` | 恢复默认模型 |
| 直接发文字 | 发送到当前活跃的 AI 会话 |

### 工程云

| 命令 | 说明 |
|------|------|
| `!cloud` | 连接工程云（使用 .env 配置） |
| `!cloud <username>` | 指定用户名连接 |

### 终端操作

| 命令 | 说明 |
|------|------|
| `!sh <command>` | 执行 shell 命令 |
| `!screen` / `!sc` | 查看当前终端屏幕 |
| `!key <key>` | 发送特殊键 |
| `!esc` / `!enter` / `!tab` | 快捷键 |
| `!backspace` / `!bs` | 退格键 |
| `!up` / `!down` / `!left` / `!right` | 方向键 |
| `!ctrl+c` / `!ctrl+d` / `!ctrl+z` | Ctrl 组合键 |
| `!raw` | 强制原始输入模式 |
| `!raw off` | 恢复自动检测 |

### 会话管理

| 命令 | 说明 |
|------|------|
| `!new` | 创建新终端会话 |
| `!new claude` | 创建新 Claude 会话 |
| `!new opencode` / `!new oc` | 创建新 opencode 会话 |
| `!list` | 列出当前会话 |
| `!switch <id>` | 切换会话 |
| `!kill <id> [id2...]` | 终止一个或多个会话 |
| `!kill all` | 终止所有会话 |
| `!interrupt` | 中断当前操作（Ctrl+C） |
| `!history` | 查看命令历史 |
| `!cd <path>` | 切换 AI 工作目录（保持对话上下文） |
| `!mode auto\|default` | 切换权限模式 |
| `!whoami` | 显示你的飞书用户 ID |

## 架构设计

```
                          ┌─────────────────────────────────┐
                          │         飞书 WebSocket           │
                          └──────────────┬──────────────────┘
                                         │
                          ┌──────────────▼──────────────────┐
                          │       消息路由 (index.ts)         │
                          └──┬───────┬───────┬───────┬──────┘
                             │       │       │       │
                ┌────────────▼─┐ ┌───▼────┐ ┌▼────┐ ┌▼──────────────┐
                │  Terminal     │ │   AI   │ │Cloud│ │    Session     │
                │  Handler     │ │Handler │ │ Dev │ │    Manager     │
                └──────┬───────┘ └───┬────┘ └──┬──┘ └───────────────┘
                       │             │         │
                ┌──────▼───────┐ ┌───▼───────┐ │
                │    tmux      │ │ AISession │ │
                │   (shell)    │◄┤  Driver   │ │
                │              │ │ ┌───────┐ │ │
                └──────▲───────┘ │ │Claude │ │ │
                       │         │ │opencode│ │ │
                       │         │ └───────┘ │ │
                       │         └───────────┘ │
                       │                       │
                       └───── CloudDev ────────┘
                              Connector
                         (SSH 状态机 + 自动化)
```

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 消息路由 | `src/index.ts` | 飞书消息分发、命令解析 |
| AI 驱动 | `src/ai/drivers/` | Claude SDK / opencode SDK 适配 |
| AI 管理 | `src/ai/manager.ts` | 统一接口、会话生命周期 |
| 终端处理 | `src/handlers/terminal.ts` | shell 命令、交互检测、快捷键 |
| 卡片构建 | `src/bot/card.ts` | 飞书卡片模板、表格转换 |
| 飞书客户端 | `src/bot/feishu.ts` | API 封装、消息收发 |
| 会话持久化 | `src/terminal/session.ts` | 会话存储、重连、清理 |
| 工程云连接 | `src/clouddev/connector.ts` | SSH 状态机、自动化认证流程 |
| URL 提取 | `src/clouddev/qr-extract.ts` | 终端文本 URL/认证检测 |

## 生产部署

### PM2（推荐）

```bash
# 首次部署
npm run deploy

# 日常操作
npm run pm2:status    # 查看状态
npm run pm2:logs      # 查看日志
npm run pm2:restart   # 重启
npm run pm2:stop      # 停止

# 开机自启
pm2 startup && pm2 save
```

## 开发

```bash
npm test              # 运行测试
npm run test:watch    # 监听模式
npm run lint          # 代码检查
npm run build         # 构建
```

### 项目结构

```
src/
  index.ts              # 入口 + 消息路由
  state.ts              # 共享状态
  config.ts             # 环境变量配置
  ai/
    manager.ts           # AI 会话管理器
    types.ts             # 接口定义
    drivers/
      claude-sdk.ts      # Claude Agent SDK 驱动
      opencode-sdk.ts    # opencode SDK 驱动
  bot/
    card.ts              # 飞书卡片构建
    feishu.ts            # 飞书 API 客户端
  clouddev/
    connector.ts         # 工程云 SSH 连接状态机
    qr-extract.ts        # URL/认证提取
  handlers/
    ai.ts                # AI 命令处理
    terminal.ts          # 终端命令处理
    session.ts           # 会话管理命令
    clouddev.ts          # 工程云命令处理
  terminal/
    tmux.ts              # tmux 封装
    session.ts           # 会话持久化
    interactive.ts       # 交互式程序检测
```

## License

MIT

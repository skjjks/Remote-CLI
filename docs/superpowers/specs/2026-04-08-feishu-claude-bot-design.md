# Feishu Claude Bot - Smart Terminal Integration

## Overview

Upgrade the existing Feishu terminal bot to deeply integrate with Claude Code via its JSON streaming API, replacing raw terminal output with smart, dynamically-partitioned Feishu cards. The bot supports two operating modes: **Claude Mode** (primary) for AI-assisted coding, and **Terminal Mode** for direct shell access.

## Architecture

```
+----------------------------------------------+
|              Feishu Bot Layer                 |
|  WebSocket <-> Message Router <-> Card Engine |
+---------------+------------------+-----------+
                |                  |
    +-----------v---------+  +-----v-----------+
    |  Claude Manager     |  | Terminal Manager |
    |  (JSON stream mode) |  | (PTY/tmux mode)  |
    |                     |  |                  |
    |  claude -p          |  |  node-pty        |
    |  --stream-json      |  |  + tmux          |
    |  --verbose          |  |  + ANSI strip    |
    +---------------------+  +------------------+
```

### Dual-Track Design

- **Claude Mode**: Spawns `claude -p --output-format stream-json --verbose` as a child process. Parses structured JSON events to build smart Feishu cards. Multi-turn conversations use `--resume <session-id>`.
- **Terminal Mode**: Uses existing PTY/tmux infrastructure for direct shell commands. Output displayed as code-block cards.

Both modes share the same card engine but with different data sources.

## Claude Manager

### Process Lifecycle

The Claude Manager spawns and manages Claude Code child processes:

```typescript
interface ClaudeSession {
  id: string;
  process: ChildProcess;
  conversationId: string;       // Feishu conversation ID
  claudeSessionId?: string;     // Claude Code session ID (for --resume)
  state: 'initializing' | 'thinking' | 'tool_calling' | 'waiting_permission' | 'completed' | 'error';
  permissionMode: 'default' | 'auto';
  allowedTools: string[];
}
```

### Launch Parameters

```bash
claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --permission-mode default \
  --resume <session-id> \       # Multi-turn conversations
  --allowedTools "Read Glob Grep" \  # Pre-approved tools
  "<user prompt>"
```

### JSON Event Types

Events are newline-delimited JSON. The key types:

| Event | Description | Action |
|-------|-------------|--------|
| `system` (subtype: `init`) | Session initialization | Extract `session_id`, store it. Send "session started" card. |
| `system` (subtype: `hook_*`) | Hook lifecycle | Ignore (internal). |
| `assistant` | Assistant message with content blocks | Parse `content` array for `text` and `tool_use` blocks. Build cards. |
| `result` | Final result | Send completion card with stats. Check `permission_denials`. |

### Event Processing Flow

With `--include-partial-messages`, `assistant` events are emitted incrementally as Claude generates output. Without it, one complete `assistant` event is emitted per turn. We use partial messages for real-time card updates.

A single Claude `-p` invocation may produce multiple turns (assistant -> tool execution -> assistant -> ...) as Claude iterates. Each turn generates its own `assistant` event(s).

1. **`system/init`** -> Extract `session_id`, store for `--resume`. Send initialization card.
2. **`assistant`** (partial) -> Parse content blocks incrementally:
   - `text` block -> Stream text to card (throttled updates)
   - `tool_use` block -> Build tool call card (tool name + parameters preview)
3. **`assistant`** (complete, with tool results from previous turn) -> Update tool result section of the card.
4. **`result`** -> Send completion card (duration, cost, token usage). If `permission_denials` is non-empty, trigger permission flow.

### Multi-Turn Conversations

Each `claude -p` invocation is a single-shot process. For multi-turn dialogue:

1. First message: `claude -p --output-format stream-json --verbose "user prompt"`
2. Capture `session_id` from `system/init` event
3. Next message: `claude -p --output-format stream-json --verbose --resume <session-id> "follow-up"`

The `--resume` flag loads the previous conversation context.

### JSON Stream Parser

Line-based parser that handles newline-delimited JSON:

```typescript
class ClaudeStreamParser {
  private buffer: string = '';

  feed(chunk: string): ClaudeEvent[] {
    this.buffer += chunk;
    const events: ClaudeEvent[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        events.push(JSON.parse(line));
      }
    }
    return events;
  }
}
```

## Smart Card System

### Card Types

| Card Type | Trigger | Sections |
|-----------|---------|----------|
| Init Card | `system/init` event | Title + session info |
| Text Output Card | `text` block in `assistant` | Title + Markdown content |
| Tool Call Card | `tool_use` block in `assistant` | Title + tool name + parameter code block + status |
| Tool Result Card | Tool execution complete | Title + output code block (truncated for long output + "View full" button) |
| Permission Card | Permission denial detected | Title + operation description + Allow/Deny/Always Allow buttons |
| Completion Card | `result` event | Title + final result + stats (duration, cost) |
| Terminal Output Card | Terminal mode output | Title + code block |

### Card Update Strategy (Hybrid Mode)

- **Short output** (< 2000 chars): Send one card, update via Feishu `PATCH /open-apis/im/v1/messages/:message_id` API
- **Long output** (>= 2000 chars): Stop updating card. Show last screen of content + "View full output" button
- **Update throttle**: Minimum 500ms between card updates to avoid Feishu API rate limits

### Card Structure

Tool Call Card:
```
+-------------------------------------+
| [icon] Bash                         |  <- Title (tool name + icon)
+-------------------------------------+
| $ ls -la src/                       |  <- Parameters (code block)
+-------------------------------------+
| total 32                            |  <- Output (code block, live update)
| drwxrwxr-x  4 user  4096 ...       |
| -rw-rw-r--  1 user  2104 config.ts |
+-------------------------------------+
| Done - 1.2s                         |  <- Status
+-------------------------------------+
```

Permission Card:
```
+-------------------------------------+
| Warning: Confirmation Required      |
+-------------------------------------+
| Claude wants to execute:            |
| $ rm -rf node_modules               |
+-------------------------------------+
| [Allow]  [Deny]  [Always Allow]     |  <- Action buttons
+-------------------------------------+
```

Text Output Card:
```
+-------------------------------------+
| Claude                              |  <- Title
+-------------------------------------+
| I've analyzed the codebase and      |  <- Markdown content
| here's what I found:                |
|                                     |
| 1. The config module...             |
+-------------------------------------+
```

Completion Card:
```
+-------------------------------------+
| Session Complete                    |
+-------------------------------------+
| Duration: 45s                       |
| Tokens: 12,345 in / 2,345 out      |
| Cost: $0.15                         |
+-------------------------------------+
```

### Tool Icon Mapping

| Tool | Display |
|------|---------|
| Bash | `$ Bash` |
| Edit | `Edit` |
| Write | `Write` |
| Read | `Read` |
| Glob | `Glob` |
| Grep | `Grep` |
| WebSearch | `WebSearch` |
| Other | Tool name as-is |

## Permission Handling

### Flow

1. Claude runs with `--permission-mode default`
2. If a tool requires permission, it gets denied (no TTY to prompt)
3. `result` event includes `permission_denials` array
4. Bot sends Permission Card to user with operation details
5. User clicks Allow/Deny/Always Allow
6. On Allow: Re-run with `--resume <session-id> --allowedTools "<approved tools>"`
7. "Always Allow" adds the tool to the session's persistent `allowedTools` list

### Permission State

```typescript
interface PermissionState {
  conversationId: string;
  allowedTools: string[];       // User-approved tools for this session
  claudeSessionId: string;
}
```

### Auto Mode

Users can switch to auto mode via `!mode auto`, which runs Claude with `--dangerously-skip-permissions`. Suitable for trusted environments. Default is `--permission-mode default`.

## Command System

| Command | Function | Mode |
|---------|----------|------|
| (plain message) | Send to active Claude session | Claude |
| `!sh <cmd>` | Execute shell command in Terminal mode | Terminal |
| `!claude <prompt>` | Start new Claude session with explicit prompt | Claude |
| `!new` | Create new Claude session | Claude |
| `!list` | List all sessions (Claude + Terminal) | Both |
| `!switch <id>` | Switch active session | Both |
| `!kill <id>` | Terminate session | Both |
| `!interrupt` | Send interrupt (kill process / Ctrl-C) | Both |
| `!mode auto\|default` | Switch permission mode | Claude |
| `!key <key>` | Send special key (Terminal mode only) | Terminal |

### Message Routing

1. Plain message -> Route to active session
   - Active session is Claude -> Spawn new `claude -p --resume` process
   - Active session is Terminal -> Write to PTY
   - No active session -> Auto-create Claude session
2. Card button click -> Handle permission confirmation or option selection
3. `!interrupt` -> Claude session: kill child process; Terminal session: send SIGINT

### Default Behavior

Messages without prefix default to Claude mode (primary use case). Use `!sh` prefix for direct shell access.

## File Structure

```
src/
  index.ts                    # Entry point, message routing (refactor)
  config.ts                   # Configuration (unchanged)
  bot/
    feishu.ts                 # Feishu API (minor changes - add card update)
    card.ts                   # Card builder (major refactor - smart partitioning)
    message.ts                # Message formatting (minor changes)
  claude/
    manager.ts                # Claude process manager (new - core)
    parser.ts                 # JSON stream parser (new)
    types.ts                  # Claude event type definitions (new)
  terminal/
    session.ts                # Session management (refactor - dual type support)
    pty.ts                    # PTY management (minor changes)
    prompt.ts                 # Prompt detection (unchanged - Terminal mode only)
    tmux.ts                   # Tmux wrapper (unchanged)
```

### Change Summary

- **New**: `src/claude/` directory (3 files: manager.ts, parser.ts, types.ts)
- **Major refactor**: `src/bot/card.ts` (smart partitioning), `src/terminal/session.ts` (dual type)
- **Minor changes**: `src/index.ts` (routing), `src/bot/feishu.ts` (card update API), `src/bot/message.ts`
- **Unchanged**: `src/terminal/tmux.ts`, `src/terminal/prompt.ts`, `src/config.ts`

## Session Management

### Unified Session Model

```typescript
interface Session {
  id: number;
  type: 'claude' | 'terminal';
  conversationId: string;
  created: string;
  // Claude-specific
  claudeSessionId?: string;
  permissionMode?: 'default' | 'auto';
  allowedTools?: string[];
  // Terminal-specific
  tmuxName?: string;
}
```

Sessions are persisted to `data/sessions.json`. Claude sessions store the `claudeSessionId` for `--resume` support. Terminal sessions store `tmuxName` for tmux reconnection.

### Session Reconnection

On bot restart:
- Terminal sessions: Check if tmux sessions still exist (existing behavior)
- Claude sessions: Session IDs are preserved. Next message uses `--resume` to continue.

## Error Handling

| Scenario | Handling |
|----------|----------|
| Claude process crashes | Send error card with stderr content. Session marked as 'error'. |
| Claude process timeout | Kill after configurable timeout. Send timeout card. |
| Feishu API rate limit | Exponential backoff on card updates. Queue messages. |
| Invalid JSON in stream | Log warning, skip line, continue parsing. |
| Permission denied (all tools) | Send card explaining Claude cannot proceed without permissions. |

## Configuration

New environment variables:

```env
# Claude Configuration
CLAUDE_TIMEOUT=300000          # Max Claude process runtime (ms), default 5min
CLAUDE_DEFAULT_MODE=default    # Permission mode: default or auto
CLAUDE_CARD_UPDATE_INTERVAL=500  # Min ms between card updates
```

## Testing Strategy

- **Unit tests**: ClaudeStreamParser (JSON parsing), CardBuilder (card generation), event routing
- **Integration tests**: Claude process spawn/kill lifecycle, multi-turn resume, permission flow
- **Manual tests**: End-to-end Feishu interaction, card rendering, long output handling

# Opencode Support

Add opencode as a second AI backend alongside Claude Code, sharing the same tmux-based architecture. Users switch between backends via `!opencode` and `!claude` commands.

## Problem

The bot currently only supports Claude Code as the AI backend. Users want to use opencode (an open-source AI coding assistant) as an alternative, with the ability to switch between the two.

## Design

### Abstracted AI Backend

Refactor `ClaudeManager` into a generic `AIManager` that accepts a backend configuration. Both Claude and opencode share the same tmux management logic — only the startup command and output parsing differ.

```typescript
interface AIBackendConfig {
  name: string;                    // 'claude' | 'opencode'
  startCommand: string;            // 'claude' or 'opencode'
  startCommandAuto: string;        // 'claude --dangerously-skip-permissions' or 'opencode --pure'
  promptPattern: RegExp;           // pattern to detect the input prompt (❯ for claude, > for opencode)
  uiChromePatterns: RegExp[];      // patterns to strip from output
}
```

The `AIManager` class (formerly `ClaudeManager`) is instantiated per-backend, each managing its own set of tmux sessions.

### Session Types

`SessionInfo.type` expands from `'claude' | 'terminal'` to `'claude' | 'opencode' | 'terminal'`.

### Commands

| Command | Action |
|---------|--------|
| `!opencode <prompt>` | Create/send to opencode session |
| `!claude <prompt>` | Create/send to Claude session (unchanged) |
| Direct message | Send to currently active session (any backend) |

### Configuration

Add to `config.ts`:

```typescript
opencode: {
  timeout: number;         // default: 300000 (same as Claude)
  defaultMode: string;     // 'default' or 'auto' (auto = --pure)
};
```

Environment variables:
- `OPENCODE_TIMEOUT` (default: 300000)
- `OPENCODE_DEFAULT_MODE` (default: 'default')

### Code Changes

#### Rename and refactor `src/claude/manager.ts` → `src/ai/manager.ts`

1. Rename `ClaudeManager` → `AIManager`
2. Rename `ClaudeSession` → `AISession`
3. Rename `ClaudeManagerCallbacks` → `AIManagerCallbacks`
4. Rename `ClaudeMetadata` → `AIMetadata`
5. Accept `AIBackendConfig` in constructor
6. Use config's `startCommand` / `startCommandAuto` instead of hardcoded `'claude'`
7. Keep the tmux management logic, polling, menu detection, output cleaning unchanged
8. Keep `src/claude/` directory for `parser.ts` and `types.ts` (shared event types)

#### Update `src/handlers/claude.ts` → `src/handlers/ai.ts`

1. Create two `AIManager` instances: one for Claude, one for opencode
2. `handleClaudeCommand` and `handleOpencodeCommand` both delegate to a shared `handleAICommand(conversationId, prompt, backend)` function
3. `handleCd` works with whichever backend the current session uses

#### Update `src/terminal/session.ts`

1. `SessionInfo.type` becomes `'claude' | 'opencode' | 'terminal'`
2. Add `createOpencodeSession()` method (mirrors `createClaudeSession()`)

#### Update `src/index.ts`

1. Add `!opencode` / `!oc` command routing
2. Import from `./handlers/ai` instead of `./handlers/claude`

#### Update `src/bot/card.ts`

1. Help card adds `!opencode` / `!oc` command

#### Update `src/config.ts`

1. Add `opencode` config section

### Vim Workflow Example

```
User sends: !opencode help me refactor this function
           → creates opencode tmux session, sends prompt
           → polls capture-pane, streams output via cards

User sends: !claude explain this code
           → switches to Claude session
           → same tmux polling mechanism

User sends: follow up question
           → goes to last active session (whichever it was)
```

## Testing

- Unit test: `AIManager` starts opencode with correct command
- Unit test: `AIManager` starts Claude with correct command
- Unit test: `!opencode` creates session with type 'opencode'
- Unit test: `!claude` creates session with type 'claude'
- Unit test: direct message routes to correct backend
- Integration test: switching between backends preserves sessions

# Interactive Terminal Mode

Support interactive terminal programs (vim, nano, htop, less, etc.) in the Feishu remote terminal bot by auto-detecting the foreground process and switching input behavior accordingly.

## Problem

The terminal bot always appends Enter after sending keystrokes via `tmux send-keys`. This breaks interactive programs where individual keystrokes matter (e.g., `i` in vim should enter insert mode, not type `i` + Enter).

## Design

### Mode Detection

Query the foreground process of the tmux pane on each message:

```
tmux display-message -p -t <session> '#{pane_current_command}'
```

Returns the process name: `bash`, `vim`, `nano`, `htop`, etc.

Maintain a set of known interactive programs:

```typescript
const INTERACTIVE_PROGRAMS = new Set([
  'vim', 'vi', 'nvim', 'nano', 'emacs',    // editors
  'htop', 'top', 'btop',                     // monitors
  'less', 'more', 'man',                     // pagers
  'python', 'python3', 'node', 'irb',        // REPLs
  'mysql', 'psql', 'redis-cli',              // database clients
  'fzf', 'tig', 'lazygit',                   // TUI tools
]);
```

When the foreground process is in this set, the session enters **raw input mode**. When it returns to a shell (bash/zsh/fish), normal mode resumes automatically.

### Manual Override

Users can force mode with:
- `!raw` — enter raw input mode (overrides auto-detection)
- `!raw off` — clear manual override, resume auto-detection

The manual override is stored in `SessionInfo.rawMode?: boolean | undefined`:
- `undefined` — auto-detect based on foreground process (default)
- `true` — forced raw mode (ignores auto-detection)

`!raw off` resets `rawMode` to `undefined` (not to `false`), so auto-detection resumes.

### Input Behavior

| Scenario | Normal Mode (shell) | Raw Mode (interactive program) |
|----------|--------------------|---------------------------------|
| Send `ls -la` | `send-keys "ls -la" Enter` | `send-keys "ls -la"` (no Enter) |
| Send `i` | `send-keys "i" Enter` | `send-keys "i"` |
| Send `!enter` | sends Enter key | sends Enter key |
| Send `!esc` | sends Escape key | sends Escape key |

### Shortcut Commands

New shortcut commands for special keys. These work in both modes:

| Command | Action | tmux send-keys |
|---------|--------|----------------|
| `!esc` | Send Escape | `Escape` |
| `!enter` | Send Enter | `Enter` |
| `!tab` | Send Tab | `Tab` |
| `!up` | Send Up arrow | `Up` |
| `!down` | Send Down arrow | `Down` |
| `!left` | Send Left arrow | `Left` |
| `!right` | Send Right arrow | `Right` |
| `!ctrl+c` | Send Ctrl+C | `C-c` |
| `!ctrl+d` | Send Ctrl+D | `C-d` |
| `!ctrl+z` | Send Ctrl+Z | `C-z` |
| `!raw` | Force raw mode on | (mode switch) |
| `!raw off` | Resume auto-detection | (mode switch) |

These shortcuts are aliases for `!key <name>` — `!esc` is equivalent to `!key escape`.

### Screen Capture Feedback

After each keystroke in raw mode, auto-capture the tmux pane and return a Feishu card showing the current terminal screen. This gives the user visual feedback of the program state (e.g., seeing vim's current buffer after pressing `i`).

The capture uses the existing `tmux capture-pane` mechanism. A short delay (300-500ms) is applied before capture to let the program process the input.

### Vim Workflow Example

```
User sends: !sh vim config.yaml     → opens vim (auto-detects raw mode)
User sends: i                        → send-keys "i" (enter insert mode)
User sends: server: localhost        → send-keys "server: localhost"
User sends: !enter                   → send-keys Enter (new line)
User sends: port: 8080               → send-keys "port: 8080"
User sends: !esc                     → send-keys Escape (back to normal)
User sends: :wq                      → send-keys ":wq"
User sends: !enter                   → send-keys Enter (save and quit)
                                     → auto-detects back to bash → normal mode
```

## Code Changes

### `src/terminal/tmux.ts`

Add `getCurrentCommand()`:

```typescript
export async function getCurrentCommand(name: string): Promise<string> {
  return executeTmux([
    'display-message', '-p', '-t', name,
    '#{pane_current_command}'
  ]);
}
```

### `src/terminal/session.ts`

Add `rawMode` field to `SessionInfo`:

```typescript
export interface SessionInfo {
  // ... existing fields
  rawMode?: boolean; // undefined = auto, true = forced raw, false = forced normal
}
```

### `src/index.ts`

1. Add shortcut command handling in the command switch block (`!esc`, `!enter`, `!tab`, etc.)
2. Before sending text to terminal, check if raw mode is active:
   - Query `tmux.getCurrentCommand()` if `rawMode` is undefined
   - Check against `INTERACTIVE_PROGRAMS` set
   - If raw → send text without Enter
   - If normal → send text with Enter (existing behavior)
3. Register `!raw` / `!raw off` commands

## Testing

- Unit test: `getCurrentCommand()` returns correct process name
- Unit test: `INTERACTIVE_PROGRAMS` detection logic
- Unit test: shortcut command parsing (`!esc` → `Escape`, etc.)
- Integration test: send `i` in raw mode → verify no Enter appended
- Integration test: `!raw` / `!raw off` override works correctly
- Integration test: mode auto-switches when vim exits back to shell

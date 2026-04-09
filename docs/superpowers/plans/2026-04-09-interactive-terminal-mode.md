# Interactive Terminal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support interactive terminal programs (vim, nano, htop, etc.) via auto-detection and raw input mode, so keystrokes are sent without appending Enter.

**Architecture:** Add a `getCurrentCommand()` query to the tmux wrapper, an `isInteractiveProgram()` detection function, shortcut commands (`!esc`, `!enter`, etc.) to the message router, and conditional Enter-appending logic based on detected mode. Manual override via `!raw` / `!raw off`.

**Tech Stack:** TypeScript, tmux, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/terminal/tmux.ts` | Modify | Add `getCurrentCommand()` function |
| `src/terminal/interactive.ts` | Create | `INTERACTIVE_PROGRAMS` set + `isInteractiveProgram()` + `SHORTCUT_COMMANDS` map |
| `src/terminal/session.ts` | Modify | Add `rawMode` field to `SessionInfo` + `updateRawMode()` method |
| `src/index.ts` | Modify | Add shortcut command routing + raw mode detection in terminal send path |
| `tests/tmux.test.ts` | Modify | Add test for `getCurrentCommand()` |
| `tests/interactive.test.ts` | Create | Tests for `isInteractiveProgram()` + `SHORTCUT_COMMANDS` |
| `tests/raw-mode.test.ts` | Create | Integration tests for raw mode routing logic |

---

### Task 1: Add `getCurrentCommand()` to tmux wrapper

**Files:**
- Modify: `src/terminal/tmux.ts:136-139` (after `sendKeys`)
- Modify: `tests/tmux.test.ts` (add new describe block)

- [ ] **Step 1: Write the failing test**

Add to `tests/tmux.test.ts` at the end, before the closing `});` of the outer describe:

```typescript
describe('getCurrentCommand', () => {
  it('should execute tmux display-message with correct arguments', async () => {
    const promise = getCurrentCommand('my-session');

    mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('vim'));
    const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
    call?.[1](0);

    const result = await promise;

    expect(spawn).toHaveBeenCalledWith(
      'tmux',
      ['display-message', '-p', '-t', 'my-session', '#{pane_current_command}'],
      expect.any(Object)
    );
    expect(result).toBe('vim');
  });

  it('should return shell name when no program is running', async () => {
    const promise = getCurrentCommand('my-session');

    mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('bash'));
    const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
    call?.[1](0);

    const result = await promise;
    expect(result).toBe('bash');
  });
});
```

Also add `getCurrentCommand` to the import at line 1-8:

```typescript
import {
  createSession,
  attachSession,
  killSession,
  listSessions,
  sessionExists,
  sendKeys,
  capturePane,
  getCurrentCommand,
} from '../src/terminal/tmux';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tmux.test.ts`
Expected: FAIL — `getCurrentCommand` is not exported from `../src/terminal/tmux`

- [ ] **Step 3: Implement `getCurrentCommand`**

Add to `src/terminal/tmux.ts` after the `sendKeys` function (after line 139):

```typescript
/**
 * Get the current foreground command running in a tmux pane
 * @param name - Session name
 * @returns The process name (e.g., 'bash', 'vim', 'htop')
 */
export async function getCurrentCommand(name: string): Promise<string> {
  return executeTmux([
    'display-message', '-p', '-t', name,
    '#{pane_current_command}'
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tmux.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/terminal/tmux.ts tests/tmux.test.ts
git commit -m "feat: add getCurrentCommand() to tmux wrapper"
```

---

### Task 2: Create interactive program detection module

**Files:**
- Create: `src/terminal/interactive.ts`
- Create: `tests/interactive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/interactive.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isInteractiveProgram,
  SHORTCUT_COMMANDS,
  getShortcutKey,
} from '../src/terminal/interactive';

describe('interactive', () => {
  describe('isInteractiveProgram', () => {
    it('should detect vim as interactive', () => {
      expect(isInteractiveProgram('vim')).toBe(true);
    });

    it('should detect nvim as interactive', () => {
      expect(isInteractiveProgram('nvim')).toBe(true);
    });

    it('should detect nano as interactive', () => {
      expect(isInteractiveProgram('nano')).toBe(true);
    });

    it('should detect htop as interactive', () => {
      expect(isInteractiveProgram('htop')).toBe(true);
    });

    it('should detect less as interactive', () => {
      expect(isInteractiveProgram('less')).toBe(true);
    });

    it('should detect python as interactive', () => {
      expect(isInteractiveProgram('python')).toBe(true);
      expect(isInteractiveProgram('python3')).toBe(true);
    });

    it('should not detect bash as interactive', () => {
      expect(isInteractiveProgram('bash')).toBe(false);
    });

    it('should not detect zsh as interactive', () => {
      expect(isInteractiveProgram('zsh')).toBe(false);
    });

    it('should not detect fish as interactive', () => {
      expect(isInteractiveProgram('fish')).toBe(false);
    });

    it('should not detect empty string as interactive', () => {
      expect(isInteractiveProgram('')).toBe(false);
    });
  });

  describe('getShortcutKey', () => {
    it('should map esc to Escape', () => {
      expect(getShortcutKey('esc')).toBe('Escape');
    });

    it('should map enter to Enter', () => {
      expect(getShortcutKey('enter')).toBe('Enter');
    });

    it('should map tab to Tab', () => {
      expect(getShortcutKey('tab')).toBe('Tab');
    });

    it('should map arrow keys', () => {
      expect(getShortcutKey('up')).toBe('Up');
      expect(getShortcutKey('down')).toBe('Down');
      expect(getShortcutKey('left')).toBe('Left');
      expect(getShortcutKey('right')).toBe('Right');
    });

    it('should map ctrl combinations', () => {
      expect(getShortcutKey('ctrl+c')).toBe('C-c');
      expect(getShortcutKey('ctrl+d')).toBe('C-d');
      expect(getShortcutKey('ctrl+z')).toBe('C-z');
    });

    it('should return undefined for unknown shortcuts', () => {
      expect(getShortcutKey('unknown')).toBeUndefined();
    });

    it('should return undefined for non-shortcut commands', () => {
      expect(getShortcutKey('sh')).toBeUndefined();
      expect(getShortcutKey('help')).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/interactive.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the module**

Create `src/terminal/interactive.ts`:

```typescript
/**
 * Known interactive terminal programs that need raw input mode.
 * When the tmux foreground process matches one of these, keystrokes
 * are sent without appending Enter.
 */
const INTERACTIVE_PROGRAMS = new Set([
  // Editors
  'vim', 'vi', 'nvim', 'nano', 'emacs',
  // Monitors
  'htop', 'top', 'btop',
  // Pagers
  'less', 'more', 'man',
  // REPLs
  'python', 'python3', 'node', 'irb',
  // Database clients
  'mysql', 'psql', 'redis-cli',
  // TUI tools
  'fzf', 'tig', 'lazygit',
]);

/**
 * Check if a process name is a known interactive program.
 */
export function isInteractiveProgram(processName: string): boolean {
  return INTERACTIVE_PROGRAMS.has(processName);
}

/**
 * Map of shortcut command names to tmux key names.
 * These are used as `!esc`, `!enter`, `!tab`, etc.
 */
const SHORTCUT_COMMANDS: Record<string, string> = {
  esc: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  'ctrl+c': 'C-c',
  'ctrl+d': 'C-d',
  'ctrl+z': 'C-z',
};

/**
 * Get the tmux key name for a shortcut command.
 * Returns undefined if the command is not a known shortcut.
 */
export function getShortcutKey(command: string): string | undefined {
  return SHORTCUT_COMMANDS[command.toLowerCase()];
}

export { SHORTCUT_COMMANDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/interactive.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/terminal/interactive.ts tests/interactive.test.ts
git commit -m "feat: add interactive program detection and shortcut commands"
```

---

### Task 3: Add `rawMode` field to SessionInfo

**Files:**
- Modify: `src/terminal/session.ts:9-19` (SessionInfo interface)
- Modify: `src/terminal/session.ts` (add `updateRawMode` method)
- Modify: `tests/session.test.ts` (add rawMode tests)

- [ ] **Step 1: Read existing session tests to understand patterns**

Read `tests/session.test.ts` to understand the test pattern used.

- [ ] **Step 2: Write the failing test**

Add to `tests/session.test.ts` a new describe block for rawMode:

```typescript
describe('rawMode', () => {
  it('should default rawMode to undefined', async () => {
    const session = await sessionManager.createSession('conv-raw');
    expect(session.rawMode).toBeUndefined();
  });

  it('should update rawMode to true', async () => {
    const session = await sessionManager.createSession('conv-raw2');
    sessionManager.updateRawMode(session.id, true);
    const updated = sessionManager.getSession(session.id);
    expect(updated?.rawMode).toBe(true);
  });

  it('should reset rawMode to undefined', async () => {
    const session = await sessionManager.createSession('conv-raw3');
    sessionManager.updateRawMode(session.id, true);
    sessionManager.updateRawMode(session.id, undefined);
    const updated = sessionManager.getSession(session.id);
    expect(updated?.rawMode).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — `updateRawMode` is not a function

- [ ] **Step 4: Implement rawMode support**

Add `rawMode` to the `SessionInfo` interface in `src/terminal/session.ts` (after `allowedTools` field at line 18):

```typescript
export interface SessionInfo {
  id: number;
  type: 'claude' | 'terminal';
  tmuxName?: string;
  created: string;
  conversationId?: string;
  // Claude-specific
  claudeSessionId?: string;
  permissionMode?: 'default' | 'auto';
  allowedTools?: string[];
  // Terminal interactive mode
  rawMode?: boolean; // undefined = auto-detect, true = forced raw
}
```

Add `updateRawMode` method to the `SessionManager` class, after the `updatePermissionMode` method (after line 210):

```typescript
/**
 * Update raw mode for a terminal session
 * undefined = auto-detect, true = forced raw mode
 */
updateRawMode(sessionId: number, rawMode: boolean | undefined): void {
  const session = this.getSession(sessionId);
  if (session && session.type === 'terminal') {
    session.rawMode = rawMode;
    this.saveSessions();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/terminal/session.ts tests/session.test.ts
git commit -m "feat: add rawMode field to SessionInfo"
```

---

### Task 4: Add shortcut commands and raw mode logic to message router

**Files:**
- Modify: `src/index.ts` (import new modules, add shortcut routing, modify terminal send logic)
- Create: `tests/raw-mode.test.ts` (integration test for routing logic)

- [ ] **Step 1: Write integration tests for raw mode routing**

Create `tests/raw-mode.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isInteractiveProgram, getShortcutKey } from '../src/terminal/interactive';

describe('raw mode routing logic', () => {
  describe('shouldUseRawMode', () => {
    it('should use raw mode when rawMode is forced true', () => {
      const rawMode: boolean | undefined = true;
      const currentCommand = 'bash';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });

    it('should not use raw mode when rawMode is undefined and shell is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'bash';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(false);
    });

    it('should auto-detect raw mode when vim is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'vim';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });

    it('should auto-detect raw mode when htop is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'htop';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });
  });

  describe('shortcut command resolution', () => {
    it('should resolve !esc to Escape key send', () => {
      const tmuxKey = getShortcutKey('esc');
      expect(tmuxKey).toBe('Escape');
    });

    it('should resolve !enter to Enter key send', () => {
      const tmuxKey = getShortcutKey('enter');
      expect(tmuxKey).toBe('Enter');
    });

    it('should not resolve !sh as a shortcut', () => {
      const tmuxKey = getShortcutKey('sh');
      expect(tmuxKey).toBeUndefined();
    });

    it('should not resolve !help as a shortcut', () => {
      const tmuxKey = getShortcutKey('help');
      expect(tmuxKey).toBeUndefined();
    });

    it('should not resolve !raw as a shortcut (it is a mode command)', () => {
      const tmuxKey = getShortcutKey('raw');
      expect(tmuxKey).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these test the pure logic, not the router)

Run: `npx vitest run tests/raw-mode.test.ts`
Expected: PASS — these test already-implemented logic from Task 2

- [ ] **Step 3: Add imports to `src/index.ts`**

Add at the top of `src/index.ts`, after the existing tmux import (line 15):

```typescript
import { isInteractiveProgram, getShortcutKey } from './terminal/interactive';
```

- [ ] **Step 4: Add shortcut commands and `!raw` to the command switch block**

In `src/index.ts`, modify the command switch block. After the `case 'key':` block (line 195-197), add new cases before the `default:`:

```typescript
      case 'raw':
        await handleRawMode(conversationId, args[0]);
        return;
```

Then, after the entire switch block closes but before the `// Handle pending prompt` section (between the switch closing brace and line 210), add shortcut command handling:

```typescript
    // Check if this is a shortcut command (e.g., !esc, !enter, !tab)
    const shortcutKey = getShortcutKey(command);
    if (shortcutKey) {
      await handleShortcutKey(conversationId, shortcutKey);
      return;
    }
```

Wait — the current switch has a `default` case that sends "Unknown command". The shortcut check needs to go before the default. Restructure: remove the `default` case from the switch and add both the shortcut check and the unknown-command fallback after the switch:

Replace the `default` case (lines 204-206):

```typescript
      default:
        await feishuBot.sendText(conversationId, `Unknown command: ${command}\nType !help to see all commands`);
        return;
```

With just a `default: break;`, then after the switch closing brace, add:

```typescript
      default: {
        // Check if this is a shortcut command (e.g., !esc, !enter, !tab)
        const shortcutKey = getShortcutKey(command);
        if (shortcutKey) {
          await handleShortcutKey(conversationId, shortcutKey);
          return;
        }
        await feishuBot.sendText(conversationId, `Unknown command: ${command}\nType !help to see all commands`);
        return;
      }
```

- [ ] **Step 5: Add `handleShortcutKey` function**

Add after the `handleSpecialKey` function (after line 588):

```typescript
async function handleShortcutKey(conversationId: string, tmuxKey: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal' || !session.tmuxName) {
    await feishuBot.sendText(conversationId, 'Shortcut keys only work in Terminal mode');
    return;
  }

  await tmux.sendKeys(session.tmuxName, tmuxKey);

  // Capture and send screen feedback
  const tmuxName = session.tmuxName;
  const sid = activeSessionId;
  setTimeout(async () => {
    try {
      const captured = await tmux.capturePane(tmuxName);
      const card = smartCard.buildTerminalOutputCard(captured, { sessionId: sid });
      await feishuBot.sendCard(conversationId, card);
    } catch (err) {
      console.error('Failed to capture pane after shortcut:', err);
    }
  }, 400);
}
```

- [ ] **Step 6: Add `handleRawMode` function**

Add after `handleShortcutKey`:

```typescript
async function handleRawMode(conversationId: string, arg?: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal') {
    await feishuBot.sendText(conversationId, '!raw only works in Terminal mode');
    return;
  }

  if (arg === 'off') {
    sessionManager.updateRawMode(activeSessionId, undefined);
    await feishuBot.sendText(conversationId, 'Raw mode off — auto-detection resumed');
  } else {
    sessionManager.updateRawMode(activeSessionId, true);
    await feishuBot.sendText(conversationId, 'Raw mode on — keystrokes sent without Enter');
  }
}
```

- [ ] **Step 7: Modify terminal send path to use raw mode detection**

Replace the terminal send block in `handleCommand` (lines 238-254):

```typescript
    } else if (session?.type === 'terminal' && session.tmuxName) {
      // Send via tmux + capture
      const cmd = trimmedMessage;
      const sid = activeSessionId;
      const tmuxName = session.tmuxName;
      await tmux.sendKeys(tmuxName, cmd);
      await tmux.sendKeys(tmuxName, 'Enter');
      setTimeout(async () => {
        try {
          const captured = await tmux.capturePane(tmuxName);
          const { output, cwd } = extractCommandOutput(captured, cmd);
          const card = smartCard.buildTerminalOutputCard(output, { command: cmd, sessionId: sid, cwd });
          await feishuBot.sendCard(conversationId, card);
        } catch (err) {
          console.error('Failed to capture pane:', err);
        }
      }, 1500);
    }
```

With:

```typescript
    } else if (session?.type === 'terminal' && session.tmuxName) {
      const cmd = trimmedMessage;
      const sid = activeSessionId;
      const tmuxName = session.tmuxName;

      // Determine if raw mode is active
      let useRawMode = session.rawMode === true;
      if (session.rawMode === undefined) {
        try {
          const currentCmd = await tmux.getCurrentCommand(tmuxName);
          useRawMode = isInteractiveProgram(currentCmd);
        } catch {
          useRawMode = false;
        }
      }

      await tmux.sendKeys(tmuxName, cmd);
      if (!useRawMode) {
        await tmux.sendKeys(tmuxName, 'Enter');
      }

      // Capture screen feedback
      const delay = useRawMode ? 400 : 1500;
      setTimeout(async () => {
        try {
          const captured = await tmux.capturePane(tmuxName);
          if (useRawMode) {
            // Raw mode: show full screen capture
            const card = smartCard.buildTerminalOutputCard(captured, { sessionId: sid });
            await feishuBot.sendCard(conversationId, card);
          } else {
            // Normal mode: extract command output
            const { output, cwd } = extractCommandOutput(captured, cmd);
            const card = smartCard.buildTerminalOutputCard(output, { command: cmd, sessionId: sid, cwd });
            await feishuBot.sendCard(conversationId, card);
          }
        } catch (err) {
          console.error('Failed to capture pane:', err);
        }
      }, delay);
    }
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: PASS — all existing and new tests green

- [ ] **Step 9: Commit**

```bash
git add src/index.ts src/terminal/interactive.ts tests/raw-mode.test.ts
git commit -m "feat: add interactive terminal mode with raw input and shortcut commands"
```

---

### Task 5: Update help card with new commands

**Files:**
- Modify: `src/bot/card.ts` (update `buildHelpCard` to include new commands)

- [ ] **Step 1: Find and read the help card builder**

Search for `buildHelpCard` in `src/bot/card.ts` and read its content.

- [ ] **Step 2: Add new commands to help card**

In the `buildHelpCard` method, add the new commands to the help text. Add these lines to the commands list:

```
!esc / !enter / !tab — Send special key
!up / !down / !left / !right — Arrow keys
!ctrl+c / !ctrl+d / !ctrl+z — Ctrl combos
!raw — Force raw input mode (no Enter appended)
!raw off — Resume auto-detection
```

- [ ] **Step 3: Run tests to verify nothing is broken**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/bot/card.ts
git commit -m "docs: add interactive mode commands to help card"
```

---

### Task 6: Update console log startup message

**Files:**
- Modify: `src/index.ts:734` (add new commands to startup log)

- [ ] **Step 1: Update the startup log**

Replace line 734:

```typescript
  console.log('Commands: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami');
```

With:

```typescript
  console.log('Commands: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !raw, !esc, !enter, !tab, !whoami');
```

- [ ] **Step 2: Run all tests one final time**

Run: `npx vitest run`
Expected: PASS — all tests green

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "chore: add new commands to startup log"
```

# Opencode Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opencode as a second AI backend alongside Claude Code, sharing the same tmux architecture, switchable via `!opencode` / `!claude` commands.

**Architecture:** Refactor `ClaudeManager` into `AIManager` parameterized by backend config. Create two instances (claude, opencode) in the handler layer. Extend session types and router to support both backends.

**Tech Stack:** TypeScript, tmux, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/ai/backend.ts` | Create | `AIBackendConfig` interface + Claude/opencode config constants |
| `src/ai/manager.ts` | Create | `AIManager` class (refactored from `ClaudeManager`) |
| `src/claude/manager.ts` | Delete | Replaced by `src/ai/manager.ts` |
| `src/handlers/ai.ts` | Create | `handleAICommand`, `handleClaudeCommand`, `handleOpencodeCommand`, `handleCd` + manager singletons |
| `src/handlers/claude.ts` | Delete | Replaced by `src/handlers/ai.ts` |
| `src/terminal/session.ts` | Modify | Extend `SessionInfo.type` to include `'opencode'`, add `createOpencodeSession()` |
| `src/config.ts` | Modify | Add `opencode` config section |
| `src/index.ts` | Modify | Add `!opencode`/`!oc` routing, import from `./handlers/ai`, reconnect opencode sessions |
| `src/bot/card.ts` | Modify | Add `!opencode` to help card |
| `src/handlers/session.ts` | Modify | Import `getClaudeManager`/`getOpencodeManager` from `./ai` for kill/interrupt |
| `tests/ai-manager.test.ts` | Create | Tests for AIManager with both backends |
| `tests/claude-manager.test.ts` | Delete | Replaced by `tests/ai-manager.test.ts` |

---

### Task 1: Create AI backend config module

**Files:**
- Create: `src/ai/backend.ts`
- Test: `tests/ai-backend.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/ai-backend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CLAUDE_BACKEND, OPENCODE_BACKEND, AIBackendConfig } from '../src/ai/backend';

describe('AI backend configs', () => {
  it('CLAUDE_BACKEND has correct name and commands', () => {
    expect(CLAUDE_BACKEND.name).toBe('claude');
    expect(CLAUDE_BACKEND.startCommand).toBe('claude');
    expect(CLAUDE_BACKEND.startCommandAuto).toBe('claude --dangerously-skip-permissions');
    expect(CLAUDE_BACKEND.logPrefix).toBe('[CLAUDE]');
  });

  it('OPENCODE_BACKEND has correct name and commands', () => {
    expect(OPENCODE_BACKEND.name).toBe('opencode');
    expect(OPENCODE_BACKEND.startCommand).toBe('opencode');
    expect(OPENCODE_BACKEND.startCommandAuto).toBe('opencode --pure');
    expect(OPENCODE_BACKEND.logPrefix).toBe('[OPENCODE]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-backend.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the module**

Create directory and file:

```bash
mkdir -p src/ai
```

Create `src/ai/backend.ts`:

```typescript
/**
 * Configuration for an AI backend (Claude, opencode, etc.)
 */
export interface AIBackendConfig {
  name: string;
  startCommand: string;
  startCommandAuto: string;
  logPrefix: string;
}

export const CLAUDE_BACKEND: AIBackendConfig = {
  name: 'claude',
  startCommand: 'claude',
  startCommandAuto: 'claude --dangerously-skip-permissions',
  logPrefix: '[CLAUDE]',
};

export const OPENCODE_BACKEND: AIBackendConfig = {
  name: 'opencode',
  startCommand: 'opencode',
  startCommandAuto: 'opencode --pure',
  logPrefix: '[OPENCODE]',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-backend.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/backend.ts tests/ai-backend.test.ts
git commit -s -m "feat: add AI backend config for claude and opencode"
```

---

### Task 2: Refactor ClaudeManager into AIManager

**Files:**
- Create: `src/ai/manager.ts` (based on `src/claude/manager.ts`)
- Delete: `src/claude/manager.ts`

- [ ] **Step 1: Create `src/ai/manager.ts`**

Copy `src/claude/manager.ts` to `src/ai/manager.ts` and apply these renames:
- `ClaudeMetadata` → `AIMetadata`
- `ClaudeManagerCallbacks` → `AIManagerCallbacks`
- `ClaudeSession` → `AISession` (private interface)
- `ClaudeManager` → `AIManager`
- All `[CLAUDE]` log prefixes → use `this.backend.logPrefix`

Change the constructor to accept an `AIBackendConfig`:

```typescript
import { AIBackendConfig } from './backend';

export class AIManager {
  private sessions: Map<string, AISession> = new Map();
  private callbacks: AIManagerCallbacks;
  private config: ReturnType<typeof getConfig>;
  private backend: AIBackendConfig;

  constructor(callbacks: AIManagerCallbacks, backend: AIBackendConfig) {
    this.callbacks = callbacks;
    this.config = getConfig();
    this.backend = backend;
  }
```

Change `startSession` to use `this.backend` instead of hardcoded `'claude'`:

```typescript
  async startSession(conversationId: string, tmuxName: string, cwd?: string): Promise<void> {
    const config = this.config;
    // Use opencode config if this is an opencode backend, otherwise claude config
    const backendConfig = this.backend.name === 'opencode' ? config.opencode : config.claude;
    const mode = backendConfig.defaultMode;

    let shellCmd = this.backend.startCommand;
    if (mode === 'auto') {
      shellCmd = this.backend.startCommandAuto;
    }

    // rest is the same, just replace 'claude' references in log messages with this.backend.logPrefix
```

Change `sendMessage` error message from `'No active Claude session'` to `'No active ${this.backend.name} session'`.

Change timeout to read from the correct config section:
```typescript
    const timeout = this.backend.name === 'opencode' ? this.config.opencode.timeout : this.config.claude.timeout;
```

- [ ] **Step 2: Delete the old file**

```bash
git rm src/claude/manager.ts
```

- [ ] **Step 3: Update imports in existing code**

Update `tests/claude-manager.test.ts` → rename to `tests/ai-manager.test.ts` and update imports:

```typescript
import { AIManager, AIManagerCallbacks } from '../src/ai/manager';
import { CLAUDE_BACKEND, OPENCODE_BACKEND } from '../src/ai/backend';
```

Update all `ClaudeManager` references to `AIManager`, `ClaudeManagerCallbacks` to `AIManagerCallbacks`.

Change the constructor call:
```typescript
manager = new AIManager(callbacks, CLAUDE_BACKEND);
```

Add an opencode-specific test:

```typescript
  it('startSession with opencode backend uses opencode command', async () => {
    const ocManager = new AIManager(callbacks, OPENCODE_BACKEND);
    await startSessionWithTimers(ocManager, 'conv1', 'oc-conv1');

    expect(tmux.createSession).toHaveBeenCalledWith(
      'oc-conv1',
      'opencode',
      80,
      24,
    );
  });
```

Update the mock config to include `opencode` section:

```typescript
    opencode: { timeout: 300000, defaultMode: 'default' },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ai-manager.test.ts tests/ai-backend.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/manager.ts tests/ai-manager.test.ts
git rm src/claude/manager.ts tests/claude-manager.test.ts
git commit -s -m "refactor: rename ClaudeManager to AIManager with backend config"
```

---

### Task 3: Add opencode config section

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add to Config interface in `src/config.ts`**

After the `claude` section (line 33), add:

```typescript
  opencode: {
    timeout: number;
    defaultMode: 'default' | 'auto';
  };
```

- [ ] **Step 2: Add to `loadConfig()` in `src/config.ts`**

After the `claude` config block (line 99), add:

```typescript
    opencode: {
      timeout: getEnvVarInt('OPENCODE_TIMEOUT', 300000),
      defaultMode: (getEnvVar('OPENCODE_DEFAULT_MODE', 'default') as 'default' | 'auto'),
    },
```

- [ ] **Step 3: Update config test**

Add to `tests/config.test.ts` in the defaults test:

```typescript
    expect(config.opencode.timeout).toBe(300000);
    expect(config.opencode.defaultMode).toBe('default');
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -s -m "feat: add opencode configuration section"
```

---

### Task 4: Extend SessionInfo for opencode

**Files:**
- Modify: `src/terminal/session.ts`
- Modify: `tests/session.test.ts`

- [ ] **Step 1: Update SessionInfo.type**

In `src/terminal/session.ts`, change line 11:

```typescript
  type: 'claude' | 'opencode' | 'terminal';
```

- [ ] **Step 2: Add `createOpencodeSession()` method**

After the `createClaudeSession` method (after line 182), add:

```typescript
  /**
   * Create a new opencode session (no tmux needed — managed by AIManager)
   */
  createOpencodeSession(conversationId?: string): SessionInfo {
    const id = this.data.nextId;

    const session: SessionInfo = {
      id,
      type: 'opencode',
      created: new Date().toISOString(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }
```

- [ ] **Step 3: Update `reconnectSessions` to include opencode**

In `reconnectSessions` (line 332), change:

```typescript
      if (session.type === 'claude') {
```

to:

```typescript
      if (session.type === 'claude' || session.type === 'opencode') {
```

- [ ] **Step 4: Add test**

Add to `tests/session.test.ts`:

```typescript
  it('should create opencode session with correct type', async () => {
    const session = sessionManager.createOpencodeSession('conv-oc');
    expect(session.type).toBe('opencode');
    expect(session.conversationId).toBe('conv-oc');
  });
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/terminal/session.ts tests/session.test.ts
git commit -s -m "feat: extend SessionInfo to support opencode session type"
```

---

### Task 5: Create unified AI handler

**Files:**
- Create: `src/handlers/ai.ts`
- Delete: `src/handlers/claude.ts`

- [ ] **Step 1: Create `src/handlers/ai.ts`**

This file replaces `src/handlers/claude.ts`. It creates two `AIManager` instances and a shared `handleAICommand` function.

```typescript
import { getFeishuBot } from '../bot/feishu';
import { getSessionManager, SessionInfo } from '../terminal/session';
import { AIManager, AIManagerCallbacks } from '../ai/manager';
import { CLAUDE_BACKEND, OPENCODE_BACKEND } from '../ai/backend';
import { activeSessions, smartCard } from '../state';

// ── AI callbacks (shared by both backends) ──

const aiCallbacks: AIManagerCallbacks = {
  onStreamStart: async (conversationId) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard('thinking...');
    return await feishuBot.sendCard(conversationId, card);
  },

  onStreamUpdate: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(err => console.warn('[CARD] Failed to update card on stream update:', err.message || err));
  },

  onStreamEnd: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(err => console.warn('[CARD] Failed to update card on stream end:', err.message || err));
  },

  onMenu: async (conversationId, menu) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildMenuCard(menu.title, menu.options, menu.hint);
    await feishuBot.sendCard(conversationId, card);
  },

  onError: async (conversationId, error) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildErrorCard(error);
    await feishuBot.sendCard(conversationId, card);
  },
};

// ── Lazy managers ──

let _claudeManager: AIManager | null = null;
export function getClaudeManager(): AIManager {
  if (!_claudeManager) {
    _claudeManager = new AIManager(aiCallbacks, CLAUDE_BACKEND);
  }
  return _claudeManager;
}

let _opencodeManager: AIManager | null = null;
export function getOpencodeManager(): AIManager {
  if (!_opencodeManager) {
    _opencodeManager = new AIManager(aiCallbacks, OPENCODE_BACKEND);
  }
  return _opencodeManager;
}

// ── Shared AI command handler ──

type AIBackend = 'claude' | 'opencode';

function getManager(backend: AIBackend): AIManager {
  return backend === 'opencode' ? getOpencodeManager() : getClaudeManager();
}

async function handleAICommand(conversationId: string, prompt: string, backend: AIBackend): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!prompt) {
    await feishuBot.sendText(conversationId, `Usage: !${backend} <prompt> or just send a message`);
    return;
  }

  const sessionManager = getSessionManager();
  const manager = getManager(backend);

  // Find or create session for this backend
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  // Create new session if needed
  if (!session || session.type !== backend) {
    session = backend === 'opencode'
      ? sessionManager.createOpencodeSession(conversationId)
      : sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);

    const tmuxName = `${backend}-${session.id}`;
    session.tmuxName = tmuxName;
    sessionManager.updateClaudeSessionId(session.id, tmuxName);

    feishuBot.sendText(conversationId, `Starting ${backend} session...`).catch(err => console.warn('[FEISHU] Failed to send start notification:', err.message || err));
    manager.startSession(conversationId, tmuxName).then(() => {
      manager.sendMessage(conversationId, prompt).catch(err => {
        console.error(`Failed to send message to ${backend}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to start ${backend} session:`, err);
      feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send error card:', err2.message || err2));
    });
    return;
  }

  // Update activity timestamp
  sessionManager.updateLastActivity(session.id);

  // Check if tmux session is still alive
  const alive = await manager.isSessionAlive(conversationId);
  console.log(`[${backend.toUpperCase()}] session alive=${alive}, prompt="${prompt.slice(0, 20)}"`);
  if (!alive) {
    const tmuxName = `${backend}-${session.id}-${Date.now()}`;
    feishuBot.sendText(conversationId, `Restarting ${backend} session...`).catch(err => console.warn('[FEISHU] Failed to send restart notification:', err.message || err));
    manager.startSession(conversationId, tmuxName).then(() => {
      manager.sendMessage(conversationId, prompt).catch(err => {
        console.error(`Failed to send message to ${backend}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to restart ${backend} session:`, err);
    });
    return;
  }

  // Existing session — check if this is a menu selection (single number)
  const num = parseInt(prompt, 10);
  if (!isNaN(num) && prompt.trim() === String(num)) {
    console.log(`[${backend.toUpperCase()}] selectMenuOption(${num})`);
    manager.selectMenuOption(conversationId, num).catch(err => {
      console.error('Failed to select menu option:', err);
    });
  } else {
    manager.sendMessage(conversationId, prompt).catch(err => {
      console.error(`Failed to send message to ${backend}:`, err);
    });
  }
}

// ── Public command handlers ──

export async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
  return handleAICommand(conversationId, prompt, 'claude');
}

export async function handleOpencodeCommand(conversationId: string, prompt: string): Promise<void> {
  return handleAICommand(conversationId, prompt, 'opencode');
}

export async function handleCd(conversationId: string, dir: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!dir) {
    await feishuBot.sendText(conversationId, 'Usage: !cd <path>\nExample: !cd ~/workspace/my-project');
    return;
  }

  const sessionManager = getSessionManager();

  // Determine which backend the current session uses
  const activeSessionId = activeSessions.get(conversationId);
  let backend: AIBackend = 'claude'; // default
  if (activeSessionId !== undefined) {
    const currentSession = sessionManager.getSession(activeSessionId);
    if (currentSession?.type === 'opencode') {
      backend = 'opencode';
    }
    // Kill current AI session
    if (currentSession?.type === 'claude' || currentSession?.type === 'opencode') {
      const manager = getManager(currentSession.type as AIBackend);
      await manager.killSession(conversationId);
      await sessionManager.killSession(activeSessionId);
    }
  }

  // Create new session in the specified directory
  const session = backend === 'opencode'
    ? sessionManager.createOpencodeSession(conversationId)
    : sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  const tmuxName = `${backend}-${session.id}`;
  session.tmuxName = tmuxName;
  sessionManager.updateClaudeSessionId(session.id, tmuxName);

  const manager = getManager(backend);
  feishuBot.sendText(conversationId, `Switching to ${dir} ...`).catch(err => console.warn('[FEISHU] Failed to send cd notification:', err.message || err));
  manager.startSession(conversationId, tmuxName, dir).catch(err => {
    console.error(`Failed to start ${backend} in dir:`, err);
    feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send cd error card:', err2.message || err2));
  });
}
```

- [ ] **Step 2: Delete old handler**

```bash
git rm src/handlers/claude.ts
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: Some tests may fail due to import changes — fix in next task

- [ ] **Step 4: Commit**

```bash
git add src/handlers/ai.ts
git commit -s -m "feat: create unified AI handler with claude and opencode support"
```

---

### Task 6: Update router, session handler, and help card

**Files:**
- Modify: `src/index.ts`
- Modify: `src/handlers/session.ts`
- Modify: `src/bot/card.ts`

- [ ] **Step 1: Update `src/index.ts` imports**

Replace line 9:
```typescript
import { handleClaudeCommand, handleCd, getClaudeManager } from './handlers/claude';
```
With:
```typescript
import { handleClaudeCommand, handleOpencodeCommand, handleCd, getClaudeManager, getOpencodeManager } from './handlers/ai';
```

- [ ] **Step 2: Add `!opencode` / `!oc` to the command switch**

After the `case 'claude':` block, add:

```typescript
      case 'opencode':
      case 'oc':
        await handleOpencodeCommand(conversationId, args.join(' '));
        return;
```

- [ ] **Step 3: Update default message routing for opencode sessions**

In the default message routing section (around line 126), change:

```typescript
    if (session?.type === 'claude') {
      // Route through handleClaudeCommand which handles reconnection
      handleClaudeCommand(conversationId, trimmedMessage);
```

To:

```typescript
    if (session?.type === 'claude') {
      handleClaudeCommand(conversationId, trimmedMessage);
    } else if (session?.type === 'opencode') {
      handleOpencodeCommand(conversationId, trimmedMessage);
```

- [ ] **Step 4: Update reconnect logic in `main()` for opencode**

In `main()`, after the Claude reconnect loop (around line 203), add:

```typescript
  // Reconnect opencode tmux sessions
  const opencodeManager = getOpencodeManager();
  for (const session of allSessions) {
    if (session.type === 'opencode' && session.tmuxName && session.conversationId) {
      const ok = await opencodeManager.reconnectSession(session.conversationId, session.tmuxName);
      if (ok) {
        activeSessions.set(session.conversationId, session.id);
      } else {
        console.log(`[INIT] Opencode session ${session.id} (${session.tmuxName}) no longer exists, removing`);
        await sessionManager.killSession(session.id).catch(err => console.warn('[INIT] Failed to kill stale session:', err.message || err));
      }
    }
  }
```

- [ ] **Step 5: Update shutdown to kill opencode sessions**

In the shutdown handler, after `claudeManager.killAll()`, add:

```typescript
      await opencodeManager.killAll();
      console.log('[SHUTDOWN] Opencode sessions cleaned up');
```

- [ ] **Step 6: Update startup log**

Update the console.log commands list to include `!opencode`.

- [ ] **Step 7: Update `src/handlers/session.ts`**

Change import:
```typescript
import { getClaudeManager } from './claude';
```
To:
```typescript
import { getClaudeManager, getOpencodeManager } from './ai';
```

In `handleKillSession`, update the claude kill section to handle opencode too:

```typescript
  if (session.type === 'terminal' && session.tmuxName) {
    try { await tmux.killSession(session.tmuxName); } catch (err) { console.warn('[SESSION] Failed to kill tmux session:', err instanceof Error ? err.message : err); }
  } else if (session.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.killSession(conversationId);
  } else if (session.type === 'opencode') {
    const opencodeManager = getOpencodeManager();
    await opencodeManager.killSession(conversationId);
  }
```

In `handleInterrupt`, add opencode handling:

```typescript
  if (session?.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Claude interrupted');
  } else if (session?.type === 'opencode') {
    const opencodeManager = getOpencodeManager();
    await opencodeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Opencode interrupted');
  } else if (session?.type === 'terminal' && session.tmuxName) {
```

- [ ] **Step 8: Update help card in `src/bot/card.ts`**

In `buildHelpCard()`, add after the `!claude` row:

```typescript
      '| `!opencode <prompt>` / `!oc` | Start/send to opencode |',
```

- [ ] **Step 9: Run all tests**

Run: `npx vitest run`
Expected: PASS (all tests should pass)

- [ ] **Step 10: Commit**

```bash
git add src/index.ts src/handlers/session.ts src/bot/card.ts
git commit -s -m "feat: wire up opencode command routing and session management"
```

---

### Task 7: Update .env.example and README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add opencode config to `.env.example`**

After the Claude Configuration section, add:

```
# Opencode Configuration
OPENCODE_TIMEOUT=300000
OPENCODE_DEFAULT_MODE=default
```

- [ ] **Step 2: Update README.md**

Add `!opencode` / `!oc` to the commands table. Update the architecture section to mention dual AI backend support. Add a note in the quick start about opencode being an alternative to Claude.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -s -m "docs: add opencode to configuration and README"
```

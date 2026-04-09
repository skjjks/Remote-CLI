import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from './config';
import { getFeishuBot } from './bot/feishu';
import {
  SmartCardBuilder,
  isMoreOptionsValue,
  isPermitAction,
  isMenuAction,
  getMenuIndex,
  PERMIT_ALLOW,
  PERMIT_DENY,
  PERMIT_ALWAYS,
} from './bot/card';
import { getSessionManager, SessionInfo } from './terminal/session';
import * as tmux from './terminal/tmux';
import { isInteractiveProgram, getShortcutKey } from './terminal/interactive';
import { ClaudeManager, ClaudeManagerCallbacks } from './claude/manager';

// ── State ──

/** Active session per conversation (session ID) */
const activeSessions: Map<string, number> = new Map();

/** Pending prompts for terminal mode interactive responses */
const pendingPrompts: Map<string, any> = new Map();

const COMMAND_PREFIX = '!';

// ── Card builder ──

const smartCard = new SmartCardBuilder();

// ── Claude callbacks ──

const claudeCallbacks: ClaudeManagerCallbacks = {
  onStreamStart: async (conversationId) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard('thinking...');
    return await feishuBot.sendCard(conversationId, card);
  },

  onStreamUpdate: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(() => {});
  },

  onStreamEnd: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(() => {});
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

let _claudeManager: ClaudeManager | null = null;
function getClaudeManager(): ClaudeManager {
  if (!_claudeManager) {
    _claudeManager = new ClaudeManager(claudeCallbacks);
  }
  return _claudeManager;
}

// ── Helpers ──

/**
 * Extract command output from tmux capture-pane result.
 * Finds the last occurrence of the command, takes everything after it
 * until the next shell prompt, and strips empty/padding lines.
 */
function extractCommandOutput(captured: string, command: string): { output: string; cwd: string } {
  const lines = captured.split('\n');

  // Trim trailing empty lines (tmux pads to full screen height)
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  const trimmedLines = lines.slice(0, end + 1);

  // Shell prompt pattern: anything ending with $ or #
  const promptPattern = /[$#]\s*$/;

  // Find the last line that contains the command (the command echo line)
  let cmdLineIdx = -1;
  for (let i = trimmedLines.length - 1; i >= 0; i--) {
    if (trimmedLines[i].includes('$ ' + command) || trimmedLines[i].endsWith(command)) {
      cmdLineIdx = i;
      break;
    }
  }

  // Extract cwd from the last prompt line
  let cwd = '';
  for (let i = trimmedLines.length - 1; i >= 0; i--) {
    // Match pattern like user@host:~/path$
    const cwdMatch = trimmedLines[i].match(/:([~\/][^\$#]*)[\$#]/);
    if (cwdMatch) {
      cwd = cwdMatch[1];
      break;
    }
  }

  // Extract output: lines after the command until the next prompt
  if (cmdLineIdx >= 0) {
    const outputLines: string[] = [];
    for (let i = cmdLineIdx + 1; i < trimmedLines.length; i++) {
      // Stop at the next shell prompt
      if (promptPattern.test(trimmedLines[i])) break;
      outputLines.push(trimmedLines[i]);
    }

    // Trim leading/trailing empty lines in output
    let start = 0;
    while (start < outputLines.length && outputLines[start].trim() === '') start++;
    let oEnd = outputLines.length - 1;
    while (oEnd > start && outputLines[oEnd].trim() === '') oEnd--;

    const output = outputLines.slice(start, oEnd + 1).join('\n');
    return { output: output || '(no output)', cwd };
  }

  // Fallback: couldn't find command, return all non-empty non-prompt lines
  const fallback = trimmedLines
    .filter(l => l.trim() && !promptPattern.test(l))
    .join('\n');
  return { output: fallback || '(no output)', cwd };
}

// ── Command handling ──

async function handleCommand(
  conversationId: string,
  senderId: string,
  message: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  // Check if user is allowed
  if (!feishuBot.isUserAllowed(senderId)) {
    await feishuBot.sendText(
      conversationId,
      `Unauthorized user\nYour User ID: ${senderId}\nAdd this ID to ALLOWED_USERS in .env`
    );
    return;
  }

  const trimmedMessage = message.trim();

  // Handle commands
  if (trimmedMessage.startsWith(COMMAND_PREFIX)) {
    const parts = trimmedMessage.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
      case 'h':
        await feishuBot.sendCard(conversationId, smartCard.buildHelpCard());
        return;
      case 'sh':
        await handleShellCommand(conversationId, args.join(' '));
        return;
      case 'claude':
        await handleClaudeCommand(conversationId, args.join(' '));
        return;
      case 'new':
        await handleNewSession(conversationId);
        return;
      case 'list':
        await handleListSessions(conversationId);
        return;
      case 'switch':
        await handleSwitchSession(conversationId, args[0]);
        return;
      case 'kill':
        await handleKillSession(conversationId, args[0]);
        return;
      case 'interrupt':
        await handleInterrupt(conversationId);
        return;
      case 'mode':
        await handleModeSwitch(conversationId, args[0]);
        return;
      case 'key':
        await handleSpecialKey(conversationId, args.join(' '));
        return;
      case 'raw':
        await handleRawMode(conversationId, args[0]);
        return;
      case 'cd':
        await handleCd(conversationId, args.join(' '));
        return;
      case 'whoami':
        await feishuBot.sendText(conversationId, `Your User ID: ${senderId}`);
        return;
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
    }
  }

  // Handle pending prompt response (Terminal mode)
  const pendingPrompt = pendingPrompts.get(conversationId);
  if (pendingPrompt) {
    const num = parseInt(trimmedMessage, 10);
    if (!isNaN(num) && num >= 0 && num < pendingPrompt.options.length) {
      const activeSessionId = activeSessions.get(conversationId);
      if (activeSessionId !== undefined) {
        const sessionManager = getSessionManager();
        const session = sessionManager.getSession(activeSessionId);
        if (session?.type === 'terminal' && session.tmuxName) {
          await tmux.sendKeys(session.tmuxName, String(num));
          await tmux.sendKeys(session.tmuxName, 'Enter');
          pendingPrompts.delete(conversationId);
          return;
        }
      }
    }
  }

  // Default: send to active session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);

    if (session?.type === 'claude') {
      // Route through handleClaudeCommand which handles reconnection
      handleClaudeCommand(conversationId, trimmedMessage);
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
  } else {
    // No active session — create Claude session by default
    await handleClaudeCommand(conversationId, trimmedMessage);
  }
}

// ── Command handlers ──

async function handleShellCommand(conversationId: string, command: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!command) {
    await feishuBot.sendText(conversationId, 'Usage: !sh <command>');
    return;
  }

  const sessionManager = getSessionManager();

  // Find or create a terminal session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  if (!session || session.type !== 'terminal') {
    session = await sessionManager.createSession(conversationId);
    activeSessions.set(conversationId, session.id);
  }

  // Send command via tmux send-keys (not PTY stream)
  await tmux.sendKeys(session.tmuxName!, command);
  await tmux.sendKeys(session.tmuxName!, 'Enter');

  // Wait for command to execute, then capture rendered screen
  const sessionId = session.id;
  const tmuxName = session.tmuxName!;
  setTimeout(async () => {
    try {
      const captured = await tmux.capturePane(tmuxName);
      const { output, cwd } = extractCommandOutput(captured, command);
      const card = smartCard.buildTerminalOutputCard(output, {
        command,
        sessionId,
        cwd,
      });
      await feishuBot.sendCard(conversationId, card);
    } catch (err) {
      console.error('Failed to capture pane:', err);
    }
  }, 1500);
}

async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!prompt) {
    await feishuBot.sendText(conversationId, 'Usage: !claude <prompt> or just send a message');
    return;
  }

  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  // Find or create a Claude session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  // Create new Claude tmux session if needed (fire-and-forget — don't block Feishu handler)
  if (!session || session.type !== 'claude') {
    session = sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);

    const tmuxName = `claude-${session.id}`;
    session.tmuxName = tmuxName;
    sessionManager.updateClaudeSessionId(session.id, tmuxName);

    // Non-blocking: start session in background, send message when ready
    feishuBot.sendText(conversationId, 'Starting Claude session...').catch(() => {});
    claudeManager.startSession(conversationId, tmuxName).then(() => {
      claudeManager.sendMessage(conversationId, prompt).catch(err => {
        console.error('Failed to send message to Claude:', err);
      });
    }).catch(err => {
      console.error('Failed to start Claude session:', err);
      feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(() => {});
    });
    return;
  }

  // Check if tmux session is still alive
  const alive = await claudeManager.isSessionAlive(conversationId);
  console.log(`[CLAUDE] session alive=${alive}, prompt="${prompt.slice(0, 20)}"`);
  if (!alive) {
    const tmuxName = `claude-${session.id}-${Date.now()}`;
    feishuBot.sendText(conversationId, 'Restarting Claude session...').catch(() => {});
    claudeManager.startSession(conversationId, tmuxName).then(() => {
      claudeManager.sendMessage(conversationId, prompt).catch(err => {
        console.error('Failed to send message to Claude:', err);
      });
    }).catch(err => {
      console.error('Failed to restart Claude session:', err);
    });
    return;
  }

  // Existing session — check if this is a menu selection (single number)
  const num = parseInt(prompt, 10);
  if (!isNaN(num) && prompt.trim() === String(num)) {
    console.log(`[CLAUDE] selectMenuOption(${num})`);
    claudeManager.selectMenuOption(conversationId, num).catch(err => {
      console.error('Failed to select menu option:', err);
    });
  } else {
    // Regular message
    claudeManager.sendMessage(conversationId, prompt).catch(err => {
      console.error('Failed to send message to Claude:', err);
    });
  }
}

async function handleNewSession(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  await feishuBot.sendText(conversationId, `Created Claude session ${session.id}`);
}

async function handleListSessions(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();
  const sessions = sessionManager.getSessions();

  if (sessions.length === 0) {
    await feishuBot.sendText(conversationId, 'No active sessions');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  const lines = sessions.map(s => {
    const active = s.id === activeSessionId ? ' *' : '';
    return `  ${s.id}: [${s.type}] created ${s.created}${active}`;
  });

  await feishuBot.sendText(conversationId, `Sessions:\n${lines.join('\n')}`);
}

async function handleSwitchSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !switch <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // For terminal sessions, verify tmux session still exists
  if (session.type === 'terminal' && session.tmuxName) {
    const exists = await tmux.sessionExists(session.tmuxName);
    if (!exists) {
      await feishuBot.sendText(conversationId, `Session ${sessionId} no longer exists`);
      return;
    }
  }

  activeSessions.set(conversationId, sessionId);
  await feishuBot.sendText(conversationId, `Switched to ${session.type} session ${sessionId}`);
}

async function handleKillSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !kill <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // Kill the appropriate process
  if (session.type === 'terminal' && session.tmuxName) {
    try { await tmux.killSession(session.tmuxName); } catch { /* ignore */ }
  } else if (session.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.killSession(conversationId);
  }

  await sessionManager.killSession(sessionId);

  if (activeSessions.get(conversationId) === sessionId) {
    activeSessions.delete(conversationId);
  }

  await feishuBot.sendText(conversationId, `Killed ${session.type} session ${sessionId}`);
}

async function handleInterrupt(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);

  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);

  if (session?.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Claude interrupted');
  } else if (session?.type === 'terminal' && session.tmuxName) {
    await tmux.sendKeys(session.tmuxName, 'C-c');
    await feishuBot.sendText(conversationId, 'Sent Ctrl-C');
  }
}

async function handleCd(conversationId: string, dir: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!dir) {
    await feishuBot.sendText(conversationId, 'Usage: !cd <path>\nExample: !cd ~/workspace/my-project');
    return;
  }

  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  // Kill current Claude session if exists
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'claude') {
      await claudeManager.killSession(conversationId);
      await sessionManager.killSession(activeSessionId);
    }
  }

  // Create new Claude session in the specified directory
  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  const tmuxName = `claude-${session.id}`;
  session.tmuxName = tmuxName;
  sessionManager.updateClaudeSessionId(session.id, tmuxName);

  feishuBot.sendText(conversationId, `Switching to ${dir} ...`).catch(() => {});
  claudeManager.startSession(conversationId, tmuxName, dir).catch(err => {
    console.error('Failed to start Claude in dir:', err);
    feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(() => {});
  });
}

async function handleModeSwitch(conversationId: string, mode?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (mode !== 'auto' && mode !== 'default') {
    await feishuBot.sendText(conversationId, 'Usage: !mode auto|default');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    sessionManager.updatePermissionMode(activeSessionId, mode);
  }

  await feishuBot.sendText(conversationId, `Permission mode set to: ${mode}`);
}

async function handleSpecialKey(conversationId: string, key?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!key) {
    await feishuBot.sendText(
      conversationId,
      'Usage: !key <key>\nAvailable: up, down, left, right, enter, tab, escape, ctrl+c, ctrl+d, ...'
    );
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal') {
    await feishuBot.sendText(conversationId, '!key only works in Terminal mode');
    return;
  }

  // Map common key names to tmux key names
  const keyMap: Record<string, string> = {
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    enter: 'Enter', tab: 'Tab', escape: 'Escape',
    home: 'Home', end: 'End', pgup: 'PageUp', pgdn: 'PageDown',
    'ctrl+c': 'C-c', 'ctrl+d': 'C-d', 'ctrl+z': 'C-z', 'ctrl+l': 'C-l',
  };
  const tmuxKey = keyMap[key.toLowerCase()] || key;
  await tmux.sendKeys(session.tmuxName!, tmuxKey);
}

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

// ── Card action handling ──

async function handleCardAction(
  conversationId: string,
  senderId: string,
  value: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!feishuBot.isUserAllowed(senderId)) return;

  // Handle menu selection (Claude interactive menus)
  if (isMenuAction(value)) {
    const claudeManager = getClaudeManager();
    const menuIndex = getMenuIndex(value);
    if (menuIndex >= 0) {
      await claudeManager.selectMenuOption(conversationId, menuIndex);
    }
    return;
  }

  // Handle permission card actions
  if (isPermitAction(value)) {
    await handlePermitAction(conversationId, value);
    return;
  }

  // Handle "More options..." button (Terminal mode)
  if (isMoreOptionsValue(value)) {
    const pendingPrompt = pendingPrompts.get(conversationId);
    if (pendingPrompt && pendingPrompt.options.length > 4) {
      const remainingOptions = pendingPrompt.options.slice(4);
      const lines = remainingOptions.map((opt: any, i: number) => `${i + 4}. ${opt.label}`);
      await feishuBot.sendText(conversationId, `More options:\n${lines.join('\n')}\nType the number to select.`);
    }
    return;
  }

  // Send the value to the active terminal session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'terminal' && session.tmuxName) {
      await tmux.sendKeys(session.tmuxName, value);
      await tmux.sendKeys(session.tmuxName, 'Enter');
      pendingPrompts.delete(conversationId);
    }
  }
}

async function handlePermitAction(conversationId: string, value: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) return;

  const session = sessionManager.getSession(activeSessionId);
  if (!session || session.type !== 'claude') return;

  if (value === PERMIT_DENY) {
    await feishuBot.sendText(conversationId, 'Permission denied. Claude will skip this action.');
    return;
  }

  if (value === PERMIT_ALLOW || value === PERMIT_ALWAYS) {
    if (value === PERMIT_ALWAYS) {
      const tools = session.allowedTools || [];
      sessionManager.updateAllowedTools(activeSessionId, tools);
    }

    await feishuBot.sendText(conversationId, 'Permission granted. Please resend your request.');
  }
}

// ── Main entry point ──

async function main(): Promise<void> {
  const config = getConfig();
  const feishuBot = getFeishuBot();

  // Initialize session manager and reconnect sessions
  const sessionManager = getSessionManager();
  await sessionManager.reconnectSessions();

  // Reconnect Claude tmux sessions that survived bot restart
  const claudeManager = getClaudeManager();
  const allSessions = sessionManager.getSessions();
  for (const session of allSessions) {
    if (session.type === 'claude' && session.tmuxName && session.conversationId) {
      const ok = await claudeManager.reconnectSession(session.conversationId, session.tmuxName);
      if (ok) {
        activeSessions.set(session.conversationId, session.id);
      } else {
        // tmux session gone, clean up
        console.log(`[INIT] Claude session ${session.id} (${session.tmuxName}) no longer exists, removing`);
        await sessionManager.killSession(session.id).catch(() => {});
      }
    }
  }

  // Create event dispatcher
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: '',
  });

  // Register message event handler
  eventDispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      const message = feishuBot.parseMessage(data);
      if (message) {
        console.log(`[MSG] ${message.content.slice(0, 50)}`);
        // Add typing reaction, process, then remove
        const doWork = async () => {
          const reactionId = await feishuBot.addReaction(message.messageId, 'Typing');
          try {
            await handleCommand(message.conversationId, message.senderId, message.content);
          } finally {
            if (reactionId) {
              feishuBot.removeReaction(message.messageId, reactionId).catch(() => {});
            }
          }
        };
        doWork().catch(err => console.error('[MSG] Error:', err));
      }
    },
  });

  // Create WebSocket client
  // Note: Card action callbacks (button clicks) are NOT supported in WebSocket mode.
  // Users interact by typing numbers/text instead of clicking buttons.
  const wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  // Start WebSocket connection
  console.log('Connecting to Feishu via WebSocket...');
  await wsClient.start({ eventDispatcher });

  console.log('Feishu Terminal Bot connected via WebSocket');
  console.log('Commands: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami');
  console.log('Default: messages go to Claude');
}

main().catch(console.error);

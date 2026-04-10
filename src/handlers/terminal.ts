import { getFeishuBot } from '../bot/feishu';
import { getConfig } from '../config';
import { getSessionManager, SessionInfo } from '../terminal/session';
import * as tmux from '../terminal/tmux';
import { activeSessions, pendingPrompts, smartCard, addToHistory } from '../state';

// ── Helpers ──

/**
 * Extract command output from tmux capture-pane result.
 * Finds the last occurrence of the command, takes everything after it
 * until the next shell prompt, and strips empty/padding lines.
 */
export function extractCommandOutput(captured: string, command: string): { output: string; cwd: string } {
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
    const cwdMatch = trimmedLines[i].match(/:([~/][^$#]*)[$#]/);
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

// ── Terminal command handlers ──

export async function handleShellCommand(conversationId: string, command: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!command) {
    await feishuBot.sendText(conversationId, 'Usage: !sh <command>');
    return;
  }

  addToHistory(conversationId, command);

  const sessionManager = getSessionManager();
  const activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  if (!session || session.type !== 'terminal') {
    session = await sessionManager.createSession(conversationId);
    activeSessions.set(conversationId, session.id);
  }

  sessionManager.updateLastActivity(session.id);

  // Send command via tmux send-keys (not PTY stream)
  // Use literal mode for user-provided text to prevent tmux key name interpretation
  const startTime = Date.now();
  await tmux.sendLiteralKeys(session.tmuxName!, command);
  await tmux.sendKeys(session.tmuxName!, 'Enter');

  // Wait for command to execute, then capture rendered screen
  const sessionId = session.id;
  const tmuxName = session.tmuxName!;
  setTimeout(async () => {
    try {
      const captured = await tmux.capturePane(tmuxName);
      const { output, cwd } = extractCommandOutput(captured, command);
      const durationMs = Date.now() - startTime;
      const card = smartCard.buildTerminalOutputCard(output, {
        command,
        sessionId,
        cwd,
        durationMs,
      });
      await feishuBot.sendCard(conversationId, card);
    } catch (err) {
      console.error('Failed to capture pane:', err);
    }
  }, getConfig().timing.shellCaptureDelay);
}

export async function handleSpecialKey(conversationId: string, key?: string): Promise<void> {
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

export async function handleShortcutKey(conversationId: string, tmuxKey: string): Promise<void> {
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
  }, getConfig().timing.rawModeCaptureDelay);
}

export async function handleScreen(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal' || !session.tmuxName) {
    await feishuBot.sendText(conversationId, '!screen only works in Terminal mode');
    return;
  }

  try {
    const captured = await tmux.capturePane(session.tmuxName);
    const card = smartCard.buildTerminalOutputCard(captured, { sessionId: activeSessionId });
    await feishuBot.sendCard(conversationId, card);
  } catch (err) {
    console.error('[TERMINAL] Failed to capture screen:', err);
    await feishuBot.sendText(conversationId, 'Failed to capture screen');
  }
}

export async function handleRawMode(conversationId: string, arg?: string): Promise<void> {
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

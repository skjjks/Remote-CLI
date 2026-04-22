import { getFeishuBot } from '../bot/feishu';
import { getConfig } from '../config';
import { getSessionManager, SessionInfo } from '../terminal/session';
import * as tmux from '../terminal/tmux';
import { isInteractiveProgram } from '../terminal/interactive';
import { activeSessions, smartCard, addToHistory } from '../state';
import { parseAnsi } from '../terminal/ansi-parser';
import { registerFonts } from '../terminal/fonts';
import { renderScreenshot } from '../terminal/screenshot';
import * as os from 'os';
import * as fs from 'fs';

registerFonts();

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract command output from tmux capture-pane result.
 * Finds the last occurrence of the command, takes everything after it
 * until the next shell prompt, and strips empty/padding lines.
 *
 * Also returns `completed: true` when a shell prompt appears after the output,
 * indicating the command has finished executing.
 */
export function extractCommandOutput(captured: string, command: string): { output: string; cwd: string; completed: boolean } {
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

  // Check if command is completed: last non-empty line matches a shell prompt.
  // Don't require finding the command line — it may have scrolled off the visible viewport.
  const lastLine = trimmedLines.length > 0 ? trimmedLines[trimmedLines.length - 1] : '';
  const completed = promptPattern.test(lastLine) && trimmedLines.length > 1;

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
    return { output: output || '(no output)', cwd, completed };
  }

  // Fallback: command scrolled off screen — return all non-prompt lines as output
  const fallback = trimmedLines
    .filter(l => l.trim() && !promptPattern.test(l))
    .join('\n');
  return { output: fallback || '(no output)', cwd, completed };
}

// ── Polling-based command execution ──

const MAX_POLL_MS = 30_000;
const POLL_INTERVAL_MS = 1000;
const INITIAL_DELAY_MS = 500;

/**
 * Execute a shell command with polling-based completion detection.
 * Sends a "running..." card immediately, updates it with live output,
 * and finalizes when the command completes, a pager is detected, or it times out.
 */
async function pollCommandOutput(
  conversationId: string,
  tmuxName: string,
  command: string,
  sessionId: number,
  startTime: number,
): Promise<void> {
  const feishuBot = getFeishuBot();
  let messageId: string | undefined;
  let lastOutput = '';

  // Initial delay before first capture
  await sleep(INITIAL_DELAY_MS);

  for (let elapsed = INITIAL_DELAY_MS; elapsed < MAX_POLL_MS; elapsed += POLL_INTERVAL_MS) {
    // Check if a pager/interactive program took over (git log → less, man → less, etc.)
    try {
      const fgCmd = await tmux.getCurrentCommand(tmuxName);
      if (isInteractiveProgram(fgCmd)) {
        // Pager detected — show current content and stop polling
        const captured = await tmux.capturePaneVisible(tmuxName);
        const durationMs = Date.now() - startTime;
        const card = smartCard.buildTerminalOutputCard(captured, {
          command, sessionId, durationMs,
        });
        if (messageId) {
          await feishuBot.updateCard(messageId, card);
        } else {
          await feishuBot.sendCard(conversationId, card);
        }
        return;
      }
    } catch {
      // Ignore detection failure, continue polling
    }

    // Use visible-only capture during polling (no scrollback = faster)
    const captured = await tmux.capturePaneVisible(tmuxName);
    const { output, cwd, completed } = extractCommandOutput(captured, command);

    if (completed) {
      const durationMs = Date.now() - startTime;
      const card = smartCard.buildTerminalOutputCard(output, {
        command, sessionId, cwd, durationMs,
      });

      if (messageId) {
        await feishuBot.updateCard(messageId, card);
      } else {
        await feishuBot.sendCard(conversationId, card);
      }
      return;
    }

    // Still running — send or update "running..." card
    if (output !== lastOutput || !messageId) {
      const durationMs = Date.now() - startTime;
      const displayOutput = output === '(no output)' ? '' : output;
      const card = smartCard.buildTerminalOutputCard(displayOutput || 'waiting for output...', {
        command, sessionId, cwd, durationMs, running: true,
      });

      if (messageId) {
        feishuBot.updateCard(messageId, card).catch(err =>
          console.warn('[TERMINAL] Failed to update running card:', err.message || err));
      } else {
        messageId = await feishuBot.sendCard(conversationId, card);
      }
      lastOutput = output;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout — capture whatever we have
  const captured = await tmux.capturePaneVisible(tmuxName);
  const { output, cwd } = extractCommandOutput(captured, command);
  const durationMs = Date.now() - startTime;
  const card = smartCard.buildTerminalOutputCard(output, {
    command: `${command} (timeout)`, sessionId, cwd, durationMs,
  });

  if (messageId) {
    await feishuBot.updateCard(messageId, card);
  } else {
    await feishuBot.sendCard(conversationId, card);
  }
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

  if (!session || (session.type !== 'terminal' && session.type !== 'clouddev')) {
    session = await sessionManager.createSession(conversationId);
    activeSessions.set(conversationId, session.id);
  }

  sessionManager.updateLastActivity(session.id);

  // Send command via tmux
  const startTime = Date.now();
  await tmux.sendLiteralKeys(session.tmuxName!, command);
  await tmux.sendKeys(session.tmuxName!, 'Enter');

  // Poll for completion with real-time card updates
  pollCommandOutput(conversationId, session.tmuxName!, command, session.id, startTime)
    .catch(err => console.error('[TERMINAL] Poll error:', err));
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
  if (session?.type !== 'terminal' && session?.type !== 'clouddev') {
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
  if ((session?.type !== 'terminal' && session?.type !== 'clouddev') || !session?.tmuxName) {
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
  if ((session?.type !== 'terminal' && session?.type !== 'clouddev') || !session?.tmuxName) {
    await feishuBot.sendText(conversationId, '!screen only works in Terminal mode');
    return;
  }

  try {
    const captured = await tmux.capturePaneAnsi(session.tmuxName);
    const panePath = await tmux.getCurrentPath(session.tmuxName);
    const hostname = os.hostname();
    const user = process.env.USER ?? 'user';
    const home = process.env.HOME ?? '';
    const displayPath = panePath.startsWith(home) ? '~' + panePath.slice(home.length) : panePath;
    const title = `${user}@${hostname}: ${displayPath}`;

    const rawLines = captured.split('\n');
    const parsedLines = rawLines.map((line) => parseAnsi(line));

    const config = getConfig();
    const png = await renderScreenshot(parsedLines, title, { cols: config.terminal.cols });

    const tmpPath = `/tmp/screenshot-${Date.now()}.png`;
    fs.writeFileSync(tmpPath, png);

    try {
      const imageKey = await feishuBot.uploadImage(tmpPath);
      await feishuBot.sendImageMessage(conversationId, imageKey);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    console.error('[TERMINAL] Screenshot failed, falling back to text card:', err);
    try {
      const captured = await tmux.capturePane(session.tmuxName);
      const card = smartCard.buildTerminalOutputCard(captured, { sessionId: activeSessionId });
      await feishuBot.sendCard(conversationId, card);
    } catch (fallbackErr) {
      console.error('[TERMINAL] Fallback also failed:', fallbackErr);
      await feishuBot.sendText(conversationId, 'Failed to capture screen');
    }
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
  if (session?.type !== 'terminal' && session?.type !== 'clouddev') {
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

/**
 * Route a user message to an active terminal session.
 * Handles raw mode detection, literal key sending, and screen capture.
 * Non-raw mode uses polling for completion detection and real-time updates.
 */
export async function handleTerminalInput(
  conversationId: string,
  sessionId: number,
  tmuxName: string,
  message: string,
  rawMode: boolean | undefined,
): Promise<void> {
  const feishuBot = getFeishuBot();
  const cfg = getConfig();

  let useRawMode = rawMode === true;
  if (rawMode === undefined) {
    try {
      const currentCmd = await tmux.getCurrentCommand(tmuxName);
      useRawMode = isInteractiveProgram(currentCmd);
    } catch (err) {
      console.warn('[TMUX] Failed to detect current command:', err instanceof Error ? err.message : err);
      useRawMode = false;
    }
  }

  const startTime = Date.now();
  await tmux.sendLiteralKeys(tmuxName, message);
  if (!useRawMode) {
    await tmux.sendKeys(tmuxName, 'Enter');
  }

  if (useRawMode) {
    // Raw mode: single capture after delay (for vim, htop, etc.)
    const delay = cfg.timing.rawModeCaptureDelay;
    setTimeout(async () => {
      try {
        const captured = await tmux.capturePane(tmuxName);
        const durationMs = Date.now() - startTime;
        const card = smartCard.buildTerminalOutputCard(captured, { sessionId, durationMs });
        await feishuBot.sendCard(conversationId, card);
      } catch (err) {
        console.error('Failed to capture pane:', err);
      }
    }, delay);
  } else {
    // Normal mode: polling with real-time updates
    pollCommandOutput(conversationId, tmuxName, message, sessionId, startTime)
      .catch(err => console.error('[TERMINAL] Poll error:', err));
  }
}

import { getConfig } from '../config';
import * as tmux from '../terminal/tmux';
import { AIBackendConfig } from './backend';

/**
 * AI Manager — runs an AI CLI (Claude, opencode, etc.) in a tmux session (interactive mode).
 * Uses tmux send-keys to send messages, capture-pane to read output.
 * This enables true multi-turn conversations.
 */

export interface MenuOption {
  label: string;
  index: number;
  selected: boolean;
}

export interface DetectedMenu {
  title: string;
  options: MenuOption[];
  hint: string;  // e.g. "Enter to confirm · Esc to exit"
}

export interface AIMetadata {
  model?: string;
  cwd?: string;
  context?: string;
  status?: string;  // e.g. "thinking", "Bash", "Edit", "Read", "done"
  costUsd?: number;
}

export interface AIManagerCallbacks {
  onStreamStart: (conversationId: string) => Promise<string | undefined>;  // returns messageId
  onStreamUpdate: (conversationId: string, messageId: string, content: string, metadata?: AIMetadata) => void;
  onStreamEnd: (conversationId: string, messageId: string, content: string, metadata: AIMetadata) => void;
  onMenu: (conversationId: string, menu: DetectedMenu) => void;
  onError: (conversationId: string, error: string) => void;
}

interface AISession {
  tmuxName: string;
  conversationId: string;
  lastCaptureContent: string;  // Track content to send only new output
  pollTimeoutId?: ReturnType<typeof setTimeout>;  // Track active poll for cleanup
}

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

  /**
   * Start a new AI tmux session.
   * Launches the AI CLI (interactive mode) in a detached tmux session.
   */
  async startSession(conversationId: string, tmuxName: string, cwd?: string): Promise<void> {
    const config = this.config;
    const backendConfig = this.backend.name === 'opencode' ? config.opencode : config.claude;
    const mode = backendConfig.defaultMode;

    let shellCmd = this.backend.startCommand;
    if (mode === 'auto') {
      shellCmd = this.backend.startCommandAuto;
    }

    // If cwd specified, cd there first then launch the AI CLI
    if (cwd) {
      await tmux.createSession(
        tmuxName,
        '/bin/bash',
        config.terminal.cols,
        config.terminal.rows
      );
      await tmux.sendKeys(tmuxName, `cd ${cwd} && ${shellCmd}`);
      await tmux.sendKeys(tmuxName, 'Enter');
    } else {
      await tmux.createSession(
        tmuxName,
        shellCmd,
        config.terminal.cols,
        config.terminal.rows
      );
    }

    // Wait for the AI CLI to start
    await new Promise(resolve => setTimeout(resolve, this.config.timing.claudeStartupWait));

    const session: AISession = {
      tmuxName,
      conversationId,
      lastCaptureContent: '',
    };

    // Capture initial screen content so we can diff later
    try {
      session.lastCaptureContent = await tmux.capturePane(tmuxName);
    } catch (err) {
      console.warn(`${this.backend.logPrefix} Failed to capture initial pane content:`, err instanceof Error ? err.message : err);
      session.lastCaptureContent = '';
    }

    this.sessions.set(conversationId, session);
  }

  /**
   * Send a message to the AI session and capture the response.
   */
  async sendMessage(conversationId: string, message: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      this.callbacks.onError(conversationId, `No active ${this.backend.name} session`);
      return;
    }

    // Capture screen before sending (baseline)
    let beforeContent = '';
    try {
      beforeContent = await tmux.capturePane(session.tmuxName);
    } catch (err) {
      console.warn(`${this.backend.logPrefix} Failed to capture pane before send:`, err instanceof Error ? err.message : err);
      beforeContent = '';
    }

    // Send the message via tmux send-keys
    // Use literal mode for user-provided text to prevent tmux key name interpretation
    await tmux.sendLiteralKeys(session.tmuxName, message);
    await tmux.sendKeys(session.tmuxName, 'Enter');

    // Poll for new output — the AI CLI needs time to respond
    this.pollForResponse(conversationId, session, beforeContent);
  }

  /**
   * Poll tmux capture-pane and stream output via card PATCH updates.
   * Sends a card immediately, then updates it every 1s as content changes.
   */
  private pollForResponse(
    conversationId: string,
    session: AISession,
    beforeContent: string
  ): void {
    const POLL_INTERVAL = this.config.timing.claudePollInterval;
    const timeout = this.backend.name === 'opencode' ? this.config.opencode.timeout : this.config.claude.timeout;
    const startTime = Date.now();
    let lastRawContent = beforeContent;
    let lastSentContent = '';
    let stableCount = 0;
    let messageId: string | undefined;

    const poll = async () => {
      if (Date.now() - startTime > timeout) {
        session.pollTimeoutId = undefined;
        this.callbacks.onError(conversationId, `${this.backend.name} response timed out`);
        return;
      }

      try {
        const currentContent = await tmux.capturePane(session.tmuxName);

        // Check for interactive menu first
        const menu = this.detectMenu(currentContent);
        if (menu) {
          session.lastCaptureContent = currentContent;
          session.pollTimeoutId = undefined;
          this.callbacks.onMenu(conversationId, menu);
          return;
        }

        // Extract and clean new output
        const newOutput = this.extractScreenContent(currentContent);
        const cleaned = newOutput.trim();

        if (currentContent !== lastRawContent) {
          lastRawContent = currentContent;
          stableCount = 0;

          // Content changed — send or update card
          if (cleaned && cleaned !== lastSentContent) {
            const meta = this.extractMetadata(currentContent);
            if (!messageId) {
              messageId = await this.callbacks.onStreamStart(conversationId);
            }
            if (messageId) {
              this.callbacks.onStreamUpdate(conversationId, messageId, cleaned, meta);
            }
            lastSentContent = cleaned;
          }
        } else {
          stableCount++;
        }

        // Stable for 3 polls (3 seconds) and we have content -> done
        if (stableCount >= 3 && currentContent !== beforeContent) {
          session.lastCaptureContent = currentContent;
          session.pollTimeoutId = undefined;
          const metadata = this.extractMetadata(currentContent);
          if (messageId && cleaned) {
            this.callbacks.onStreamEnd(conversationId, messageId, cleaned, metadata);
          } else if (cleaned) {
            // Never got to create a card (very fast response) — create final one
            messageId = await this.callbacks.onStreamStart(conversationId);
            if (messageId) {
              this.callbacks.onStreamEnd(conversationId, messageId, cleaned, metadata);
            }
          }
          return;
        }

        session.pollTimeoutId = setTimeout(poll, POLL_INTERVAL);
      } catch (err) {
        session.pollTimeoutId = undefined;
        this.callbacks.onError(conversationId, `Capture failed: ${err}`);
      }
    };

    // Start polling after brief delay
    session.pollTimeoutId = setTimeout(poll, this.config.timing.claudeFirstPollDelay);
  }

  /**
   * Extract screen content, trimming trailing empty lines.
   * Returns the full terminal screen as-is (no UI chrome filtering).
   */
  private extractScreenContent(content: string): string {
    const lines = content.split('\n');

    // Trim trailing empty lines (tmux pads to full screen height)
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') end--;

    // Trim leading empty lines
    let start = 0;
    while (start <= end && lines[start].trim() === '') start++;

    return lines.slice(start, end + 1).join('\n');
  }


  /**
   * Extract model, cwd, context from the full captured pane.
   * Parses Claude Code's status bar and context line.
   */
  private extractMetadata(content: string): AIMetadata {
    const lines = content.split('\n');
    const metadata: AIMetadata = {};

    for (const line of lines) {
      const trimmed = line.trim();

      // Model
      if (!metadata.model) {
        const modelMatch = trimmed.match(/\b((?:Opus|Sonnet|Haiku)\s+[\d.]+(?:\s*\([^)]+\))?)/i);
        if (modelMatch) metadata.model = modelMatch[1];
      }

      // CWD
      if (!metadata.cwd) {
        const cwdMatch = trimmed.match(/~\/[\w./-]+/);
        if (cwdMatch) metadata.cwd = cwdMatch[0];
      }

      // Context usage
      if (!metadata.context) {
        const ctxMatch = trimmed.match(/Context\s+[░▓█]+\s+(\d+%)/);
        if (ctxMatch) metadata.context = ctxMatch[1];
      }

      // Cost: match "$X.XX" pattern in status area
      if (!metadata.costUsd) {
        const costMatch = trimmed.match(/\$(\d+\.?\d*)/);
        if (costMatch) metadata.costUsd = parseFloat(costMatch[1]);
      }
    }

    // Detect current status from the last meaningful lines
    metadata.status = this.detectStatus(lines);

    return metadata;
  }

  /**
   * Detect Claude's current activity from screen content.
   */
  private detectStatus(lines: string[]): string {
    // Scan from bottom up for activity indicators
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
      const trimmed = lines[i].trim();

      // Tool in progress: "● Bash(...)" or "● Read(...)" etc.
      const toolMatch = trimmed.match(/^●\s*(Bash|Edit|Read|Write|Update|Glob|Grep|WebSearch|WebFetch|Agent|TaskCreate|TaskUpdate)\b/);
      if (toolMatch) return toolMatch[1];

      // Thinking indicator
      if (/^●\s/.test(trimmed) && !trimmed.match(/^●\s*(high|medium|low)/i)) return 'thinking';

      // Churning / processing
      if (/^✻/.test(trimmed)) return 'processing';

      // Waiting for input (> prompt)
      if (/^❯\s*$/.test(trimmed)) return 'done';
    }

    return 'working';
  }

  /**
   * Detect interactive menus (numbered selection, yes/no) in capture-pane output.
   * Returns a DetectedMenu if found, null otherwise.
   */
  private detectMenu(content: string): DetectedMenu | null {
    const lines = content.split('\n');

    const options: MenuOption[] = [];
    let title = '';
    let hint = '';
    const contextLines: string[] = [];  // Text above the options (command description, etc.)
    let firstOptionIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Detect numbered options: "1. Label" or "> 1. Label" or "> 1. Label"
      const optMatch = trimmed.match(/^(?:[❯>]\s*)?(\d+)\.\s+(.+?)(?:\s+·\s+.*)?$/);
      if (optMatch) {
        if (firstOptionIdx < 0) firstOptionIdx = i;
        const index = parseInt(optMatch[1], 10);
        let label = optMatch[2].replace(/\s*[✔✓]\s*/, '').trim();
        const descSplit = label.split(/\s{2,}/);
        if (descSplit.length > 1) label = descSplit[0];
        const selected = /[❯>]/.test(trimmed) || /[✔✓]/.test(trimmed);
        options.push({ label, index, selected });
        continue;
      }

      // Detect hint line
      if (/Enter to confirm|Esc to exit|y\/n|Y\/N/.test(trimmed)) {
        hint = trimmed;
      }

      // Detect yes/no prompt
      if (/\(y\/n\)|\[y\/N\]|\[Y\/n\]/i.test(trimmed)) {
        return {
          title: trimmed.replace(/\s*\(y\/n\)|\[y\/N\]|\[Y\/n\]/i, '').trim(),
          options: [
            { label: 'Yes', index: 0, selected: false },
            { label: 'No', index: 1, selected: false },
          ],
          hint: 'y/n',
        };
      }
    }

    // Capture context: meaningful lines before the first option
    // These describe what the menu is about (e.g. "Claude wants to run: wc -l")
    if (firstOptionIdx > 0) {
      for (let i = firstOptionIdx - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        // Stop at UI chrome
        if (/^[─━═╌]{4,}/.test(trimmed)) break;
        if (/^❯\s*$/.test(trimmed)) break;
        if (/^[▐▛▜▌▝▘█░▒▓\s]+$/.test(trimmed)) break;
        if (/git:\(/.test(trimmed)) break;
        if (/\}@\.@\{/.test(trimmed)) break;
        // Clean bullet prefix
        let clean = trimmed.replace(/^[●⎿]\s*/, '');
        if (clean) contextLines.unshift(clean);
        // Take at most 5 lines of context
        if (contextLines.length >= 5) break;
      }
    }

    // Build title from context + detected title keywords
    if (contextLines.length > 0) {
      title = contextLines.join('\n');
    }

    // Need at least 2 options to be a menu
    if (options.length >= 2) {
      return { title, options, hint };
    }

    return null;
  }

  /**
   * Send a menu selection by navigating to the option and pressing Enter.
   * Uses arrow keys to move from current selection to target.
   */
  async selectMenuOption(conversationId: string, targetIndex: number): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      console.log(`[MENU] no session for ${conversationId}`);
      this.callbacks.onError(conversationId, `No active ${this.backend.name} session`);
      return;
    }

    const beforeContent = await tmux.capturePane(session.tmuxName);
    const menu = this.detectMenu(beforeContent);
    console.log(`[MENU] detected=${!!menu}, options=${menu?.options.length || 0}, target=${targetIndex}`);
    if (!menu) {
      // Not a menu — just send the number as text input
      await tmux.sendKeys(session.tmuxName, String(targetIndex));
      await tmux.sendKeys(session.tmuxName, 'Enter');
      // Poll for response
      session.pollTimeoutId = setTimeout(() => {
        this.pollForResponse(conversationId, session, beforeContent);
      }, this.config.timing.claudeMenuPollDelay);
      return;
    }

    // Find currently selected option
    const currentIdx = menu.options.findIndex(o => o.selected);
    const targetOptIdx = menu.options.findIndex(o => o.index === targetIndex);
    if (targetOptIdx < 0) {
      this.callbacks.onError(conversationId, `Option ${targetIndex} not found in menu`);
      return;
    }

    // Navigate with arrow keys
    if (currentIdx >= 0) {
      const diff = targetOptIdx - currentIdx;
      const key = diff > 0 ? 'Down' : 'Up';
      for (let i = 0; i < Math.abs(diff); i++) {
        await tmux.sendKeys(session.tmuxName, key);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    await tmux.sendKeys(session.tmuxName, 'Enter');

    // Poll for response after selection
    session.pollTimeoutId = setTimeout(() => {
      this.pollForResponse(conversationId, session, beforeContent);
    }, this.config.timing.claudeMenuPollDelay);
  }

  /**
   * Send yes/no response
   */
  async sendYesNo(conversationId: string, yes: boolean): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    const beforeContent = await tmux.capturePane(session.tmuxName);
    await tmux.sendKeys(session.tmuxName, yes ? 'y' : 'n');

    session.pollTimeoutId = setTimeout(() => {
      this.pollForResponse(conversationId, session, beforeContent);
    }, this.config.timing.claudeMenuPollDelay);
  }

  /**
   * Send interrupt (Escape or Ctrl-C) to AI session
   */
  async interruptSession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      if (session.pollTimeoutId) {
        clearTimeout(session.pollTimeoutId);
        session.pollTimeoutId = undefined;
      }
      await tmux.sendKeys(session.tmuxName, 'C-c');
    }
  }

  /**
   * Check if a session exists
   */
  isSessionActive(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /**
   * Check if tmux session still exists
   */
  async isSessionAlive(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    return tmux.sessionExists(session.tmuxName);
  }

  /**
   * Kill an AI session
   */
  async killSession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      if (session.pollTimeoutId) {
        clearTimeout(session.pollTimeoutId);
        session.pollTimeoutId = undefined;
      }
      try {
        await tmux.killSession(session.tmuxName);
      } catch (err) { console.warn(`${this.backend.logPrefix} Failed to kill tmux session:`, err instanceof Error ? err.message : err); }
      this.sessions.delete(conversationId);
    }
  }

  /**
   * Reconnect to an existing AI tmux session (after bot restart).
   * Registers the session in memory so messages can be routed to it.
   */
  async reconnectSession(conversationId: string, tmuxName: string): Promise<boolean> {
    const exists = await tmux.sessionExists(tmuxName);
    if (!exists) return false;

    const session: AISession = {
      tmuxName,
      conversationId,
      lastCaptureContent: '',
    };

    try {
      session.lastCaptureContent = await tmux.capturePane(tmuxName);
    } catch (err) {
      console.warn(`${this.backend.logPrefix} Failed to capture pane on reconnect:`, err instanceof Error ? err.message : err);
      session.lastCaptureContent = '';
    }

    this.sessions.set(conversationId, session);
    console.log(`${this.backend.logPrefix} Reconnected to tmux session: ${tmuxName}`);
    return true;
  }

  /**
   * Kill all sessions
   */
  async killAll(): Promise<void> {
    for (const [convId] of this.sessions) {
      await this.killSession(convId);
    }
  }
}

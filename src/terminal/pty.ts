import * as pty from 'node-pty';
import { getConfig } from '../config';
import { OutputBuffer, FlushReason, MessageFormatter } from '../bot/message';
import { JsonStreamParser, detectPromptWithChunk, PromptDetectionResult } from './prompt';

// Re-export for convenience
export { PromptDetectionResult } from './prompt';
import * as tmux from './tmux';

/**
 * Output callback type
 */
export type OutputCallback = (
  sessionId: number,
  output: string,
  prompt?: PromptDetectionResult
) => void;

/**
 * PTY session information
 */
interface PtySession {
  sessionId: number;
  tmuxName: string;
  ptyProcess: pty.IPty;
  buffer: OutputBuffer;
  jsonParser: JsonStreamParser;
  formatter: MessageFormatter;
  accumulatedOutput: string;
}

/**
 * PTY Manager for managing pseudo-terminal sessions
 */
export class PtyManager {
  private sessions: Map<number, PtySession> = new Map();
  private config: ReturnType<typeof getConfig>;
  private outputCallback?: OutputCallback;
  private sessionPrefix: string;

  constructor(outputCallback?: OutputCallback) {
    this.config = getConfig();
    this.sessionPrefix = this.config.session.prefix;
    this.outputCallback = outputCallback;
  }

  /**
   * Get tmux session name from session ID
   */
  private getTmuxName(sessionId: number): string {
    return `${this.sessionPrefix}-${sessionId}`;
  }

  /**
   * Spawn a new PTY session running tmux
   */
  async spawnSession(sessionId: number, tmuxName: string): Promise<void> {
    // Check if tmux session already exists
    const exists = await tmux.sessionExists(tmuxName);
    if (!exists) {
      // Create tmux session only if it doesn't exist
      await tmux.createSession(
        tmuxName,
        this.config.terminal.shell,
        this.config.terminal.cols,
        this.config.terminal.rows
      );
    }

    // Spawn PTY that attaches to tmux
    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: this.config.terminal.cols,
      rows: this.config.terminal.rows,
      cwd: process.env.HOME || '/root',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    // Create buffer and parser for this session
    const buffer = new OutputBuffer((messages, reason) => {
      this.handleBufferFlush(sessionId, messages, reason);
    });
    const jsonParser = new JsonStreamParser();
    const formatter = new MessageFormatter();

    const session: PtySession = {
      sessionId,
      tmuxName,
      ptyProcess,
      buffer,
      jsonParser,
      formatter,
      accumulatedOutput: '',
    };

    // Handle PTY output
    ptyProcess.onData((data) => {
      this.handlePtyOutput(session, data);
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      this.handlePtyExit(sessionId, exitCode);
    });

    this.sessions.set(sessionId, session);
  }

  /**
   * Handle PTY output
   */
  private handlePtyOutput(session: PtySession, data: string): void {
    // Accumulate output for prompt detection
    session.accumulatedOutput += data;

    // Keep only last 10KB for prompt detection
    if (session.accumulatedOutput.length > 10240) {
      session.accumulatedOutput = session.accumulatedOutput.slice(-10240);
    }

    // Write to buffer
    session.buffer.write(data);
  }

  /**
   * Handle buffer flush — use tmux capture-pane for clean rendered output
   */
  private handleBufferFlush(sessionId: number, _messages: string[], _reason: FlushReason): void {
    if (!this.outputCallback) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Use tmux capture-pane to get the actual rendered screen content
    // instead of parsing the raw PTY escape sequence stream.
    tmux.capturePane(session.tmuxName).then((captured) => {
      const cleaned = this.cleanTerminalOutput(captured);
      if (!cleaned.trim()) return;

      // Detect prompts in accumulated output
      const prompt = detectPromptWithChunk(
        session.accumulatedOutput,
        session.jsonParser,
        cleaned
      );

      this.outputCallback!(sessionId, cleaned, prompt.type ? prompt : undefined);
    }).catch((err) => {
      console.error('Failed to capture pane:', err);
    });
  }

  /**
   * Clean terminal output: strip tmux status bar, collapse empty lines
   */
  private cleanTerminalOutput(text: string): string {
    const lines = text.split('\n');
    const cleaned: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip tmux status bar lines: [session:prog*    "hostname" HH:MM ...
      if (/^\[[\w-]+:/.test(trimmed)) continue;
      // Skip hostname/timestamp lines from tmux status bar
      if (/^"[\w-]+"/.test(trimmed) && /\d{2}:\d{2}/.test(trimmed)) continue;
      cleaned.push(line);
    }

    // Collapse consecutive empty lines to at most 1
    const result: string[] = [];
    let prevEmpty = false;
    for (const line of cleaned) {
      const isEmpty = line.trim() === '';
      if (isEmpty && prevEmpty) continue;
      result.push(line);
      prevEmpty = isEmpty;
    }

    // Trim leading/trailing empty lines
    let start = 0;
    while (start < result.length && result[start].trim() === '') start++;
    let end = result.length - 1;
    while (end > start && result[end].trim() === '') end--;

    return result.slice(start, end + 1).join('\n');
  }

  /**
   * Handle PTY exit
   */
  private handlePtyExit(sessionId: number, exitCode: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Flush any remaining output
      session.buffer.flush(FlushReason.MANUAL);
      session.buffer.destroy();

      // Notify about session end
      if (this.outputCallback) {
        this.outputCallback(
          sessionId,
          `\n[Session ended with exit code ${exitCode}]`,
          undefined
        );
      }

      this.sessions.delete(sessionId);
    }
  }

  /**
   * Write to a session's PTY
   */
  writeToSession(sessionId: number, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.ptyProcess.write(data);
  }

  /**
   * Send a newline to a session
   */
  sendNewline(sessionId: number): void {
    this.writeToSession(sessionId, '\r');
  }

  /**
   * Send Ctrl-C to a session
   */
  sendInterrupt(sessionId: number): void {
    this.writeToSession(sessionId, '\x03');
  }

  /**
   * Send Ctrl-D to a session
   */
  sendEof(sessionId: number): void {
    this.writeToSession(sessionId, '\x04');
  }

  /**
   * Send Ctrl-Z to a session
   */
  sendSuspend(sessionId: number): void {
    this.writeToSession(sessionId, '\x1a');
  }

  /**
   * Send special key to a session
   */
  sendSpecialKey(sessionId: number, key: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const keyMap: Record<string, string> = {
      // Arrow keys
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D',
      // Common keys
      enter: '\r',
      tab: '\t',
      escape: '\x1b',
      backspace: '\x7f',
      delete: '\x1b[3~',
      // Navigation
      home: '\x1b[H',
      end: '\x1b[F',
      pgup: '\x1b[5~',
      pgdn: '\x1b[6~',
      // Function keys
      f1: '\x1bOP',
      f2: '\x1bOQ',
      f3: '\x1bOR',
      f4: '\x1bOS',
      f5: '\x1b[15~',
      f6: '\x1b[17~',
      f7: '\x1b[18~',
      f8: '\x1b[19~',
      f9: '\x1b[20~',
      f10: '\x1b[21~',
      f11: '\x1b[23~',
      f12: '\x1b[24~',
    };

    // Handle ctrl+key combinations
    const ctrlMatch = key.match(/^ctrl\+([a-z])$/i);
    if (ctrlMatch) {
      const char = ctrlMatch[1].toLowerCase();
      const code = char.charCodeAt(0) - 96; // a=1, b=2, etc.
      if (code >= 1 && code <= 26) {
        this.writeToSession(sessionId, String.fromCharCode(code));
        return;
      }
    }

    const sequence = keyMap[key.toLowerCase()];
    if (sequence) {
      this.writeToSession(sessionId, sequence);
    } else {
      // Unknown key, send as-is
      this.writeToSession(sessionId, key);
    }
  }

  /**
   * Resize a session's terminal
   */
  resizeSession(sessionId: number, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.ptyProcess.resize(cols, rows);
  }

  /**
   * Kill a session
   */
  async killSession(sessionId: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Kill the PTY process
    session.ptyProcess.kill();
    session.buffer.destroy();

    // Kill the tmux session
    try {
      await tmux.killSession(session.tmuxName);
    } catch (err) {
      console.warn('[PTY] Failed to kill tmux session:', err instanceof Error ? err.message : err);
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get active session IDs
   */
  getActiveSessions(): number[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if a session is active
   */
  isSessionActive(sessionId: number): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Flush all session buffers
   */
  flushAll(): void {
    for (const session of this.sessions.values()) {
      session.buffer.flush(FlushReason.MANUAL);
    }
  }

  /**
   * Kill all sessions
   */
  async killAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.killSession(sessionId);
    }
  }
}

// Singleton instance
let _ptyManager: PtyManager | null = null;

export function getPtyManager(outputCallback?: OutputCallback): PtyManager {
  if (!_ptyManager) {
    _ptyManager = new PtyManager(outputCallback);
  }
  return _ptyManager;
}

export function resetPtyManager(): void {
  _ptyManager = null;
}

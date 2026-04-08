import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import * as tmux from './tmux';

/**
 * Session information stored on disk
 */
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
}

/**
 * Sessions data structure for persistence
 */
interface SessionsData {
  sessions: SessionInfo[];
  nextId: number;
}

/**
 * Session manager for managing terminal sessions
 */
export class SessionManager {
  private dataDir: string;
  private sessionPrefix: string;
  private sessionsFile: string;
  private data: SessionsData;
  private config: ReturnType<typeof getConfig>;

  constructor() {
    this.config = getConfig();
    this.dataDir = this.config.session.dataDir;
    this.sessionPrefix = this.config.session.prefix;
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.data = this.loadSessions();
  }

  /**
   * Load sessions from disk, create file if not exists
   */
  private loadSessions(): SessionsData {
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Load existing sessions
    if (fs.existsSync(this.sessionsFile)) {
      try {
        const content = fs.readFileSync(this.sessionsFile, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Corrupted file, start fresh
      }
    }

    return { sessions: [], nextId: 0 };
  }

  /**
   * Save sessions to disk
   */
  private saveSessions(): void {
    fs.writeFileSync(this.sessionsFile, JSON.stringify(this.data, null, 2));
  }

  /**
   * Get tmux session name from session ID
   */
  private getTmuxName(sessionId: number): string {
    return `${this.sessionPrefix}-${sessionId}`;
  }

  /**
   * Create a new terminal session
   * @param conversationId - Optional Feishu conversation ID
   * @returns The new session info
   */
  async createSession(conversationId?: string): Promise<SessionInfo> {
    const id = this.data.nextId;
    const tmuxName = this.getTmuxName(id);

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

    // Record session
    const session: SessionInfo = {
      id,
      type: 'terminal',
      tmuxName,
      created: new Date().toISOString(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: number): SessionInfo | undefined {
    return this.data.sessions.find(s => s.id === sessionId);
  }

  /**
   * Get all sessions
   */
  getSessions(): SessionInfo[] {
    return [...this.data.sessions];
  }

  /**
   * Get the default session (first one, or create if none exist)
   */
  async getOrCreateDefaultSession(conversationId?: string): Promise<SessionInfo> {
    // Check if any sessions exist
    if (this.data.sessions.length > 0) {
      const firstSession = this.data.sessions[0];

      // For terminal sessions, verify they still exist in tmux
      if (firstSession.type === 'terminal' && firstSession.tmuxName) {
        const exists = await tmux.sessionExists(firstSession.tmuxName);
        if (exists) {
          return firstSession;
        }
        // Session doesn't exist in tmux, remove it
        await this.killSession(firstSession.id);
      } else {
        // Claude sessions are always valid
        return firstSession;
      }
    }

    // Create new default session
    return this.createSession(conversationId);
  }

  /**
   * Create a new Claude session (no tmux needed)
   */
  createClaudeSession(conversationId?: string): SessionInfo {
    const id = this.data.nextId;

    const session: SessionInfo = {
      id,
      type: 'claude',
      created: new Date().toISOString(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }

  /**
   * Update the Claude session ID (from system/init event)
   */
  updateClaudeSessionId(sessionId: number, claudeSessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
      this.saveSessions();
    }
  }

  /**
   * Update allowed tools for a Claude session
   */
  updateAllowedTools(sessionId: number, tools: string[]): void {
    const session = this.getSession(sessionId);
    if (session && session.type === 'claude') {
      session.allowedTools = tools;
      this.saveSessions();
    }
  }

  /**
   * Update permission mode for a Claude session
   */
  updatePermissionMode(sessionId: number, mode: 'default' | 'auto'): void {
    const session = this.getSession(sessionId);
    if (session && session.type === 'claude') {
      session.permissionMode = mode;
      this.saveSessions();
    }
  }

  /**
   * Kill a session by ID
   */
  async killSession(sessionId: number): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Only kill tmux for terminal sessions
    if (session.type === 'terminal' && session.tmuxName) {
      try {
        await tmux.killSession(session.tmuxName);
      } catch {
        // Session might not exist in tmux, ignore error
      }
    }

    this.data.sessions = this.data.sessions.filter(s => s.id !== sessionId);
    this.saveSessions();
  }

  /**
   * Send keystrokes to a session
   */
  async sendToSession(sessionId: number, keys: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.type !== 'terminal' || !session.tmuxName) {
      throw new Error(`Session ${sessionId} is not a terminal session`);
    }

    const exists = await tmux.sessionExists(session.tmuxName);
    if (!exists) {
      throw new Error(`Session ${sessionId} no longer exists in tmux`);
    }

    await tmux.sendKeys(session.tmuxName, keys);
  }

  /**
   * Capture output from a session
   */
  async captureSession(sessionId: number): Promise<string> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.type !== 'terminal' || !session.tmuxName) {
      throw new Error(`Session ${sessionId} is not a terminal session`);
    }

    return tmux.capturePane(session.tmuxName);
  }

  /**
   * Reconnect to existing tmux sessions on startup
   * Removes sessions that no longer exist in tmux
   */
  async reconnectSessions(): Promise<void> {
    const existingTmuxSessions = await tmux.listSessions();
    const validSessions: SessionInfo[] = [];

    for (const session of this.data.sessions) {
      // Claude sessions don't need tmux validation
      if (session.type === 'claude') {
        validSessions.push(session);
      } else if (session.tmuxName && existingTmuxSessions.includes(session.tmuxName)) {
        validSessions.push(session);
      }
    }

    // Update if any sessions were removed
    if (validSessions.length !== this.data.sessions.length) {
      this.data.sessions = validSessions;
      this.saveSessions();
    }
  }

  /**
   * Kill all sessions
   */
  async killAllSessions(): Promise<void> {
    for (const session of this.data.sessions) {
      if (session.type === 'terminal' && session.tmuxName) {
        try {
          await tmux.killSession(session.tmuxName);
        } catch {
          // Ignore errors
        }
      }
    }

    this.data.sessions = [];
    this.saveSessions();
  }

  /**
   * Get the count of active sessions
   */
  getSessionCount(): number {
    return this.data.sessions.length;
  }
}

// Singleton instance
let _sessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
}

export function resetSessionManager(): void {
  _sessionManager = null;
}

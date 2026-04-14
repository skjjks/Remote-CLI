import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import * as tmux from './tmux';

function nowTimestamp(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');
}

/**
 * Session information stored on disk
 */
export interface SessionInfo {
  id: number;
  type: 'claude' | 'opencode' | 'terminal' | 'clouddev';
  tmuxName?: string;
  created: string;
  conversationId?: string;
  // Claude-specific
  sdkSessionId?: string;
  permissionMode?: 'default' | 'auto';
  allowedTools?: string[];
  // Terminal interactive mode
  rawMode?: boolean; // undefined = auto-detect, true = forced raw
  // CloudDev connection status
  clouddevStatus?: 'connecting' | 'auth_waiting' | 'connected' | 'failed';
  lastActivity?: string; // ISO timestamp of last activity
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
      } catch (err) {
        // Corrupted file, start fresh
        console.warn('[SESSION] Failed to load sessions file:', err instanceof Error ? err.message : err);
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
      created: nowTimestamp(),
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

      // For terminal and clouddev sessions, verify they still exist in tmux
      if ((firstSession.type === 'terminal' || firstSession.type === 'clouddev') && firstSession.tmuxName) {
        const exists = await tmux.sessionExists(firstSession.tmuxName);
        if (exists) {
          return firstSession;
        }
        // Session doesn't exist in tmux, remove it
        await this.killSession(firstSession.id);
      } else {
        // Claude and opencode sessions are always valid
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
      created: nowTimestamp(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }

  /**
   * Create a new opencode session (no tmux needed)
   */
  createOpencodeSession(conversationId?: string): SessionInfo {
    const id = this.data.nextId;
    const session: SessionInfo = {
      id,
      type: 'opencode',
      created: nowTimestamp(),
      conversationId,
    };
    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();
    return session;
  }

  /**
   * Create a new clouddev session (uses tmux for SSH connection)
   */
  async createClouddevSession(conversationId?: string): Promise<SessionInfo> {
    const id = this.data.nextId;
    const tmuxName = this.getTmuxName(id);

    const exists = await tmux.sessionExists(tmuxName);
    if (!exists) {
      await tmux.createSession(
        tmuxName,
        this.config.terminal.shell,
        this.config.terminal.cols,
        this.config.terminal.rows
      );
    }

    const session: SessionInfo = {
      id,
      type: 'clouddev',
      tmuxName,
      created: nowTimestamp(),
      conversationId,
      clouddevStatus: 'connecting',
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }

  /**
   * Update the Claude session ID (from system/init event)
   */
  updateSdkSessionId(sessionId: number, sdkSessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.sdkSessionId = sdkSessionId;
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

  /**
   * Update the clouddev connection status
   */
  updateClouddevStatus(sessionId: number, status: 'connecting' | 'auth_waiting' | 'connected' | 'failed'): void {
    const session = this.getSession(sessionId);
    if (session && session.type === 'clouddev') {
      session.clouddevStatus = status;
      this.saveSessions();
    }
  }

  /**
   * Update last activity timestamp for a session
   */
  updateLastActivity(sessionId: number): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.lastActivity = nowTimestamp();
      this.saveSessions();
    }
  }

  /**
   * Remove sessions inactive for longer than maxAge (ms).
   * Returns number of sessions cleaned up.
   */
  async cleanupStaleSessions(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    const stale = this.data.sessions.filter(s => {
      const lastActive = s.lastActivity ? new Date(s.lastActivity).getTime() : new Date(s.created).getTime();
      return now - lastActive > maxAgeMs;
    });

    let cleaned = 0;
    for (const session of stale) {
      try {
        await this.killSession(session.id);
        cleaned++;
      } catch {
        // already gone
      }
    }
    return cleaned;
  }

  /**
   * Kill a session by ID
   */
  async killSession(sessionId: number): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Only kill tmux for terminal and clouddev sessions
    if ((session.type === 'terminal' || session.type === 'clouddev') && session.tmuxName) {
      try {
        await tmux.killSession(session.tmuxName);
      } catch (err) {
        // Session might not exist in tmux
        console.warn('[SESSION] Failed to kill tmux session:', err instanceof Error ? err.message : err);
      }
    }

    this.data.sessions = this.data.sessions.filter(s => s.id !== sessionId);

    // Reset nextId when all sessions are gone to prevent unbounded growth
    if (this.data.sessions.length === 0) {
      this.data.nextId = 0;
    }

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

    if ((session.type !== 'terminal' && session.type !== 'clouddev') || !session.tmuxName) {
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

    if ((session.type !== 'terminal' && session.type !== 'clouddev') || !session.tmuxName) {
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
      if (session.type === 'claude' || session.type === 'opencode') {
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
      if ((session.type === 'terminal' || session.type === 'clouddev') && session.tmuxName) {
        try {
          await tmux.killSession(session.tmuxName);
        } catch (err) {
          console.warn('[SESSION] Failed to kill tmux session during cleanup:', err instanceof Error ? err.message : err);
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
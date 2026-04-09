import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock tmux module before importing session manager
vi.mock('../src/terminal/tmux', () => ({
  sessionExists: vi.fn().mockResolvedValue(false),
  createSession: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  capturePane: vi.fn().mockResolvedValue(''),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{"sessions":[],"nextId":0}'),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{"sessions":[],"nextId":0}'),
  writeFileSync: vi.fn(),
}));

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
    server: { port: 3000, host: '0.0.0.0' },
    terminal: { cols: 80, rows: 24, shell: '/bin/bash' },
    session: { prefix: 'test', dataDir: '/tmp/test-sessions' },
    claude: { timeout: 300000, defaultMode: 'default', cardUpdateInterval: 500 },
  }),
}));

import { SessionManager } from '../src/terminal/session';

describe('SessionManager with session types', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('createSession defaults to terminal type', async () => {
    const session = await manager.createSession('conv1');
    expect(session.type).toBe('terminal');
    expect(session.tmuxName).toBeDefined();
  });

  it('createClaudeSession creates a claude-type session', () => {
    const session = manager.createClaudeSession('conv1');
    expect(session.type).toBe('claude');
    expect(session.tmuxName).toBeUndefined();
  });

  it('updateClaudeSessionId stores the Claude session ID', () => {
    const session = manager.createClaudeSession('conv1');
    manager.updateClaudeSessionId(session.id, 'claude-abc-123');
    const updated = manager.getSession(session.id);
    expect(updated?.claudeSessionId).toBe('claude-abc-123');
  });

  it('getSession returns correct type for both session types', async () => {
    const terminal = await manager.createSession('conv1');
    const claude = manager.createClaudeSession('conv2');

    expect(manager.getSession(terminal.id)?.type).toBe('terminal');
    expect(manager.getSession(claude.id)?.type).toBe('claude');
  });

  describe('rawMode', () => {
    it('should default rawMode to undefined', async () => {
      const session = await manager.createSession('conv-raw');
      expect(session.rawMode).toBeUndefined();
    });

    it('should update rawMode to true', async () => {
      const session = await manager.createSession('conv-raw2');
      manager.updateRawMode(session.id, true);
      const updated = manager.getSession(session.id);
      expect(updated?.rawMode).toBe(true);
    });

    it('should reset rawMode to undefined', async () => {
      const session = await manager.createSession('conv-raw3');
      manager.updateRawMode(session.id, true);
      manager.updateRawMode(session.id, undefined);
      const updated = manager.getSession(session.id);
      expect(updated?.rawMode).toBeUndefined();
    });
  });

  describe('updateLastActivity', () => {
    it('should update the lastActivity timestamp', async () => {
      const session = await manager.createSession('conv-activity');
      expect(session.lastActivity).toBeUndefined();

      manager.updateLastActivity(session.id);
      const updated = manager.getSession(session.id);
      expect(updated?.lastActivity).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(updated!.lastActivity!).getTime()).not.toBeNaN();
    });

    it('should update timestamp on subsequent calls', async () => {
      const session = await manager.createSession('conv-activity2');

      manager.updateLastActivity(session.id);
      const first = manager.getSession(session.id)!.lastActivity!;

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.updateLastActivity(session.id);
      const second = manager.getSession(session.id)!.lastActivity!;

      expect(new Date(second).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
    });
  });

  describe('cleanupStaleSessions', () => {
    it('should remove sessions older than maxAge', async () => {
      const session = await manager.createSession('conv-stale');
      // Manually set created to 2 days ago
      const s = manager.getSession(session.id)!;
      s.created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      const cleaned = await manager.cleanupStaleSessions(24 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should keep sessions with recent activity', async () => {
      const session = await manager.createSession('conv-active');
      // Created 2 days ago but active now
      const s = manager.getSession(session.id)!;
      s.created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      manager.updateLastActivity(session.id);

      const cleaned = await manager.cleanupStaleSessions(24 * 60 * 60 * 1000);
      expect(cleaned).toBe(0);
      expect(manager.getSession(session.id)).toBeDefined();
    });

    it('should return 0 when no stale sessions exist', async () => {
      await manager.createSession('conv-fresh');
      const cleaned = await manager.cleanupStaleSessions(24 * 60 * 60 * 1000);
      expect(cleaned).toBe(0);
    });
  });
});

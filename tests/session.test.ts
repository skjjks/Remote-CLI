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
});

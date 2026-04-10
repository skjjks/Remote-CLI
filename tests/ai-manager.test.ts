import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIManager, AIManagerCallbacks } from '../src/ai/manager';
import { CLAUDE_BACKEND, OPENCODE_BACKEND } from '../src/ai/backend';

// Mock the tmux module
vi.mock('../src/terminal/tmux', () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  sendLiteralKeys: vi.fn().mockResolvedValue(undefined),
  capturePane: vi.fn().mockResolvedValue(''),
  sessionExists: vi.fn().mockResolvedValue(true),
  killSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
    server: { port: 3000, host: '0.0.0.0' },
    terminal: { cols: 80, rows: 24, shell: '/bin/bash', historyLimit: 50000 },
    session: { prefix: 'test', dataDir: '/tmp/test' },
    claude: { timeout: 300000, defaultMode: 'default', cardUpdateInterval: 500 },
    opencode: { timeout: 300000, defaultMode: 'default' },
    timing: {
      shellCaptureDelay: 1500,
      rawModeCaptureDelay: 400,
      claudeStartupWait: 3000,
      claudePollInterval: 1000,
      claudeFirstPollDelay: 1500,
      claudeMenuPollDelay: 1000,
    },
  }),
}));

import * as tmux from '../src/terminal/tmux';

/**
 * Helper: start a session while advancing fake timers to resolve the
 * internal 3-second startup delay inside AIManager.startSession().
 */
async function startSessionWithTimers(
  manager: AIManager,
  convId: string,
  tmuxName: string,
  cwd?: string,
): Promise<void> {
  const promise = manager.startSession(convId, tmuxName, cwd);
  // Advance past the 3000ms startup sleep
  await vi.advanceTimersByTimeAsync(3100);
  return promise;
}

describe('AIManager', () => {
  let manager: AIManager;
  let callbacks: AIManagerCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    callbacks = {
      onStreamStart: vi.fn().mockResolvedValue('msg-001'),
      onStreamUpdate: vi.fn(),
      onStreamEnd: vi.fn(),
      onMenu: vi.fn(),
      onError: vi.fn(),
    };
    manager = new AIManager(callbacks, CLAUDE_BACKEND);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startSession creates a tmux session and sends claude command', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');

    expect(tmux.createSession).toHaveBeenCalledWith(
      'claude-conv1',
      'claude',
      80,
      24,
    );
    // capturePane is called to get initial content
    expect(tmux.capturePane).toHaveBeenCalledWith('claude-conv1');
  });

  it('startSession with cwd creates bash session and sends cd + claude command', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1', '/home/user/project');

    // When cwd is provided, it creates a bash session
    expect(tmux.createSession).toHaveBeenCalledWith(
      'claude-conv1',
      '/bin/bash',
      80,
      24,
    );
    // Then sends cd + claude command via sendKeys
    expect(tmux.sendKeys).toHaveBeenCalledWith(
      'claude-conv1',
      'cd /home/user/project && claude',
    );
    expect(tmux.sendKeys).toHaveBeenCalledWith('claude-conv1', 'Enter');
  });

  it('sendMessage sends text via tmux sendLiteralKeys and Enter via sendKeys', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');
    vi.clearAllMocks();

    await manager.sendMessage('conv1', 'say hello');

    // User text uses literal mode (no key name interpretation)
    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith('claude-conv1', 'say hello');
    // Enter uses regular sendKeys (control key)
    expect(tmux.sendKeys).toHaveBeenCalledWith('claude-conv1', 'Enter');
  });

  it('sendMessage calls onError when no session exists', async () => {
    await manager.sendMessage('nonexistent', 'hello');

    expect(callbacks.onError).toHaveBeenCalledWith(
      'nonexistent',
      'No active claude session',
    );
  });

  it('interruptSession sends C-c via tmux', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');

    await manager.interruptSession('conv1');
    expect(tmux.sendKeys).toHaveBeenCalledWith('claude-conv1', 'C-c');
  });

  it('isSessionActive returns correct state', async () => {
    expect(manager.isSessionActive('conv1')).toBe(false);
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');
    expect(manager.isSessionActive('conv1')).toBe(true);
  });

  it('isSessionAlive checks tmux session existence', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');

    (tmux.sessionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    expect(await manager.isSessionAlive('conv1')).toBe(true);

    (tmux.sessionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    expect(await manager.isSessionAlive('conv1')).toBe(false);
  });

  it('isSessionAlive returns false when session not registered', async () => {
    expect(await manager.isSessionAlive('nonexistent')).toBe(false);
  });

  it('killSession kills the tmux session and removes from map', async () => {
    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');
    expect(manager.isSessionActive('conv1')).toBe(true);

    await manager.killSession('conv1');
    expect(tmux.killSession).toHaveBeenCalledWith('claude-conv1');
    expect(manager.isSessionActive('conv1')).toBe(false);
  });

  it('pollForResponse streams output and calls onStreamEnd when stable', async () => {
    const captureMock = tmux.capturePane as ReturnType<typeof vi.fn>;
    captureMock.mockResolvedValue('');

    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');
    vi.clearAllMocks();

    const beforeScreen = 'Claude > ';
    const afterScreen = 'Claude > \nHello! How can I help you today?';

    // sendMessage first captures "before" content
    captureMock.mockResolvedValueOnce(beforeScreen);

    await manager.sendMessage('conv1', 'hello');

    // Polling starts after 1500ms initial delay
    // Poll 1: new content appears
    captureMock.mockResolvedValueOnce(afterScreen);
    await vi.advanceTimersByTimeAsync(1500);

    // Polls 2-4: same content (stableCount goes 1, 2, 3 -> triggers onStreamEnd)
    captureMock.mockResolvedValue(afterScreen);
    await vi.advanceTimersByTimeAsync(1000); // poll 2: stableCount=1
    await vi.advanceTimersByTimeAsync(1000); // poll 3: stableCount=2
    await vi.advanceTimersByTimeAsync(1000); // poll 4: stableCount=3 -> done

    expect(callbacks.onStreamStart).toHaveBeenCalledWith('conv1');
    expect(callbacks.onStreamEnd).toHaveBeenCalledWith(
      'conv1',
      'msg-001',
      expect.stringContaining('Hello! How can I help you today?'),
      expect.any(Object),
    );
  });

  it('pollForResponse calls onError on timeout', async () => {
    const captureMock = tmux.capturePane as ReturnType<typeof vi.fn>;
    captureMock.mockResolvedValue('');

    await startSessionWithTimers(manager, 'conv1', 'claude-conv1');
    vi.clearAllMocks();

    // Before content and all subsequent polls return the same content (no change)
    captureMock.mockResolvedValue('Claude > ');

    await manager.sendMessage('conv1', 'long task');

    // Advance past the 1500ms initial delay + enough time to exceed the 300000ms timeout
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(300000);

    expect(callbacks.onError).toHaveBeenCalledWith(
      'conv1',
      'claude response timed out',
    );
  });

  it('startSession with opencode backend uses opencode command', async () => {
    const ocManager = new AIManager(callbacks, OPENCODE_BACKEND);
    await startSessionWithTimers(ocManager, 'conv1', 'oc-conv1');
    expect(tmux.createSession).toHaveBeenCalledWith('oc-conv1', 'opencode', 80, 24);
  });
});

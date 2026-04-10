import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIManager, AIManagerCallbacks } from '../src/ai/manager';
import type { AISessionDriver } from '../src/ai/types';

/**
 * Helper: create a mock AISessionDriver with all methods stubbed.
 */
function createMockDriver(): AISessionDriver & { [K in keyof AISessionDriver]: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    selectMenuOption: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockResolvedValue(true),
    reconnect: vi.fn().mockResolvedValue(true),
    kill: vi.fn().mockResolvedValue(undefined),
    killAll: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockReturnValue(false),
    getSessionId: vi.fn().mockReturnValue(undefined),
  };
}

describe('AIManager', () => {
  let manager: AIManager;
  let callbacks: AIManagerCallbacks;
  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = {
      onStreamStart: vi.fn().mockResolvedValue('msg-001'),
      onStreamUpdate: vi.fn(),
      onStreamEnd: vi.fn(),
      onMenu: vi.fn(),
      onError: vi.fn(),
    };
    driver = createMockDriver();
    manager = new AIManager(callbacks, driver);
  });

  it('startSession delegates to driver.start', async () => {
    await manager.startSession('conv1', 'claude-conv1');
    expect(driver.start).toHaveBeenCalledWith('conv1', { cwd: undefined });
  });

  it('startSession passes cwd to driver.start', async () => {
    await manager.startSession('conv1', 'claude-conv1', '/home/user/project');
    expect(driver.start).toHaveBeenCalledWith('conv1', { cwd: '/home/user/project' });
  });

  it('sendMessage delegates to driver.sendMessage', async () => {
    await manager.sendMessage('conv1', 'say hello');
    expect(driver.sendMessage).toHaveBeenCalledWith('conv1', 'say hello');
  });

  it('selectMenuOption delegates to driver.selectMenuOption', async () => {
    await manager.selectMenuOption('conv1', 2);
    expect(driver.selectMenuOption).toHaveBeenCalledWith('conv1', 2);
  });

  it('interruptSession delegates to driver.interrupt', async () => {
    await manager.interruptSession('conv1');
    expect(driver.interrupt).toHaveBeenCalledWith('conv1');
  });

  it('isSessionActive delegates to driver.hasSession', () => {
    driver.hasSession.mockReturnValue(false);
    expect(manager.isSessionActive('conv1')).toBe(false);

    driver.hasSession.mockReturnValue(true);
    expect(manager.isSessionActive('conv1')).toBe(true);
  });

  it('isSessionAlive delegates to driver.isAlive', async () => {
    driver.isAlive.mockResolvedValue(true);
    expect(await manager.isSessionAlive('conv1')).toBe(true);

    driver.isAlive.mockResolvedValue(false);
    expect(await manager.isSessionAlive('conv1')).toBe(false);
  });

  it('killSession delegates to driver.kill', async () => {
    await manager.killSession('conv1');
    expect(driver.kill).toHaveBeenCalledWith('conv1');
  });

  it('reconnectSession delegates to driver.reconnect', async () => {
    driver.reconnect.mockResolvedValue(true);
    expect(await manager.reconnectSession('conv1', 'sess-123')).toBe(true);
    expect(driver.reconnect).toHaveBeenCalledWith('conv1', 'sess-123');

    driver.reconnect.mockResolvedValue(false);
    expect(await manager.reconnectSession('conv1', 'sess-gone')).toBe(false);
  });

  it('killAll delegates to driver.killAll', async () => {
    await manager.killAll();
    expect(driver.killAll).toHaveBeenCalled();
  });

  it('getSessionId delegates to driver.getSessionId', () => {
    driver.getSessionId.mockReturnValue('sdk-session-abc');
    expect(manager.getSessionId('conv1')).toBe('sdk-session-abc');

    driver.getSessionId.mockReturnValue(undefined);
    expect(manager.getSessionId('conv2')).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIManagerCallbacks } from '../src/ai/manager';

// --- Hoisted mocks (available inside vi.mock factory) ----------------------------

const {
  mockSessionCreate,
  mockSessionPromptAsync,
  mockSessionDelete,
  mockSessionAbort,
  mockSessionGet,
  mockServerClose,
  mockEventSubscribe,
  mockClient,
} = vi.hoisted(() => {
  const mockSessionCreate = vi.fn().mockResolvedValue({ data: { id: 'oc-sess-1' } });
  const mockSessionPromptAsync = vi.fn().mockResolvedValue(undefined);
  const mockSessionDelete = vi.fn().mockResolvedValue(undefined);
  const mockSessionAbort = vi.fn().mockResolvedValue(undefined);
  const mockSessionGet = vi.fn().mockResolvedValue({ data: { id: 'oc-sess-1' } });
  const mockServerClose = vi.fn();
  const mockEventSubscribe = vi.fn();

  const mockClient = {
    session: {
      create: (...args: any[]) => mockSessionCreate(...args),
      promptAsync: (...args: any[]) => mockSessionPromptAsync(...args),
      delete: (...args: any[]) => mockSessionDelete(...args),
      abort: (...args: any[]) => mockSessionAbort(...args),
      get: (...args: any[]) => mockSessionGet(...args),
    },
    event: {
      subscribe: (...args: any[]) => mockEventSubscribe(...args),
    },
  };

  return {
    mockSessionCreate,
    mockSessionPromptAsync,
    mockSessionDelete,
    mockSessionAbort,
    mockSessionGet,
    mockServerClose,
    mockEventSubscribe,
    mockClient,
  };
});

// Provide a stream that never yields (idle event loop)
async function* emptyStream(): AsyncGenerator<any> {
  await new Promise(() => {}); // hang forever
}

vi.mock('@opencode-ai/sdk', () => ({
  createOpencode: vi.fn().mockResolvedValue({
    client: mockClient,
    server: { url: 'http://localhost:0', close: mockServerClose },
  }),
}));

// --- Import after mocks ----------------------------------------------------------

import { OpencodeSDKDriver } from '../src/ai/drivers/opencode-sdk';

// --- Helpers ---------------------------------------------------------------------

function createCallbacks(): AIManagerCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onStreamStart: vi.fn().mockResolvedValue('msg-001'),
    onStreamUpdate: vi.fn(),
    onStreamEnd: vi.fn(),
    onMenu: vi.fn(),
    onError: vi.fn(),
  };
}

// --- Tests -----------------------------------------------------------------------

describe('OpencodeSDKDriver', () => {
  let driver: OpencodeSDKDriver;
  let callbacks: ReturnType<typeof createCallbacks>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset event subscribe to return a new hanging stream each time
    mockEventSubscribe.mockResolvedValue({ stream: emptyStream() });
    callbacks = createCallbacks();
    driver = new OpencodeSDKDriver(callbacks);
  });

  // 1. start() calls createOpencode() and session.create()
  it('start() calls createOpencode() and session.create()', async () => {
    await driver.start('conv-1', { cwd: '/tmp/project' });

    const { createOpencode } = await import('@opencode-ai/sdk');
    expect(createOpencode).toHaveBeenCalled();
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { title: expect.stringContaining('feishu-') },
        query: { directory: '/tmp/project' },
      }),
    );
    expect(driver.hasSession('conv-1')).toBe(true);
    expect(driver.getSessionId('conv-1')).toBe('oc-sess-1');
  });

  // 2. sendMessage() calls session.promptAsync()
  it('sendMessage() calls session.promptAsync()', async () => {
    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'hello opencode');

    expect(mockSessionPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'oc-sess-1' },
        body: expect.objectContaining({
          parts: [{ type: 'text', text: 'hello opencode' }],
        }),
      }),
    );
  });

  // 3. hasSession() returns correct state
  it('hasSession() returns correct state', async () => {
    expect(driver.hasSession('conv-1')).toBe(false);
    await driver.start('conv-1', {});
    expect(driver.hasSession('conv-1')).toBe(true);
  });

  // 4. kill() calls session.delete()
  it('kill() calls session.delete()', async () => {
    await driver.start('conv-1', {});
    await driver.kill('conv-1');

    expect(mockSessionDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'oc-sess-1' },
      }),
    );
    expect(driver.hasSession('conv-1')).toBe(false);
  });

  // 5. killAll() closes the server
  it('killAll() closes the server', async () => {
    await driver.start('conv-1', {});
    await driver.start('conv-2', {});

    await driver.killAll();

    expect(mockSessionDelete).toHaveBeenCalledTimes(2);
    expect(mockServerClose).toHaveBeenCalled();
    expect(driver.hasSession('conv-1')).toBe(false);
    expect(driver.hasSession('conv-2')).toBe(false);
  });

  // 6. interrupt() calls session.abort()
  it('interrupt() calls session.abort()', async () => {
    await driver.start('conv-1', {});
    await driver.interrupt('conv-1');

    expect(mockSessionAbort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'oc-sess-1' },
      }),
    );
  });

  // Extra: sendMessage on non-existent session calls onError
  it('sendMessage on non-existent session calls onError', async () => {
    await driver.sendMessage('no-such', 'hi');
    expect(callbacks.onError).toHaveBeenCalledWith('no-such', 'No active opencode session');
  });

  // Extra: getSessionId returns session ID after start
  it('getSessionId() returns session ID after start', async () => {
    expect(driver.getSessionId('conv-1')).toBeUndefined();
    await driver.start('conv-1', {});
    expect(driver.getSessionId('conv-1')).toBe('oc-sess-1');
  });

  // Extra: sendMessage creates a Feishu card via onStreamStart
  it('sendMessage() calls onStreamStart to create card', async () => {
    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'build it');

    expect(callbacks.onStreamStart).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        backend: 'opencode',
        sessionId: 'oc-sess-1',
        status: 'thinking',
      })
    );
  });
});

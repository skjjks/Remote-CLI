import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIManagerCallbacks } from '../src/ai/manager';

// --- Mock the SDK ----------------------------------------------------------------

const mockInterrupt = vi.fn().mockResolvedValue(undefined);
const mockReturn = vi.fn().mockResolvedValue(undefined);

/** Helper: create an async generator that yields messages and exposes interrupt/return. */
async function* mockMessages(msgs: any[]): AsyncGenerator<any> {
  for (const msg of msgs) {
    yield msg;
  }
}

function makeMockQuery(msgs: any[] = []): any {
  const gen = mockMessages(msgs);
  // Attach interrupt / return helpers expected by the driver
  (gen as any).interrupt = mockInterrupt;
  const originalReturn = gen.return.bind(gen);
  (gen as any).return = (...args: any[]) => {
    mockReturn(...args);
    return originalReturn(...args);
  };
  return gen;
}

const mockQuery = vi.fn<any>().mockReturnValue(makeMockQuery());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

// Mock getConfig so it doesn't try to read env vars
vi.mock('../src/config', () => ({
  getConfig: () => ({
    claude: {
      defaultMode: 'default',
      cardUpdateInterval: 500,
    },
  }),
}));

// --- Import after mocks ----------------------------------------------------------

import { ClaudeSDKDriver } from '../src/ai/drivers/claude-sdk';

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

describe('ClaudeSDKDriver', () => {
  let driver: ClaudeSDKDriver;
  let callbacks: ReturnType<typeof createCallbacks>;

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = createCallbacks();
    driver = new ClaudeSDKDriver(callbacks);
  });

  // 1. start() registers a session in memory
  it('start() registers a session in memory', async () => {
    await driver.start('conv-1', { cwd: '/tmp' });
    expect(driver.hasSession('conv-1')).toBe(true);
  });

  // 2. sendMessage() calls query() with correct options
  it('sendMessage() calls query() with correct options', async () => {
    // Provide a query that yields a result so consumeStream finishes
    mockQuery.mockReturnValueOnce(makeMockQuery([
      { type: 'result', result: 'done', total_cost_usd: 0.01 },
    ]));

    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'hello');

    // Give the background consumeStream a tick to run
    await new Promise(r => setTimeout(r, 50));

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello',
        options: expect.objectContaining({
          allowedTools: expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']),
        }),
      }),
    );
  });

  // 3. sendMessage() with existing session includes resume option
  it('sendMessage() with existing session includes resume option', async () => {
    // First message: stream with init event that sets session ID
    mockQuery.mockReturnValueOnce(makeMockQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-abc' },
      { type: 'result', result: 'ok', total_cost_usd: 0 },
    ]));
    // Second message: stream that finishes
    mockQuery.mockReturnValueOnce(makeMockQuery([
      { type: 'result', result: 'ok', total_cost_usd: 0 },
    ]));

    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'first');
    await new Promise(r => setTimeout(r, 50));

    // Session ID should be captured from the init event
    expect(driver.getSessionId('conv-1')).toBe('sess-abc');

    await driver.sendMessage('conv-1', 'second');
    await new Promise(r => setTimeout(r, 50));

    // The second call should include resume
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: 'second',
        options: expect.objectContaining({
          resume: 'sess-abc',
        }),
      }),
    );
  });

  // 4. hasSession() returns correct state
  it('hasSession() returns correct state', async () => {
    expect(driver.hasSession('conv-1')).toBe(false);
    await driver.start('conv-1', {});
    expect(driver.hasSession('conv-1')).toBe(true);
  });

  // 5. getSessionId() returns session ID after init
  it('getSessionId() returns session ID after init event', async () => {
    mockQuery.mockReturnValueOnce(makeMockQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-xyz' },
      { type: 'result', result: 'ok', total_cost_usd: 0 },
    ]));

    await driver.start('conv-1', {});
    expect(driver.getSessionId('conv-1')).toBeUndefined();

    await driver.sendMessage('conv-1', 'hi');
    await new Promise(r => setTimeout(r, 50));

    expect(driver.getSessionId('conv-1')).toBe('sess-xyz');
  });

  // 6. kill() removes the session
  it('kill() removes the session', async () => {
    await driver.start('conv-1', {});
    expect(driver.hasSession('conv-1')).toBe(true);

    await driver.kill('conv-1');
    expect(driver.hasSession('conv-1')).toBe(false);
  });

  // 7. killAll() clears all sessions
  it('killAll() clears all sessions', async () => {
    await driver.start('conv-1', {});
    await driver.start('conv-2', {});
    expect(driver.hasSession('conv-1')).toBe(true);
    expect(driver.hasSession('conv-2')).toBe(true);

    await driver.killAll();
    expect(driver.hasSession('conv-1')).toBe(false);
    expect(driver.hasSession('conv-2')).toBe(false);
  });

  // 8. interrupt() calls query.interrupt()
  it('interrupt() calls activeQuery.interrupt()', async () => {
    // Create a query that never finishes (no messages yielded)
    const hangingQuery = makeMockQuery([]);
    // Override [Symbol.asyncIterator] to hang
    const neverResolve = new Promise<IteratorResult<any>>(() => {});
    hangingQuery.next = () => neverResolve;
    mockQuery.mockReturnValueOnce(hangingQuery);

    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'work');

    // The stream is hanging -- activeQuery is set
    await driver.interrupt('conv-1');
    expect(mockInterrupt).toHaveBeenCalled();
  });

  // 9. isAlive() returns true for registered sessions
  it('isAlive() returns true for registered sessions', async () => {
    expect(await driver.isAlive('conv-1')).toBe(false);
    await driver.start('conv-1', {});
    expect(await driver.isAlive('conv-1')).toBe(true);
  });

  // 10. reconnect() stores session ID for resume
  it('reconnect() stores session ID for resume', async () => {
    const result = await driver.reconnect('conv-1', 'sess-reconnect');
    expect(result).toBe(true);
    expect(driver.hasSession('conv-1')).toBe(true);
    expect(driver.getSessionId('conv-1')).toBe('sess-reconnect');
  });

  // Extra: sendMessage on non-existent session calls onError
  it('sendMessage on non-existent session calls onError', async () => {
    await driver.sendMessage('no-such', 'hello');
    expect(callbacks.onError).toHaveBeenCalledWith('no-such', 'No active Claude session');
  });

  // Extra: kill() on session with active query calls return()
  it('kill() closes activeQuery via return()', async () => {
    const hangingQuery = makeMockQuery([]);
    const neverResolve = new Promise<IteratorResult<any>>(() => {});
    hangingQuery.next = () => neverResolve;
    mockQuery.mockReturnValueOnce(hangingQuery);

    await driver.start('conv-1', {});
    await driver.sendMessage('conv-1', 'work');

    await driver.kill('conv-1');
    expect(mockReturn).toHaveBeenCalled();
    expect(driver.hasSession('conv-1')).toBe(false);
  });
});

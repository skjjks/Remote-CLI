import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeManager, ClaudeManagerCallbacks } from '../src/claude/manager';

// Mock child_process
vi.mock('child_process', () => {
  const EventEmitter = require('events');

  function createMockProcess() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
  }

  return {
    spawn: vi.fn(() => createMockProcess()),
  };
});

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
    server: { port: 3000, host: '0.0.0.0' },
    terminal: { cols: 80, rows: 24, shell: '/bin/bash' },
    session: { prefix: 'test', dataDir: '/tmp/test' },
    claude: { timeout: 300000, defaultMode: 'default', cardUpdateInterval: 500 },
  }),
}));

import { spawn } from 'child_process';

describe('ClaudeManager', () => {
  let manager: ClaudeManager;
  let callbacks: ClaudeManagerCallbacks;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = {
      onInit: vi.fn(),
      onText: vi.fn(),
      onToolUse: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
    };
    manager = new ClaudeManager(callbacks);
    mockSpawn = spawn as any;
  });

  it('startSession spawns a claude process', () => {
    manager.startSession('conv1', 'say hello');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0];
    expect(args[0]).toBe('claude');
    expect(args[1]).toContain('-p');
    expect(args[1]).toContain('--output-format');
    expect(args[1]).toContain('stream-json');
  });

  it('startSession with resumeId includes --resume flag', () => {
    manager.startSession('conv1', 'follow up', { resumeId: 'abc-123' });
    const args = mockSpawn.mock.calls[0];
    expect(args[1]).toContain('--resume');
    expect(args[1]).toContain('abc-123');
  });

  it('processes init event from stdout', () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    const initEvent = '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-abc","tools":["Bash"],"model":"opus","permissionMode":"default"}\n';
    proc.stdout.emit('data', initEvent);

    expect(callbacks.onInit).toHaveBeenCalledWith('conv1', expect.objectContaining({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-abc',
    }));
  });

  it('processes assistant text event from stdout', () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    const assistantEvent = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg1',
        model: 'opus',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      session_id: 'sess-abc',
    }) + '\n';
    proc.stdout.emit('data', assistantEvent);

    expect(callbacks.onText).toHaveBeenCalledWith('conv1', 'Hello world');
  });

  it('processes tool_use event from stdout', () => {
    manager.startSession('conv1', 'list files');
    const proc = mockSpawn.mock.results[0].value;

    const assistantEvent = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg1',
        model: 'opus',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'ls' } }],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      session_id: 'sess-abc',
    }) + '\n';
    proc.stdout.emit('data', assistantEvent);

    expect(callbacks.onToolUse).toHaveBeenCalledWith('conv1', 'Bash', { command: 'ls' });
  });

  it('processes result event from stdout', () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    const resultEvent = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: 1,
      result: 'Hello!',
      session_id: 'sess-abc',
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 10 },
      permission_denials: [],
    }) + '\n';
    proc.stdout.emit('data', resultEvent);

    expect(callbacks.onResult).toHaveBeenCalledWith('conv1', expect.objectContaining({
      type: 'result',
      duration_ms: 5000,
      total_cost_usd: 0.05,
    }));
  });

  it('interruptSession kills the child process', () => {
    manager.startSession('conv1', 'long task');
    const proc = mockSpawn.mock.results[0].value;

    manager.interruptSession('conv1');
    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('isSessionActive returns correct state', () => {
    expect(manager.isSessionActive('conv1')).toBe(false);
    manager.startSession('conv1', 'hello');
    expect(manager.isSessionActive('conv1')).toBe(true);
  });
});

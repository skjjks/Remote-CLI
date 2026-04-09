import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import {
  createSession,
  attachSession,
  killSession,
  listSessions,
  sessionExists,
  sendKeys,
  sendLiteralKeys,
  capturePane,
  getCurrentCommand,
} from '../src/terminal/tmux';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('tmux', () => {
  let mockProcess: {
    stdout: { on: vi.Mock };
    stderr: { on: vi.Mock };
    on: vi.Mock;
  };

  beforeEach(() => {
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('should execute tmux new-session with correct arguments', async () => {
      // createSession calls executeTmux twice (new-session + set-option),
      // so spawn is invoked twice. Return a fresh auto-resolving mock each time.
      vi.mocked(spawn).mockImplementation(() => {
        const proc = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
            if (event === 'close') {
              process.nextTick(() => cb(0));
            }
          }),
        };
        return proc as unknown as ReturnType<typeof spawn>;
      });

      await createSession('test-session', '/bin/bash', 120, 40);

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'test-session', '-x', '120', '-y', '40', '/bin/bash'],
        expect.objectContaining({
          env: expect.objectContaining({
            TERM: 'xterm-256color',
          }),
        })
      );
      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['set-option', '-t', 'test-session', 'history-limit', '50000'],
        expect.any(Object)
      );
    });

    it('should throw error when tmux fails', async () => {
      const promise = createSession('test-session', '/bin/bash', 80, 24);

      // Simulate error output
      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('session already exists'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('session already exists');
    });
  });

  describe('attachSession', () => {
    it('should execute tmux attach-session with correct arguments', async () => {
      const promise = attachSession('my-session');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['attach-session', '-t', 'my-session'],
        expect.any(Object)
      );
    });
  });

  describe('killSession', () => {
    it('should execute tmux kill-session with correct arguments', async () => {
      const promise = killSession('session-to-kill');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'session-to-kill'],
        expect.any(Object)
      );
    });

    it('should throw error when killing non-existent session', async () => {
      const promise = killSession('non-existent');

      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('no session found'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('no session found');
    });
  });

  describe('listSessions', () => {
    it('should return array of session names', async () => {
      const promise = listSessions();

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('session1\nsession2\nsession3'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['list-sessions', '-F', '#{session_name}'],
        expect.any(Object)
      );
      expect(result).toEqual(['session1', 'session2', 'session3']);
    });

    it('should return empty array when no sessions exist', async () => {
      const promise = listSessions();

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from(''));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(result).toEqual([]);
    });

    it('should return empty array when tmux server not running', async () => {
      const promise = listSessions();

      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('no server running on /tmp/tmux-1000/default'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      const result = await promise;

      expect(result).toEqual([]);
    });
  });

  describe('sessionExists', () => {
    it('should return true when session exists', async () => {
      const promise = sessionExists('existing-session');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['has-session', '-t', 'existing-session'],
        expect.any(Object)
      );
      expect(result).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      const promise = sessionExists('non-existent-session');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      const result = await promise;

      expect(result).toBe(false);
    });
  });

  describe('sendKeys', () => {
    it('should execute tmux send-keys with correct arguments', async () => {
      const promise = sendKeys('my-session', 'ls -la');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'my-session', 'ls -la'],
        expect.any(Object)
      );
    });

    it('should handle special keys', async () => {
      const promise = sendKeys('my-session', 'Enter');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'my-session', 'Enter'],
        expect.any(Object)
      );
    });

    it('should throw error when send-keys fails', async () => {
      const promise = sendKeys('non-existent', 'test');

      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('no session'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('no session');
    });
  });

  describe('sendLiteralKeys', () => {
    it('should execute tmux send-keys with -l flag for literal text', async () => {
      const promise = sendLiteralKeys('my-session', 'some text with Enter and Escape');

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'my-session', '-l', 'some text with Enter and Escape'],
        expect.any(Object)
      );
    });

    it('should throw error when send-keys -l fails', async () => {
      const promise = sendLiteralKeys('non-existent', 'test');

      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('no session'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('no session');
    });
  });

  describe('capturePane', () => {
    it('should execute tmux capture-pane with correct arguments', async () => {
      const promise = capturePane('my-session');

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('line1\nline2\nline3'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['capture-pane', '-t', 'my-session', '-p', '-S', '-', '-E', '-'],
        expect.any(Object)
      );
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should return empty string when pane is empty', async () => {
      const promise = capturePane('empty-session');

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from(''));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(result).toBe('');
    });

    it('should throw error when capture-pane fails', async () => {
      const promise = capturePane('non-existent');

      mockProcess.stderr.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('no session'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('no session');
    });
  });

  describe('getCurrentCommand', () => {
    it('should execute tmux display-message with correct arguments', async () => {
      const promise = getCurrentCommand('my-session');

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('vim'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'tmux',
        ['display-message', '-p', '-t', 'my-session', '#{pane_current_command}'],
        expect.any(Object)
      );
      expect(result).toBe('vim');
    });

    it('should return shell name when no program is running', async () => {
      const promise = getCurrentCommand('my-session');

      mockProcess.stdout.on.mock.calls.find((call: unknown[]) => call[0] === 'data')?.[1](Buffer.from('bash'));
      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](0);

      const result = await promise;
      expect(result).toBe('bash');
    });
  });

  describe('error handling', () => {
    it('should handle spawn errors', async () => {
      const promise = createSession('test', '/bin/bash', 80, 24);

      // Simulate spawn error
      const errorCall = mockProcess.on.mock.calls.find(call => call[0] === 'error');
      errorCall?.[1](new Error('spawn tmux ENOENT'));

      await expect(promise).rejects.toThrow('Failed to execute tmux: spawn tmux ENOENT');
    });

    it('should handle non-zero exit code without stderr', async () => {
      const promise = createSession('test', '/bin/bash', 80, 24);

      const call = mockProcess.on.mock.calls.find(call => call[0] === 'close');
      call?.[1](1);

      await expect(promise).rejects.toThrow('tmux exited with code 1');
    });
  });
});
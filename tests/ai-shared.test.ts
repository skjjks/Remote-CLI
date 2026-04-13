import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMetadata, createThrottledUpdater, createPendingRequest, resolvePendingInput } from '../src/ai/shared';
import type { AIManagerCallbacks } from '../src/ai/manager';
import { pendingRequests } from '../src/state';

describe('ai/shared', () => {
  describe('buildMetadata', () => {
    it('returns metadata with all fields', () => {
      const result = buildMetadata({
        backend: 'claude',
        sessionId: 'sess-1',
        model: 'claude-opus-4-6',
        cwd: '/home/user',
        status: 'working',
        costUsd: 0.05,
        inputTokens: 100,
        outputTokens: 200,
      });

      expect(result).toEqual({
        backend: 'claude',
        sessionId: 'sess-1',
        model: 'claude-opus-4-6',
        cwd: '/home/user',
        status: 'working',
        costUsd: 0.05,
        inputTokens: 100,
        outputTokens: 200,
      });
    });

    it('returns metadata with only required fields', () => {
      const result = buildMetadata({
        backend: 'opencode',
        status: 'thinking',
      });

      expect(result).toEqual({
        backend: 'opencode',
        sessionId: undefined,
        model: undefined,
        cwd: undefined,
        status: 'thinking',
        costUsd: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
      });
    });

    it('handles done status with cost info', () => {
      const result = buildMetadata({
        backend: 'claude',
        sessionId: 'sess-2',
        model: 'claude-sonnet-4-6',
        cwd: '/workspace',
        status: 'done',
        costUsd: 0.12,
        inputTokens: 500,
        outputTokens: 1000,
      });

      expect(result.status).toBe('done');
      expect(result.costUsd).toBe(0.12);
    });
  });

  describe('createThrottledUpdater', () => {
    let mockCallbacks: AIManagerCallbacks;

    beforeEach(() => {
      mockCallbacks = {
        onStreamStart: vi.fn().mockResolvedValue('msg-1'),
        onStreamUpdate: vi.fn(),
        onStreamEnd: vi.fn(),
        onMenu: vi.fn(),
        onError: vi.fn(),
      };
    });

    it('calls onStreamUpdate immediately on first update', () => {
      const throttle = createThrottledUpdater(mockCallbacks, 1000);
      const meta = buildMetadata({ backend: 'claude', status: 'working' });

      throttle.update('conv-1', 'msg-1', 'hello', meta);

      expect(mockCallbacks.onStreamUpdate).toHaveBeenCalledWith('conv-1', 'msg-1', 'hello', meta);
    });

    it('suppresses rapid updates within interval', () => {
      const throttle = createThrottledUpdater(mockCallbacks, 1000);
      const meta = buildMetadata({ backend: 'claude', status: 'working' });

      throttle.update('conv-1', 'msg-1', 'hello', meta);
      throttle.update('conv-1', 'msg-1', 'hello world', meta);
      throttle.update('conv-1', 'msg-1', 'hello world!', meta);

      expect(mockCallbacks.onStreamUpdate).toHaveBeenCalledTimes(1);
      expect(throttle.hasPending()).toBe(true);
    });

    it('flush sends the latest content', () => {
      const throttle = createThrottledUpdater(mockCallbacks, 1000);
      const meta = buildMetadata({ backend: 'claude', status: 'working' });

      throttle.update('conv-1', 'msg-1', 'hello', meta);
      throttle.update('conv-1', 'msg-1', 'hello world', meta);
      throttle.flush('conv-1', 'msg-1', 'hello world', meta);

      expect(mockCallbacks.onStreamUpdate).toHaveBeenCalledTimes(2);
      expect(mockCallbacks.onStreamUpdate).toHaveBeenLastCalledWith('conv-1', 'msg-1', 'hello world', meta);
    });

    it('flush is a no-op when nothing is pending', () => {
      const throttle = createThrottledUpdater(mockCallbacks, 1000);
      const meta = buildMetadata({ backend: 'claude', status: 'working' });

      throttle.flush('conv-1', 'msg-1', 'hello', meta);

      expect(mockCallbacks.onStreamUpdate).not.toHaveBeenCalled();
    });

    it('reset clears pending state and timer', () => {
      const throttle = createThrottledUpdater(mockCallbacks, 1000);
      const meta = buildMetadata({ backend: 'claude', status: 'working' });

      throttle.update('conv-1', 'msg-1', 'hello', meta);
      throttle.update('conv-1', 'msg-1', 'hello world', meta);
      expect(throttle.hasPending()).toBe(true);

      throttle.reset();
      expect(throttle.hasPending()).toBe(false);

      throttle.update('conv-1', 'msg-1', 'new content', meta);
      expect(mockCallbacks.onStreamUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('createPendingRequest / resolvePendingInput', () => {
    beforeEach(() => {
      pendingRequests.clear();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      pendingRequests.clear();
    });

    it('createPendingRequest stores a request in pendingRequests', () => {
      const resolve = vi.fn();
      const id = createPendingRequest('permission', 'conv-1', resolve, 300000);

      expect(pendingRequests.has(id)).toBe(true);
      expect(pendingRequests.get(id)!.type).toBe('permission');
      expect(pendingRequests.get(id)!.conversationId).toBe('conv-1');
    });

    it('createPendingRequest auto-denies permission after timeout', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 5000);

      vi.advanceTimersByTime(5000);

      expect(resolve).toHaveBeenCalledWith({ behavior: 'deny', message: 'Permission request timed out' });
      expect(pendingRequests.size).toBe(0);
    });

    it('createPendingRequest auto-declines question after timeout', () => {
      const resolve = vi.fn();
      createPendingRequest('question', 'conv-1', resolve, 5000);

      vi.advanceTimersByTime(5000);

      expect(resolve).toHaveBeenCalledWith({ action: 'decline' });
    });

    it('createPendingRequest calls custom onTimeout if provided', () => {
      const resolve = vi.fn();
      const onTimeout = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 5000, onTimeout);

      vi.advanceTimersByTime(5000);

      expect(onTimeout).toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    });

    it('resolvePendingInput returns false for non-numeric input', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 300000);

      expect(resolvePendingInput('conv-1', 'hello')).toBe(false);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('resolvePendingInput returns false when no pending request', () => {
      expect(resolvePendingInput('conv-1', '0')).toBe(false);
    });

    it('resolvePendingInput resolves permission allow (0)', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 300000);

      expect(resolvePendingInput('conv-1', '0')).toBe(true);
      expect(resolve).toHaveBeenCalledWith({ behavior: 'allow' });
      expect(pendingRequests.size).toBe(0);
    });

    it('resolvePendingInput resolves permission deny (1)', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 300000);

      expect(resolvePendingInput('conv-1', '1')).toBe(true);
      expect(resolve).toHaveBeenCalledWith({ behavior: 'deny', message: 'User denied permission' });
    });

    it('resolvePendingInput resolves permission allow-all (2)', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 300000);

      expect(resolvePendingInput('conv-1', '2')).toBe(true);
      expect(resolve).toHaveBeenCalledWith({ behavior: 'allow', updatedPermissions: [] });
    });

    it('resolvePendingInput resolves question with choice index', () => {
      const resolve = vi.fn();
      createPendingRequest('question', 'conv-1', resolve, 300000);

      expect(resolvePendingInput('conv-1', '1')).toBe(true);
      expect(resolve).toHaveBeenCalledWith(1);
    });

    it('resolvePendingInput clears the timeout timer', () => {
      const resolve = vi.fn();
      createPendingRequest('permission', 'conv-1', resolve, 5000);

      resolvePendingInput('conv-1', '0');

      vi.advanceTimersByTime(10000);
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });
});

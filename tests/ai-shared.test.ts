import { describe, it, expect } from 'vitest';
import { buildMetadata } from '../src/ai/shared';

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
});

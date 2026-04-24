import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getModelShortcuts, resolveModel, getPopularModels } from '../src/ai/models';
import * as modelDiscovery from '../src/ai/model-discovery';

describe('ai/models', () => {
  beforeEach(() => {
    modelDiscovery.__resetModelDiscoveryCache__();
    vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'claude-opus-4-6');
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'claude-sonnet-4-6');
    vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'claude-haiku-4-5-20251001');
    vi.stubEnv('HOME', '/nonexistent');
  });

  describe('getModelShortcuts', () => {
    it('returns claude shortcuts for claude backend', () => {
      const shortcuts = getModelShortcuts('claude');
      expect(shortcuts).toHaveProperty('opus');
      expect(shortcuts).toHaveProperty('sonnet');
      expect(shortcuts).toHaveProperty('haiku');
      expect(shortcuts.opus).toContain('claude');
    });

    it('returns opencode shortcuts for opencode backend', () => {
      const shortcuts = getModelShortcuts('opencode');
      expect(shortcuts).toHaveProperty('opus');
      expect(shortcuts.opus).toContain('/');
    });
  });

  describe('resolveModel', () => {
    it('resolves claude shortcut', () => {
      const result = resolveModel('claude', 'opus');
      expect(result).toContain('claude');
      expect(result).toContain('opus');
    });

    it('resolves opencode shortcut', () => {
      const result = resolveModel('opencode', 'opus');
      expect(result).toContain('/');
    });

    it('returns raw input when shortcut not found', () => {
      const result = resolveModel('claude', 'some-custom-model-id');
      expect(result).toBe('some-custom-model-id');
    });

    it('resolves case-insensitively', () => {
      const result = resolveModel('claude', 'OPUS');
      expect(result).toContain('claude');
    });
  });

  describe('getPopularModels', () => {
    it('returns claude popular models', () => {
      const models = getPopularModels('claude');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models[0]).toHaveProperty('shortcut');
      expect(models[0]).toHaveProperty('model');
    });

    it('returns opencode popular models', () => {
      const models = getPopularModels('opencode');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models[0]).toHaveProperty('shortcut');
      expect(models[0]).toHaveProperty('model');
    });
  });
});

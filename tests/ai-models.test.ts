import { describe, it, expect } from 'vitest';
import { getModelShortcuts, resolveModel, getPopularModels } from '../src/ai/models';

describe('ai/models', () => {
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
      expect(shortcuts).toHaveProperty('gpt5');
      expect(shortcuts).toHaveProperty('gemini');
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
      const result = resolveModel('opencode', 'gpt5');
      expect(result).toContain('gpt');
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
    it('returns claude popular models with descriptions', () => {
      const models = getPopularModels('claude');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models[0]).toHaveProperty('shortcut');
      expect(models[0]).toHaveProperty('model');
      expect(models[0]).toHaveProperty('desc');
    });

    it('returns opencode popular models', () => {
      const models = getPopularModels('opencode');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models[0]).toHaveProperty('shortcut');
      expect(models[0]).toHaveProperty('model');
    });
  });
});

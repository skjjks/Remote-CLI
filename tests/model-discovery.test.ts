import { describe, test, expect, beforeEach } from 'vitest';
import { discoverClaudeModels, __resetModelDiscoveryCache__ } from '../src/ai/model-discovery';

describe('discoverClaudeModels', () => {
  beforeEach(() => {
    __resetModelDiscoveryCache__();
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  });

  test('returns all 3 slots when all env vars set', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'ppio/pa/claude-opus-4-7';
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'ppio/pa/claude-sonnet-4-5';
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'ppio/pa/claude-haiku-4-5';

    const result = discoverClaudeModels();

    expect(result).toEqual([
      { shortcut: 'opus', model: 'ppio/pa/claude-opus-4-7' },
      { shortcut: 'sonnet', model: 'ppio/pa/claude-sonnet-4-5' },
      { shortcut: 'haiku', model: 'ppio/pa/claude-haiku-4-5' },
    ]);
  });

  test('omits missing slots (no fallback hallucination)', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'some/model';
    const result = discoverClaudeModels();
    expect(result).toEqual([{ shortcut: 'opus', model: 'some/model' }]);
  });

  test('returns empty array when no env vars set', () => {
    const result = discoverClaudeModels();
    expect(result).toEqual([]);
  });
});

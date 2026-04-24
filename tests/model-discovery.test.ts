import { describe, test, expect, beforeEach, afterEach } from 'vitest';
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

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverOpencodeModels } from '../src/ai/model-discovery';

describe('discoverOpencodeModels', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    __resetModelDiscoveryCache__();
    tmpDir = mkdtempSync(join(tmpdir(), 'model-discovery-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeOpencodeConfig(content: string): void {
    const configDir = join(tmpDir, '.config', 'opencode');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'opencode.json'), content);
  }

  test('reads 2 providers × 2 models into 4 grouped entries', () => {
    writeOpencodeConfig(JSON.stringify({
      provider: {
        'Mify-OpenAI': {
          models: {
            'azure_openai/gpt-5.4-pro': { name: 'azure_openai/gpt-5.4-pro' },
            'azure_openai/gpt-5.1-codex': { name: 'azure_openai/gpt-5.1-codex' },
          },
        },
        'Mify-Anthropic': {
          models: {
            'ppio/pa/claude-opus-4-7': {},
            'ppio/pa/claude-sonnet-4-6': {},
          },
        },
      },
    }));

    const result = discoverOpencodeModels();

    expect(result).toHaveLength(4);
    expect(result.find(m => m.shortcut === 'gpt-5.4-pro')).toEqual({
      shortcut: 'gpt-5.4-pro',
      model: 'Mify-OpenAI/azure_openai/gpt-5.4-pro',
      group: 'Mify-OpenAI',
      desc: 'azure_openai/gpt-5.4-pro',
    });
    expect(result.find(m => m.shortcut === 'claude-opus-4-7')).toMatchObject({
      model: 'Mify-Anthropic/ppio/pa/claude-opus-4-7',
      group: 'Mify-Anthropic',
    });
  });

  test('skips providers with disabled: true', () => {
    writeOpencodeConfig(JSON.stringify({
      provider: {
        'EnabledProv': { models: { 'a/b': {} } },
        'DisabledProv': { disabled: true, models: { 'c/d': {} } },
      },
    }));

    const result = discoverOpencodeModels();
    expect(result).toHaveLength(1);
    expect(result[0].group).toBe('EnabledProv');
  });

  test('disambiguates shortcut collisions with @providerSuffix', () => {
    writeOpencodeConfig(JSON.stringify({
      provider: {
        'Mify-Kimi': {
          models: {
            'volcengine_maas/kimi-k2': {},
            'tongyi/kimi-k2': {},
          },
        },
      },
    }));

    const result = discoverOpencodeModels();
    expect(result).toHaveLength(2);
    const shortcuts = result.map(m => m.shortcut).sort();
    expect(shortcuts).toEqual(['kimi-k2@tongyi', 'kimi-k2@volcengine_maas']);
  });

  test('returns [] on malformed JSON without throwing', () => {
    writeOpencodeConfig('{ this is not: valid json');
    const result = discoverOpencodeModels();
    expect(result).toEqual([]);
  });

  test('returns [] when config file is missing', () => {
    // No config written — fresh tmp HOME has no .config/opencode/opencode.json
    const result = discoverOpencodeModels();
    expect(result).toEqual([]);
  });
});

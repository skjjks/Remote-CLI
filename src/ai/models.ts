/**
 * Unified model shortcuts for all AI backends.
 * Single source of truth — handlers and drivers import from here.
 */

const CLAUDE_SHORTCUTS: Record<string, string> = {
  opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-opus-4-6',
  sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6',
  haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
};

const OPENCODE_SHORTCUTS: Record<string, string> = {
  opus: 'Mify-Anthropic/ppio/pa/claude-opus-4-6',
  sonnet: 'google/antigravity-claude-sonnet-4-6',
  'opus-think': 'google/antigravity-claude-opus-4-6-thinking',
  gpt5: 'Mify-OpenAI/azure_openai/gpt-5.1-codex',
  kimi: 'Mify-Kimi/volcengine_maas/kimi-k2-250711',
  gemini: 'google/gemini-3-pro-preview',
  'gemini-flash': 'google/gemini-3-flash-preview',
  mimo: 'Mify-Xiaomi/xiaomi/mimo-v2-flash',
};

interface PopularModel {
  shortcut: string;
  model: string;
  desc?: string;
}

const CLAUDE_POPULAR: PopularModel[] = [
  { shortcut: 'opus', model: CLAUDE_SHORTCUTS.opus, desc: 'Most capable' },
  { shortcut: 'sonnet', model: CLAUDE_SHORTCUTS.sonnet, desc: 'Balanced' },
  { shortcut: 'haiku', model: CLAUDE_SHORTCUTS.haiku, desc: 'Fast & cheap' },
];

const OPENCODE_POPULAR: PopularModel[] = Object.entries(OPENCODE_SHORTCUTS).map(
  ([shortcut, model]) => ({ shortcut, model }),
);

export function getModelShortcuts(backend: 'claude' | 'opencode'): Record<string, string> {
  return backend === 'opencode' ? OPENCODE_SHORTCUTS : CLAUDE_SHORTCUTS;
}

export function resolveModel(backend: 'claude' | 'opencode', input: string): string {
  const shortcuts = getModelShortcuts(backend);
  return shortcuts[input.toLowerCase()] || input;
}

export function getPopularModels(backend: 'claude' | 'opencode'): PopularModel[] {
  return backend === 'opencode' ? OPENCODE_POPULAR : CLAUDE_POPULAR;
}

/**
 * Thin façade over src/ai/model-discovery.ts.
 *
 * The real model lists come from the user's CLI configs:
 * - Claude:   process.env.ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL
 *             (patched early from ~/.claude/settings.json by ensureClaudeEnv)
 * - Opencode: ~/.config/opencode/opencode.json provider[*].models
 *
 * If discovery returns empty (missing/broken configs), a tiny static fallback
 * keeps the bot usable.
 */

import { discoverClaudeModels, discoverOpencodeModels, type DiscoveredModel } from './model-discovery';

// Static fallback — intentionally tiny; not intended to stay in sync with
// upstream reality. Reached only when the user has zero configured models.
const CLAUDE_FALLBACK: DiscoveredModel[] = [
  { shortcut: 'opus', model: 'claude-opus-4-6' },
  { shortcut: 'sonnet', model: 'claude-sonnet-4-6' },
  { shortcut: 'haiku', model: 'claude-haiku-4-5-20251001' },
];

const OPENCODE_FALLBACK: DiscoveredModel[] = [
  { shortcut: 'opus', model: 'Mify-Anthropic/ppio/pa/claude-opus-4-6', group: 'Mify-Anthropic' },
];

export type PopularModel = DiscoveredModel;

export function getPopularModels(backend: 'claude' | 'opencode'): PopularModel[] {
  const discovered = backend === 'claude' ? discoverClaudeModels() : discoverOpencodeModels();
  if (discovered.length > 0) return discovered;
  return backend === 'claude' ? CLAUDE_FALLBACK : OPENCODE_FALLBACK;
}

export function getModelShortcuts(backend: 'claude' | 'opencode'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of getPopularModels(backend)) {
    out[m.shortcut.toLowerCase()] = m.model;
  }
  return out;
}

export function resolveModel(backend: 'claude' | 'opencode', input: string): string {
  const shortcuts = getModelShortcuts(backend);
  return shortcuts[input.toLowerCase()] || input;
}

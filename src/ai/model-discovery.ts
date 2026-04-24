/**
 * Read the user's curated model lists from their CLI configs
 * (~/.claude/settings.json env block and ~/.config/opencode/opencode.json)
 * so the !model menu card shows exactly what the user has already configured
 * for their terminal CLIs. Failed-open: on any error return [] and let the
 * caller apply a static fallback.
 */

export interface DiscoveredModel {
  shortcut: string;
  model: string;
  group?: string;
  desc?: string;
}

let _claudeCache: DiscoveredModel[] | undefined;
let _opencodeCache: DiscoveredModel[] | undefined;

/** Test-only: clear the memoization caches between test cases. */
export function __resetModelDiscoveryCache__(): void {
  _claudeCache = undefined;
  _opencodeCache = undefined;
}

export function discoverClaudeModels(): DiscoveredModel[] {
  if (_claudeCache !== undefined) return _claudeCache;

  const slots: Array<{ envKey: string; shortcut: string }> = [
    { envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL', shortcut: 'opus' },
    { envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL', shortcut: 'sonnet' },
    { envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', shortcut: 'haiku' },
  ];

  const out: DiscoveredModel[] = [];
  for (const slot of slots) {
    const model = process.env[slot.envKey];
    if (model) {
      out.push({ shortcut: slot.shortcut, model });
    }
  }

  _claudeCache = out;
  if (out.length > 0) {
    console.log(`[MODEL-DISCOVERY] Claude: ${out.length} model(s) from env`);
  }
  return out;
}

export function discoverOpencodeModels(): DiscoveredModel[] {
  // Implemented in Task 2.
  return [];
}

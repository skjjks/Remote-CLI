/**
 * Read the user's curated model lists from their CLI configs
 * (~/.claude/settings.json env block and ~/.config/opencode/opencode.json)
 * so the !model menu card shows exactly what the user has already configured
 * for their terminal CLIs. Failed-open: on any error return [] and let the
 * caller apply a static fallback.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
  if (_opencodeCache !== undefined) return _opencodeCache;

  const home = process.env.HOME || os.homedir();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    _opencodeCache = [];
    return _opencodeCache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[MODEL-DISCOVERY] Malformed opencode.json: ${err instanceof Error ? err.message : String(err)}`);
    _opencodeCache = [];
    return _opencodeCache;
  }

  const providers = (parsed as { provider?: Record<string, unknown> } | null)?.provider ?? {};
  const initial: DiscoveredModel[] = [];

  for (const [providerID, confUnknown] of Object.entries(providers)) {
    const conf = confUnknown as { disabled?: boolean; models?: Record<string, unknown> } | null;
    if (!conf || conf.disabled === true) continue;

    const models = conf.models;
    if (!models || typeof models !== 'object') continue;

    for (const [modelID, metaUnknown] of Object.entries(models)) {
      const meta = metaUnknown as { name?: string } | null;
      const leaf = modelID.slice(modelID.lastIndexOf('/') + 1);
      initial.push({
        shortcut: leaf,
        model: `${providerID}/${modelID}`,
        group: providerID,
        desc: meta?.name,
      });
    }
  }

  // Collision disambiguation: if two models share a shortcut, append @<suffix>
  // where suffix is the segment before the leaf (or providerID if modelID has no /).
  const counts = new Map<string, number>();
  for (const m of initial) counts.set(m.shortcut, (counts.get(m.shortcut) ?? 0) + 1);

  const out: DiscoveredModel[] = initial.map(m => {
    if ((counts.get(m.shortcut) ?? 0) <= 1) return m;
    const modelIdPortion = m.model.slice((m.group ?? '').length + 1);
    const segments = modelIdPortion.split('/');
    const suffix = segments.length >= 2 ? segments[segments.length - 2] : (m.group ?? '');
    return { ...m, shortcut: `${m.shortcut}@${suffix}` };
  });

  _opencodeCache = out;
  if (out.length > 0) {
    const providerCount = new Set(out.map(m => m.group)).size;
    console.log(`[MODEL-DISCOVERY] Opencode: ${out.length} model(s) from ${providerCount} provider(s)`);
  }
  return out;
}

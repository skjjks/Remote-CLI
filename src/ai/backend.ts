/**
 * Configuration for an AI backend (Claude, opencode, etc.)
 */
export interface AIBackendConfig {
  name: string;
  startCommand: string;
  startCommandAuto: string;
  logPrefix: string;
}

export const CLAUDE_BACKEND: AIBackendConfig = {
  name: 'claude',
  startCommand: 'claude',
  startCommandAuto: 'claude --dangerously-skip-permissions',
  logPrefix: '[CLAUDE]',
};

export const OPENCODE_BACKEND: AIBackendConfig = {
  name: 'opencode',
  startCommand: 'opencode',
  startCommandAuto: 'opencode --pure',
  logPrefix: '[OPENCODE]',
};

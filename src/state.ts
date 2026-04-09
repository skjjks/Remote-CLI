import { SmartCardBuilder } from './bot/card';

/**
 * Active session per conversation (session ID).
 * Bounded by active Feishu conversations — entries are removed in handleKillSession.
 * No TTL needed; the Map stays small in practice.
 */
export const activeSessions: Map<string, number> = new Map();

/**
 * A pending interactive prompt shown to the user in Terminal mode.
 */
export interface PendingPrompt {
  options: Array<{ label: string; value?: string }>;
}

/**
 * Pending prompts for terminal mode interactive responses.
 * Bounded by active conversations — each conversation has at most one pending prompt.
 * Entries are consumed on response or removed when the session is killed.
 */
export const pendingPrompts: Map<string, PendingPrompt> = new Map();

export const COMMAND_PREFIX = '!';

export const smartCard = new SmartCardBuilder();

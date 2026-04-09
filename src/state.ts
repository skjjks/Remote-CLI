import { SmartCardBuilder } from './bot/card';

/** Active session per conversation (session ID) */
export const activeSessions: Map<string, number> = new Map();

/** Pending prompts for terminal mode interactive responses */
export const pendingPrompts: Map<string, any> = new Map();

export const COMMAND_PREFIX = '!';

export const smartCard = new SmartCardBuilder();

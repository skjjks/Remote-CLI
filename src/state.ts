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

/**
 * A pending permission or elicitation request waiting for user response.
 * Stored here so both the SDK driver and the message handler
 * can access the same promise resolver.
 */
export interface PendingRequest {
  type: 'permission' | 'question';
  resolve: (value: any) => void;
  conversationId: string;
  /** Auto-deny timer handle so we can clear it on resolution. */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pending permission/question requests waiting for user response.
 * Keyed by toolUseID (permissions) or a generated elicitation ID (questions).
 * Bounded by active conversations — entries auto-expire after 5 minutes.
 */
export const pendingRequests: Map<string, PendingRequest> = new Map();

/**
 * A pending file upload overwrite confirmation request waiting for user response.
 */
export interface PendingFileUpload {
  messageId: string;
  fileKey: string;
  fileName: string;
  resourceType: 'file' | 'image';
}

/**
 * Pending file upload overwrite confirmations.
 * Keyed by conversationId. Bounded by active conversations — entries are removed after confirmation or session kill.
 */
export const pendingFileUploads: Map<string, PendingFileUpload> = new Map();

/** Command history per conversation (most recent last) */
export const commandHistory: Map<string, string[]> = new Map();

const MAX_HISTORY_SIZE = 50;

export function addToHistory(conversationId: string, command: string): void {
  let history = commandHistory.get(conversationId);
  if (!history) {
    history = [];
    commandHistory.set(conversationId, history);
  }
  history.push(command);
  if (history.length > MAX_HISTORY_SIZE) {
    history.shift();
  }
}

/** Per-conversation model override. Key: conversationId, Value: model string */
export const modelOverrides: Map<string, string> = new Map();

export const COMMAND_PREFIX = '!';

export const smartCard = new SmartCardBuilder();

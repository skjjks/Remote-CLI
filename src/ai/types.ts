/**
 * Shared types for AI session management.
 */

// Re-export types that handlers need
export type { AIMetadata, AIManagerCallbacks, MenuOption, DetectedMenu } from './manager';

/**
 * Interface for AI backend drivers.
 * Each driver (Claude SDK, opencode SDK) implements this to provide
 * structured streaming from their respective SDKs.
 */
export interface AISessionDriver {
  /** Start a new session. Resolves when the AI backend is ready. */
  start(conversationId: string, options: { cwd?: string }): Promise<void>;

  /** Send a user message. Driver invokes callbacks as events arrive. */
  sendMessage(conversationId: string, message: string): Promise<void>;

  /** Send a menu selection (numbered option). */
  selectMenuOption(conversationId: string, index: number): Promise<void>;

  /** Interrupt the active query (Ctrl-C equivalent). */
  interrupt(conversationId: string): Promise<void>;

  /** Check if the session is still alive/resumable. */
  isAlive(conversationId: string): Promise<boolean>;

  /** Resume a session after bot restart. Returns false if unresumable. */
  reconnect(conversationId: string, sessionId: string): Promise<boolean>;

  /** Tear down a session. */
  kill(conversationId: string): Promise<void>;

  /** Tear down all sessions managed by this driver. */
  killAll(): Promise<void>;

  /** Check if a session exists in memory. */
  hasSession(conversationId: string): boolean;

  /** Get the SDK session ID for persistence. */
  getSessionId(conversationId: string): string | undefined;
}

/**
 * Pending permission request for async resolution via Feishu card.
 */
export interface PendingPermission {
  toolUseID: string;
  toolName: string;
  title: string;
  description: string;
  resolve: (result: { behavior: 'allow' } | { behavior: 'deny'; message: string }) => void;
}

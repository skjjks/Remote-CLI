import type { AIMetadata, AIManagerCallbacks } from './manager';
import { pendingRequests } from '../state';

/**
 * Input for building AI metadata — shared across all drivers.
 */
export interface MetadataInput {
  backend: 'claude' | 'opencode';
  sessionId?: string;
  model?: string;
  cwd?: string;
  status: 'working' | 'thinking' | 'done';
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Build a consistent AIMetadata object from driver session state.
 */
export function buildMetadata(input: MetadataInput): AIMetadata {
  return {
    backend: input.backend,
    sessionId: input.sessionId,
    model: input.model,
    cwd: input.cwd,
    status: input.status,
    costUsd: input.costUsd,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  };
}

/**
 * Create a throttled card updater that limits onStreamUpdate calls
 * to at most once per `intervalMs` milliseconds.
 *
 * Each driver creates one per stream/message cycle and calls reset()
 * when a new message begins.
 */
export function createThrottledUpdater(
  callbacks: AIManagerCallbacks,
  intervalMs: number,
) {
  let lastUpdateTime = 0;
  let pendingUpdate = false;

  return {
    update(conversationId: string, messageId: string, content: string, metadata: AIMetadata): void {
      const now = Date.now();
      if (now - lastUpdateTime >= intervalMs) {
        callbacks.onStreamUpdate(conversationId, messageId, content, metadata);
        lastUpdateTime = now;
        pendingUpdate = false;
      } else {
        pendingUpdate = true;
      }
    },
    flush(conversationId: string, messageId: string, content: string, metadata: AIMetadata): void {
      if (pendingUpdate) {
        callbacks.onStreamUpdate(conversationId, messageId, content, metadata);
        pendingUpdate = false;
      }
    },
    hasPending(): boolean {
      return pendingUpdate;
    },
    reset(): void {
      lastUpdateTime = 0;
      pendingUpdate = false;
    },
  };
}

/**
 * Create a pending permission/question request with automatic timeout.
 *
 * On timeout: calls `onTimeout` if provided, otherwise auto-denies (permission)
 * or auto-declines (question).
 *
 * Returns a unique request ID (the key in `pendingRequests`).
 */
export function createPendingRequest(
  type: 'permission' | 'question',
  conversationId: string,
  resolve: (value: any) => void,
  timeoutMs: number,
  onTimeout?: () => void,
): string {
  const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const timer = setTimeout(() => {
    pendingRequests.delete(requestId);
    if (onTimeout) {
      onTimeout();
    } else if (type === 'permission') {
      resolve({ behavior: 'deny', message: 'Permission request timed out' });
    } else {
      resolve({ action: 'decline' });
    }
  }, timeoutMs);

  pendingRequests.set(requestId, {
    type,
    resolve: (value: any) => {
      clearTimeout(timer);
      resolve(value);
    },
    conversationId,
    timer,
  });

  return requestId;
}

/**
 * Try to resolve a pending request for the given conversation.
 *
 * If the input is a single number and there's a pending request for this
 * conversation, resolve it and return true. Otherwise return false.
 *
 * Permission resolution: 0 = allow, 1 = deny, 2 = allow always.
 * Question resolution: the numeric choice index.
 */
export function resolvePendingInput(conversationId: string, input: string): boolean {
  if (!/^\d+$/.test(input.trim())) return false;

  const pendingKey = [...pendingRequests.keys()].find(
    k => pendingRequests.get(k)?.conversationId === conversationId,
  );
  if (!pendingKey) return false;

  const pending = pendingRequests.get(pendingKey)!;
  pendingRequests.delete(pendingKey);
  const choice = parseInt(input.trim(), 10);

  if (pending.type === 'permission') {
    if (choice === 0) {
      pending.resolve({ behavior: 'allow' });
    } else if (choice === 2) {
      pending.resolve({ behavior: 'allow', updatedPermissions: [] });
    } else {
      pending.resolve({ behavior: 'deny', message: 'User denied permission' });
    }
  } else if (pending.type === 'question') {
    pending.resolve(choice);
  }

  return true;
}

/**
 * Resolve a pending request by its ID (the key in `pendingRequests`).
 * Used by card action callbacks — text-digit input continues to flow through
 * `resolvePendingInput`.
 *
 * Returns true if the id was found and resolved, false otherwise.
 */
export function resolvePendingRequestById(requestId: string, resolvedValue: unknown): boolean {
  const entry = pendingRequests.get(requestId);
  if (!entry) return false;
  pendingRequests.delete(requestId);
  entry.resolve(resolvedValue);
  return true;
}

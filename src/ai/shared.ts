import type { AIMetadata, AIManagerCallbacks } from './manager';

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

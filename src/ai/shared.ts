import type { AIMetadata } from './manager';

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

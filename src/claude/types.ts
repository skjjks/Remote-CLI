/**
 * Claude Code stream-json event types.
 * These represent the newline-delimited JSON events emitted by:
 *   claude -p --output-format stream-json --verbose
 */

/** Base event - all events have a type field */
export interface ClaudeBaseEvent {
  type: string;
  uuid?: string;
  session_id?: string;
}

/** system/init event - emitted once at session start */
export interface ClaudeInitEvent extends ClaudeBaseEvent {
  type: 'system';
  subtype: 'init';
  cwd: string;
  session_id: string;
  tools: string[];
  model: string;
  permissionMode: string;
}

/** system/hook events - internal lifecycle, ignored */
export interface ClaudeHookEvent extends ClaudeBaseEvent {
  type: 'system';
  subtype: 'hook_started' | 'hook_response';
  hook_id: string;
  hook_name: string;
}

/** Content block inside an assistant message */
export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock;

/** assistant event - contains the model's response */
export interface ClaudeAssistantEvent extends ClaudeBaseEvent {
  type: 'assistant';
  message: {
    id: string;
    model: string;
    role: 'assistant';
    content: ClaudeContentBlock[];
    stop_reason: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  session_id: string;
}

/** result event - emitted once when the session completes */
export interface ClaudeResultEvent extends ClaudeBaseEvent {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  permission_denials: Array<{
    tool: string;
    reason: string;
  }>;
}

/** Union of all event types we process */
export type ClaudeEvent = ClaudeInitEvent | ClaudeHookEvent | ClaudeAssistantEvent | ClaudeResultEvent;

/** Narrowing helpers */
export function isInitEvent(event: ClaudeBaseEvent): event is ClaudeInitEvent {
  return event.type === 'system' && 'subtype' in event && event.subtype === 'init';
}

export function isHookEvent(event: ClaudeBaseEvent): event is ClaudeHookEvent {
  return event.type === 'system' && 'subtype' in event && ['hook_started', 'hook_response'].includes(event.subtype as string);
}

export function isAssistantEvent(event: ClaudeBaseEvent): event is ClaudeAssistantEvent {
  return event.type === 'assistant';
}

export function isResultEvent(event: ClaudeBaseEvent): event is ClaudeResultEvent {
  return event.type === 'result';
}

import { describe, it, expect } from 'vitest';
import {
  isInitEvent,
  isHookEvent,
  isAssistantEvent,
  isResultEvent,
} from '../src/claude/types';

describe('Claude event type guards', () => {
  it('isInitEvent identifies system/init', () => {
    const event = { type: 'system', subtype: 'init', cwd: '/tmp', session_id: 'abc', tools: [], model: 'opus', permissionMode: 'default' };
    expect(isInitEvent(event)).toBe(true);
  });

  it('isInitEvent rejects hook events', () => {
    const event = { type: 'system', subtype: 'hook_started', hook_id: '1', hook_name: 'test' };
    expect(isInitEvent(event)).toBe(false);
  });

  it('isHookEvent identifies hook_started', () => {
    const event = { type: 'system', subtype: 'hook_started', hook_id: '1', hook_name: 'test' };
    expect(isHookEvent(event)).toBe(true);
  });

  it('isHookEvent identifies hook_response', () => {
    const event = { type: 'system', subtype: 'hook_response', hook_id: '1', hook_name: 'test' };
    expect(isHookEvent(event)).toBe(true);
  });

  it('isAssistantEvent identifies assistant', () => {
    const event = {
      type: 'assistant',
      message: { id: 'msg1', model: 'opus', role: 'assistant', content: [{ type: 'text', text: 'hi' }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
      session_id: 'abc',
    };
    expect(isAssistantEvent(event)).toBe(true);
  });

  it('isAssistantEvent rejects system events', () => {
    const event = { type: 'system', subtype: 'init' };
    expect(isAssistantEvent(event)).toBe(false);
  });

  it('isResultEvent identifies result', () => {
    const event = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 800,
      num_turns: 1,
      result: 'done',
      session_id: 'abc',
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
      permission_denials: [],
    };
    expect(isResultEvent(event)).toBe(true);
  });

  it('isResultEvent rejects assistant events', () => {
    const event = { type: 'assistant' };
    expect(isResultEvent(event)).toBe(false);
  });
});

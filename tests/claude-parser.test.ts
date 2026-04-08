import { describe, it, expect } from 'vitest';
import { ClaudeStreamParser } from '../src/claude/parser';

describe('ClaudeStreamParser', () => {
  it('parses a single complete JSON line', () => {
    const parser = new ClaudeStreamParser();
    const events = parser.feed('{"type":"system","subtype":"init","cwd":"/tmp","session_id":"abc","tools":[],"model":"opus","permissionMode":"default"}\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
  });

  it('parses multiple JSON lines in one chunk', () => {
    const parser = new ClaudeStreamParser();
    const chunk = '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"abc","tools":[],"model":"opus","permissionMode":"default"}\n{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"duration_api_ms":80,"num_turns":1,"result":"hi","session_id":"abc","total_cost_usd":0.01,"usage":{"input_tokens":1,"output_tokens":1},"permission_denials":[]}\n';
    const events = parser.feed(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('system');
    expect(events[1].type).toBe('result');
  });

  it('buffers incomplete JSON across chunks', () => {
    const parser = new ClaudeStreamParser();
    const events1 = parser.feed('{"type":"sys');
    expect(events1).toHaveLength(0);

    const events2 = parser.feed('tem","subtype":"init","cwd":"/tmp","session_id":"abc","tools":[],"model":"opus","permissionMode":"default"}\n');
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe('system');
  });

  it('skips empty lines', () => {
    const parser = new ClaudeStreamParser();
    const events = parser.feed('\n\n{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"duration_api_ms":80,"num_turns":1,"result":"ok","session_id":"x","total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1},"permission_denials":[]}\n\n');
    expect(events).toHaveLength(1);
  });

  it('skips malformed JSON lines and continues', () => {
    const parser = new ClaudeStreamParser();
    const events = parser.feed('not valid json\n{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"duration_api_ms":80,"num_turns":1,"result":"ok","session_id":"x","total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1},"permission_denials":[]}\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('result');
  });

  it('reset clears internal buffer', () => {
    const parser = new ClaudeStreamParser();
    parser.feed('{"type":"partial');
    parser.reset();
    const events = parser.feed('{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"duration_api_ms":80,"num_turns":1,"result":"ok","session_id":"x","total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1},"permission_denials":[]}\n');
    expect(events).toHaveLength(1);
  });
});

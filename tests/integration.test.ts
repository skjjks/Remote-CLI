import { describe, it, expect } from 'vitest';
import { ClaudeStreamParser } from '../src/claude/parser';
import { SmartCardBuilder } from '../src/bot/card';
import { isInitEvent, isAssistantEvent, isResultEvent } from '../src/claude/types';

describe('Integration: Parser -> Types -> Cards', () => {
  it('parses a full Claude session stream and builds correct cards', () => {
    const parser = new ClaudeStreamParser();
    const cardBuilder = new SmartCardBuilder();

    // Simulate a real Claude session stream
    const stream = [
      '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-1","tools":["Bash","Read"],"model":"claude-opus-4-6","permissionMode":"default"}\n',
      '{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"test"}\n',
      '{"type":"system","subtype":"hook_response","hook_id":"h1","hook_name":"test"}\n',
      `{"type":"assistant","message":{"id":"msg1","model":"opus","role":"assistant","content":[{"type":"text","text":"I'll list the files for you."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls -la"}}],"stop_reason":null,"usage":{"input_tokens":100,"output_tokens":50}},"session_id":"sess-1"}\n`,
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":3000,"duration_api_ms":2500,"num_turns":1,"result":"Done","session_id":"sess-1","total_cost_usd":0.05,"usage":{"input_tokens":100,"output_tokens":50},"permission_denials":[]}\n',
    ];

    const events = stream.flatMap(chunk => parser.feed(chunk));

    // Should have 5 events total (init, 2 hooks, assistant, result)
    expect(events).toHaveLength(5);

    // Filter to meaningful events
    const initEvent = events.find(e => isInitEvent(e));
    expect(initEvent).toBeDefined();

    const assistantEvent = events.find(e => isAssistantEvent(e));
    expect(assistantEvent).toBeDefined();

    const resultEvent = events.find(e => isResultEvent(e));
    expect(resultEvent).toBeDefined();

    // Build cards from events
    if (isInitEvent(initEvent!)) {
      const card = cardBuilder.buildInitCard(initEvent.session_id, initEvent.model);
      expect(JSON.stringify(card)).toContain('sess-1');
    }

    if (isAssistantEvent(assistantEvent!)) {
      const textBlocks = assistantEvent.message.content.filter(b => b.type === 'text');
      const toolBlocks = assistantEvent.message.content.filter(b => b.type === 'tool_use');

      expect(textBlocks).toHaveLength(1);
      expect(toolBlocks).toHaveLength(1);

      if (textBlocks[0].type === 'text') {
        const textCard = cardBuilder.buildTextCard(textBlocks[0].text);
        expect(JSON.stringify(textCard)).toContain('list the files');
      }

      if (toolBlocks[0].type === 'tool_use') {
        const toolCard = cardBuilder.buildToolCallCard(toolBlocks[0].name, toolBlocks[0].input);
        expect(JSON.stringify(toolCard)).toContain('Bash');
        expect(JSON.stringify(toolCard)).toContain('ls -la');
      }
    }

    if (isResultEvent(resultEvent!)) {
      const completionCard = cardBuilder.buildCompletionCard({
        durationMs: resultEvent.duration_ms,
        costUsd: resultEvent.total_cost_usd,
        inputTokens: resultEvent.usage.input_tokens,
        outputTokens: resultEvent.usage.output_tokens,
        numTurns: resultEvent.num_turns,
      });
      expect(JSON.stringify(completionCard)).toContain('3');
      expect(JSON.stringify(completionCard)).toContain('0.05');
    }
  });
});

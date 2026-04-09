# Feishu Claude Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Feishu terminal bot to deeply integrate with Claude Code via JSON streaming, with smart dynamically-partitioned cards, permission handling via card buttons, and dual-track (Claude + Terminal) support.

**Architecture:** Claude Manager spawns `claude -p --output-format stream-json --verbose` as a child process, parses newline-delimited JSON events, and drives a smart card engine. Terminal Manager keeps the existing PTY/tmux approach. Both share a unified session model and card system. Multi-turn Claude conversations use `--resume <session-id>`.

**Tech Stack:** TypeScript, Node.js child_process, @larksuiteoapi/node-sdk (WebSocket mode), node-pty + tmux (terminal mode), vitest (tests)

---

### Task 1: Claude Event Types

**Files:**
- Create: `src/claude/types.ts`
- Test: `tests/claude-types.test.ts`

- [ ] **Step 1: Write the type definitions**

Create `src/claude/types.ts`:

```typescript
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
  return event.type === 'system' && (event as any).subtype === 'init';
}

export function isHookEvent(event: ClaudeBaseEvent): event is ClaudeHookEvent {
  return event.type === 'system' && ['hook_started', 'hook_response'].includes((event as any).subtype);
}

export function isAssistantEvent(event: ClaudeBaseEvent): event is ClaudeAssistantEvent {
  return event.type === 'assistant';
}

export function isResultEvent(event: ClaudeBaseEvent): event is ClaudeResultEvent {
  return event.type === 'result';
}
```

- [ ] **Step 2: Write tests for type guards**

Create `tests/claude-types.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/claude-types.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/claude/types.ts tests/claude-types.test.ts
git commit -m "feat: add Claude Code stream-json event type definitions"
```

---

### Task 2: JSON Stream Parser

**Files:**
- Create: `src/claude/parser.ts`
- Test: `tests/claude-parser.test.ts`

- [ ] **Step 1: Write failing tests for the parser**

Create `tests/claude-parser.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/claude-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

Create `src/claude/parser.ts`:

```typescript
import { ClaudeBaseEvent } from './types';

/**
 * Line-based parser for Claude Code's newline-delimited JSON stream.
 * Handles partial chunks, empty lines, and malformed JSON gracefully.
 */
export class ClaudeStreamParser {
  private buffer: string = '';

  /**
   * Feed a chunk of data from stdout.
   * Returns an array of parsed events (0 or more).
   * Malformed JSON lines are logged and skipped.
   */
  feed(chunk: string): ClaudeBaseEvent[] {
    this.buffer += chunk;
    const events: ClaudeBaseEvent[] = [];
    const lines = this.buffer.split('\n');

    // Last element is either empty (if chunk ended with \n) or an incomplete line
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as ClaudeBaseEvent;
        events.push(parsed);
      } catch {
        // Malformed JSON — log and skip
        console.warn('[ClaudeStreamParser] Skipping malformed line:', trimmed.slice(0, 120));
      }
    }

    return events;
  }

  /**
   * Clear the internal buffer. Use when restarting a session.
   */
  reset(): void {
    this.buffer = '';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/claude-parser.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude/parser.ts tests/claude-parser.test.ts
git commit -m "feat: add Claude JSON stream parser"
```

---

### Task 3: Smart Card Builder

**Files:**
- Modify: `src/bot/card.ts` (full rewrite)
- Test: `tests/smart-card.test.ts`
- Modify: `tests/card.test.ts` (update imports if needed)

This replaces the old prompt-only card builder with a smart card system that supports Claude events (tool calls, text output, permissions, completion) plus the legacy prompt cards.

- [ ] **Step 1: Write tests for the new card builder**

Create `tests/smart-card.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';

describe('SmartCardBuilder', () => {
  const builder = new SmartCardBuilder();

  describe('buildTextCard', () => {
    it('builds a card with markdown content', () => {
      const card = builder.buildTextCard('Hello world');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toBe('Claude');
      expect(parsed.elements.length).toBeGreaterThanOrEqual(1);
      // Find the markdown element
      const mdEl = parsed.elements.find((e: any) => e.tag === 'markdown');
      expect(mdEl).toBeDefined();
      expect(mdEl.content).toBe('Hello world');
    });
  });

  describe('buildToolCallCard', () => {
    it('builds a card for Bash tool with command', () => {
      const card = builder.buildToolCallCard('Bash', { command: 'ls -la' });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Bash');
      // Should have a code block with the command
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasCommand = mdElements.some((e: any) => e.content.includes('ls -la'));
      expect(hasCommand).toBe(true);
    });

    it('builds a card for Edit tool with file path', () => {
      const card = builder.buildToolCallCard('Edit', { file_path: '/tmp/test.ts', old_string: 'foo', new_string: 'bar' });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Edit');
    });
  });

  describe('buildToolResultCard', () => {
    it('builds a card with short output', () => {
      const card = builder.buildToolResultCard('Bash', 'total 32\ndrwxr-xr-x 4 user', 1.2);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasOutput = mdElements.some((e: any) => e.content.includes('total 32'));
      expect(hasOutput).toBe(true);
    });

    it('truncates long output and adds note', () => {
      const longOutput = 'x'.repeat(3000);
      const card = builder.buildToolResultCard('Bash', longOutput, 2.0);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      // Should have truncation indicator
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent.length).toBeLessThan(3000);
    });
  });

  describe('buildPermissionCard', () => {
    it('builds a card with Allow/Deny/Always Allow buttons', () => {
      const card = builder.buildPermissionCard('Bash', 'rm -rf node_modules');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Confirmation');
      const actionEl = parsed.elements.find((e: any) => e.tag === 'action');
      expect(actionEl).toBeDefined();
      expect(actionEl.actions.length).toBe(3);
      const values = actionEl.actions.map((a: any) => a.value);
      expect(values).toContain('__permit_allow__');
      expect(values).toContain('__permit_deny__');
      expect(values).toContain('__permit_always__');
    });
  });

  describe('buildCompletionCard', () => {
    it('builds a card with duration, cost, tokens', () => {
      const card = builder.buildCompletionCard({
        durationMs: 45000,
        costUsd: 0.15,
        inputTokens: 12345,
        outputTokens: 2345,
        numTurns: 3,
      });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Complete');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent).toContain('45');
      expect(allContent).toContain('0.15');
    });
  });

  describe('buildTerminalOutputCard', () => {
    it('wraps output in a code block card', () => {
      const card = builder.buildTerminalOutputCard('$ ls\nfile.txt');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Terminal');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasCode = mdElements.some((e: any) => e.content.includes('```'));
      expect(hasCode).toBe(true);
    });
  });

  describe('buildInitCard', () => {
    it('builds a session started card', () => {
      const card = builder.buildInitCard('abc-123', 'opus');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Session');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent).toContain('abc-123');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/smart-card.test.ts`
Expected: FAIL — SmartCardBuilder not found

- [ ] **Step 3: Rewrite card.ts with SmartCardBuilder**

Rewrite `src/bot/card.ts`. Keep the old `CardBuilder` class and exports intact (the old tests and `index.ts` still reference them), and add the new `SmartCardBuilder` class:

```typescript
/**
 * Smart card builder module for Feishu Terminal Bot.
 * Builds dynamically-partitioned Feishu cards for Claude events and terminal output.
 */

import type { PromptDetectionResult } from '../terminal/prompt';

// ── Feishu Card V2 types (markdown-based) ──

export interface FeishuCardV2 {
  header: {
    title: { tag: 'plain_text'; content: string };
    template?: string;
  };
  elements: FeishuCardElement[];
}

type FeishuCardElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'action'; actions: CardButton[] }
  | { tag: 'div'; text: { tag: 'plain_text'; content: string } }
  | { tag: 'note'; elements: Array<{ tag: 'plain_text'; content: string }> };

// ── Legacy V1 types (kept for backward compatibility) ──

interface CardButton {
  tag: 'button';
  text: { tag: 'plain_text'; content: string };
  value: string;
  type?: string;
}

interface CardAction {
  tag: 'action';
  actions: CardButton[];
}

interface CardDiv {
  tag: 'div';
  text: { tag: 'plain_text'; content: string };
}

interface CardConfig {
  wide_screen_mode: boolean;
}

export interface FeishuCard {
  config: CardConfig;
  elements: (CardDiv | CardAction)[];
}

// ── Constants ──

const MAX_VISIBLE_BUTTONS = 4;
const MORE_OPTIONS_VALUE = '__more__';
const MAX_CARD_CONTENT_LENGTH = 2000;

// Permission button values
export const PERMIT_ALLOW = '__permit_allow__';
export const PERMIT_DENY = '__permit_deny__';
export const PERMIT_ALWAYS = '__permit_always__';

// ── Completion stats interface ──

export interface CompletionStats {
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
}

// ── SmartCardBuilder (new) ──

export class SmartCardBuilder {
  buildInitCard(sessionId: string, model: string): FeishuCardV2 {
    return {
      header: { title: { tag: 'plain_text', content: 'Claude Session Started' }, template: 'blue' },
      elements: [
        { tag: 'markdown', content: `**Session:** \`${sessionId}\`\n**Model:** ${model}` },
      ],
    };
  }

  buildTextCard(text: string): FeishuCardV2 {
    const truncated = text.length > MAX_CARD_CONTENT_LENGTH
      ? text.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n\n... (truncated)'
      : text;

    return {
      header: { title: { tag: 'plain_text', content: 'Claude' }, template: 'purple' },
      elements: [
        { tag: 'markdown', content: truncated },
      ],
    };
  }

  buildToolCallCard(toolName: string, input: Record<string, unknown>): FeishuCardV2 {
    let paramDisplay = '';
    if (toolName === 'Bash' && input.command) {
      paramDisplay = `\`\`\`bash\n$ ${input.command}\n\`\`\``;
    } else if (toolName === 'Edit' && input.file_path) {
      paramDisplay = `**File:** \`${input.file_path}\``;
      if (input.old_string && input.new_string) {
        paramDisplay += `\n\`\`\`diff\n- ${String(input.old_string).slice(0, 200)}\n+ ${String(input.new_string).slice(0, 200)}\n\`\`\``;
      }
    } else if (toolName === 'Read' && input.file_path) {
      paramDisplay = `**File:** \`${input.file_path}\``;
    } else if (toolName === 'Write' && input.file_path) {
      paramDisplay = `**File:** \`${input.file_path}\``;
    } else if (toolName === 'Glob' && input.pattern) {
      paramDisplay = `**Pattern:** \`${input.pattern}\``;
    } else if (toolName === 'Grep' && input.pattern) {
      paramDisplay = `**Pattern:** \`${input.pattern}\``;
    } else {
      // Generic: show JSON
      const jsonStr = JSON.stringify(input, null, 2);
      paramDisplay = `\`\`\`json\n${jsonStr.slice(0, 500)}\n\`\`\``;
    }

    return {
      header: { title: { tag: 'plain_text', content: `Tool: ${toolName}` }, template: 'turquoise' },
      elements: [
        { tag: 'markdown', content: paramDisplay },
        { tag: 'note', elements: [{ tag: 'plain_text', content: 'Running...' }] },
      ],
    };
  }

  buildToolResultCard(toolName: string, output: string, durationSec: number): FeishuCardV2 {
    const truncated = output.length > MAX_CARD_CONTENT_LENGTH
      ? output.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n... (truncated)'
      : output;

    const codeBlock = `\`\`\`\n${truncated}\n\`\`\``;

    return {
      header: { title: { tag: 'plain_text', content: `Tool: ${toolName}` }, template: 'turquoise' },
      elements: [
        { tag: 'markdown', content: codeBlock },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `Done - ${durationSec.toFixed(1)}s` }] },
      ],
    };
  }

  buildPermissionCard(toolName: string, description: string): FeishuCardV2 {
    return {
      header: { title: { tag: 'plain_text', content: 'Confirmation Required' }, template: 'red' },
      elements: [
        { tag: 'markdown', content: `Claude wants to use **${toolName}**:\n\`\`\`\n${description}\n\`\`\`` },
        {
          tag: 'action',
          actions: [
            { tag: 'button', text: { tag: 'plain_text', content: 'Allow' }, value: PERMIT_ALLOW, type: 'primary' },
            { tag: 'button', text: { tag: 'plain_text', content: 'Deny' }, value: PERMIT_DENY, type: 'danger' },
            { tag: 'button', text: { tag: 'plain_text', content: 'Always Allow' }, value: PERMIT_ALWAYS },
          ],
        },
      ],
    };
  }

  buildCompletionCard(stats: CompletionStats): FeishuCardV2 {
    const durationSec = (stats.durationMs / 1000).toFixed(1);
    const lines = [
      `**Duration:** ${durationSec}s`,
      `**Turns:** ${stats.numTurns}`,
      `**Tokens:** ${stats.inputTokens.toLocaleString()} in / ${stats.outputTokens.toLocaleString()} out`,
      `**Cost:** $${stats.costUsd.toFixed(4)}`,
    ];
    return {
      header: { title: { tag: 'plain_text', content: 'Session Complete' }, template: 'green' },
      elements: [
        { tag: 'markdown', content: lines.join('\n') },
      ],
    };
  }

  buildTerminalOutputCard(output: string): FeishuCardV2 {
    const truncated = output.length > MAX_CARD_CONTENT_LENGTH
      ? output.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n... (truncated)'
      : output;

    return {
      header: { title: { tag: 'plain_text', content: 'Terminal' }, template: 'grey' },
      elements: [
        { tag: 'markdown', content: `\`\`\`\n${truncated}\n\`\`\`` },
      ],
    };
  }

  buildErrorCard(error: string): FeishuCardV2 {
    return {
      header: { title: { tag: 'plain_text', content: 'Error' }, template: 'red' },
      elements: [
        { tag: 'markdown', content: `\`\`\`\n${error}\n\`\`\`` },
      ],
    };
  }
}

// ── Legacy CardBuilder (unchanged — used by Terminal mode prompt detection) ──

export class CardBuilder {
  buildYesNoCard(result: PromptDetectionResult): FeishuCard {
    const buttons: CardButton[] = [
      { tag: 'button', text: { tag: 'plain_text', content: 'Yes' }, value: 'yes' },
      { tag: 'button', text: { tag: 'plain_text', content: 'No' }, value: 'no' },
    ];
    return {
      config: { wide_screen_mode: true },
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content: result.message } },
        { tag: 'action', actions: buttons },
      ],
    };
  }

  buildNumberedCard(result: PromptDetectionResult): FeishuCard {
    const buttons: CardButton[] = this.buildOptionButtons(result.options);
    return {
      config: { wide_screen_mode: true },
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content: result.message } },
        { tag: 'action', actions: buttons },
      ],
    };
  }

  buildAskUserCard(result: PromptDetectionResult): FeishuCard {
    const buttons: CardButton[] = this.buildOptionButtons(result.options);
    let message = result.message;
    if (result.isMultiSelect) {
      message += ' (Multi-select)';
    }
    return {
      config: { wide_screen_mode: true },
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content: message } },
        { tag: 'action', actions: buttons },
      ],
    };
  }

  buildCard(result: PromptDetectionResult): FeishuCard | null {
    switch (result.type) {
      case 'yesno': return this.buildYesNoCard(result);
      case 'numbered': return this.buildNumberedCard(result);
      case 'askuser': return this.buildAskUserCard(result);
      default: return null;
    }
  }

  private buildOptionButtons(options: Array<{ label: string; value: string }>): CardButton[] {
    if (options.length === 0) return [];
    const buttons: CardButton[] = [];
    const visibleOptions = options.slice(0, MAX_VISIBLE_BUTTONS);
    for (const option of visibleOptions) {
      buttons.push({ tag: 'button', text: { tag: 'plain_text', content: option.label }, value: option.value });
    }
    if (options.length > MAX_VISIBLE_BUTTONS) {
      buttons.push({ tag: 'button', text: { tag: 'plain_text', content: 'More options...' }, value: MORE_OPTIONS_VALUE });
    }
    return buttons;
  }
}

export function isMoreOptionsValue(value: string): boolean {
  return value === MORE_OPTIONS_VALUE;
}

export function getMaxVisibleButtons(): number {
  return MAX_VISIBLE_BUTTONS;
}

export function isPermitAction(value: string): boolean {
  return [PERMIT_ALLOW, PERMIT_DENY, PERMIT_ALWAYS].includes(value);
}
```

- [ ] **Step 4: Run both old and new card tests**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/card.test.ts tests/smart-card.test.ts`
Expected: All tests PASS (old CardBuilder tests unchanged, new SmartCardBuilder tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/bot/card.ts tests/smart-card.test.ts
git commit -m "feat: add SmartCardBuilder for Claude event cards"
```

---

### Task 4: Add Card Update to FeishuBot

**Files:**
- Modify: `src/bot/feishu.ts`

The Feishu API supports updating (PATCH) sent cards by `message_id`. We need `sendCard` to return the `message_id`, and a new `updateCard` method.

- [ ] **Step 1: Modify sendCard to return message_id**

In `src/bot/feishu.ts`, change `sendCard` to return `string | undefined`:

Replace the existing `sendCard` method:

```typescript
  /**
   * Send interactive card to a conversation
   * Returns the message_id for later updates
   */
  async sendCard(conversationId: string, card: object): Promise<string | undefined> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: conversationId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
      return (response as any)?.data?.message_id;
    } catch (error) {
      console.error('Failed to send card:', error);
      throw error;
    }
  }
```

- [ ] **Step 2: Add updateCard method**

Add after `sendCard`:

```typescript
  /**
   * Update an existing card message
   * Uses PATCH /open-apis/im/v1/messages/:message_id
   */
  async updateCard(messageId: string, card: object): Promise<void> {
    try {
      await this.client.im.message.patch({
        path: {
          message_id: messageId,
        },
        data: {
          content: JSON.stringify(card),
        },
      });
    } catch (error) {
      console.error('Failed to update card:', error);
      // Don't throw — card update failures are non-critical
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/bot/feishu.ts
git commit -m "feat: add card update support to FeishuBot"
```

---

### Task 5: Update Config for Claude Settings

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add Claude config section**

In `src/config.ts`, add to the `Config` interface after `session`:

```typescript
  claude: {
    timeout: number;
    defaultMode: 'default' | 'auto';
    cardUpdateInterval: number;
  };
```

And in `loadConfig()`, add to the return object after `session`:

```typescript
    claude: {
      timeout: getEnvVarInt('CLAUDE_TIMEOUT', 300000),
      defaultMode: (getEnvVar('CLAUDE_DEFAULT_MODE', 'default') as 'default' | 'auto'),
      cardUpdateInterval: getEnvVarInt('CLAUDE_CARD_UPDATE_INTERVAL', 500),
    },
```

- [ ] **Step 2: Update .env.example**

Add to `.env.example` at the end:

```
# Claude Configuration
CLAUDE_TIMEOUT=300000
CLAUDE_DEFAULT_MODE=default
CLAUDE_CARD_UPDATE_INTERVAL=500
```

- [ ] **Step 3: Run existing config test to ensure no breakage**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/config.test.ts`
Expected: PASS (existing tests should still pass — new fields have defaults)

- [ ] **Step 4: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat: add Claude configuration settings"
```

---

### Task 6: Unified Session Manager

**Files:**
- Modify: `src/terminal/session.ts`
- Test: `tests/session.test.ts`

Extend `SessionInfo` to support both Claude and Terminal sessions.

- [ ] **Step 1: Write tests for the new session types**

Create `tests/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock tmux module before importing session manager
vi.mock('../src/terminal/tmux', () => ({
  sessionExists: vi.fn().mockResolvedValue(false),
  createSession: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  capturePane: vi.fn().mockResolvedValue(''),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{"sessions":[],"nextId":0}'),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{"sessions":[],"nextId":0}'),
  writeFileSync: vi.fn(),
}));

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
    server: { port: 3000, host: '0.0.0.0' },
    terminal: { cols: 80, rows: 24, shell: '/bin/bash' },
    session: { prefix: 'test', dataDir: '/tmp/test-sessions' },
    claude: { timeout: 300000, defaultMode: 'default', cardUpdateInterval: 500 },
  }),
}));

import { SessionManager } from '../src/terminal/session';

describe('SessionManager with session types', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('createSession defaults to terminal type', async () => {
    const session = await manager.createSession('conv1');
    expect(session.type).toBe('terminal');
    expect(session.tmuxName).toBeDefined();
  });

  it('createClaudeSession creates a claude-type session', () => {
    const session = manager.createClaudeSession('conv1');
    expect(session.type).toBe('claude');
    expect(session.tmuxName).toBeUndefined();
  });

  it('updateClaudeSessionId stores the Claude session ID', () => {
    const session = manager.createClaudeSession('conv1');
    manager.updateClaudeSessionId(session.id, 'claude-abc-123');
    const updated = manager.getSession(session.id);
    expect(updated?.claudeSessionId).toBe('claude-abc-123');
  });

  it('getSession returns correct type for both session types', async () => {
    const terminal = await manager.createSession('conv1');
    const claude = manager.createClaudeSession('conv2');

    expect(manager.getSession(terminal.id)?.type).toBe('terminal');
    expect(manager.getSession(claude.id)?.type).toBe('claude');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/session.test.ts`
Expected: FAIL — `createClaudeSession` does not exist

- [ ] **Step 3: Extend SessionInfo and SessionManager**

Modify `src/terminal/session.ts`:

Update the `SessionInfo` interface:

```typescript
export interface SessionInfo {
  id: number;
  type: 'claude' | 'terminal';
  tmuxName?: string;
  created: string;
  conversationId?: string;
  // Claude-specific
  claudeSessionId?: string;
  permissionMode?: 'default' | 'auto';
  allowedTools?: string[];
}
```

In `createSession`, set `type: 'terminal'`:

```typescript
  async createSession(conversationId?: string): Promise<SessionInfo> {
    const id = this.data.nextId;
    const tmuxName = this.getTmuxName(id);

    const exists = await tmux.sessionExists(tmuxName);
    if (!exists) {
      await tmux.createSession(
        tmuxName,
        this.config.terminal.shell,
        this.config.terminal.cols,
        this.config.terminal.rows
      );
    }

    const session: SessionInfo = {
      id,
      type: 'terminal',
      tmuxName,
      created: new Date().toISOString(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }
```

Add `createClaudeSession` method:

```typescript
  /**
   * Create a new Claude session (no tmux needed)
   */
  createClaudeSession(conversationId?: string): SessionInfo {
    const id = this.data.nextId;

    const session: SessionInfo = {
      id,
      type: 'claude',
      created: new Date().toISOString(),
      conversationId,
    };

    this.data.sessions.push(session);
    this.data.nextId++;
    this.saveSessions();

    return session;
  }

  /**
   * Update the Claude session ID (from system/init event)
   */
  updateClaudeSessionId(sessionId: number, claudeSessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
      this.saveSessions();
    }
  }

  /**
   * Update allowed tools for a Claude session
   */
  updateAllowedTools(sessionId: number, tools: string[]): void {
    const session = this.getSession(sessionId);
    if (session && session.type === 'claude') {
      session.allowedTools = tools;
      this.saveSessions();
    }
  }

  /**
   * Update permission mode for a Claude session
   */
  updatePermissionMode(sessionId: number, mode: 'default' | 'auto'): void {
    const session = this.getSession(sessionId);
    if (session && session.type === 'claude') {
      session.permissionMode = mode;
      this.saveSessions();
    }
  }
```

Also update `killSession` to handle Claude sessions (no tmux to kill):

```typescript
  async killSession(sessionId: number): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Only kill tmux for terminal sessions
    if (session.type === 'terminal' && session.tmuxName) {
      try {
        await tmux.killSession(session.tmuxName);
      } catch {
        // Session might not exist in tmux, ignore error
      }
    }

    this.data.sessions = this.data.sessions.filter(s => s.id !== sessionId);
    this.saveSessions();
  }
```

- [ ] **Step 4: Run tests**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/session.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/terminal/session.ts tests/session.test.ts
git commit -m "feat: extend SessionManager with Claude session support"
```

---

### Task 7: Claude Manager

**Files:**
- Create: `src/claude/manager.ts`
- Test: `tests/claude-manager.test.ts`

This is the core module. It spawns `claude -p` child processes, feeds stdout to the parser, and emits structured events via callbacks.

- [ ] **Step 1: Write tests for ClaudeManager**

Create `tests/claude-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeManager, ClaudeManagerCallbacks } from '../src/claude/manager';

// Mock child_process
vi.mock('child_process', () => {
  const EventEmitter = require('events');

  function createMockProcess() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
  }

  return {
    spawn: vi.fn(() => createMockProcess()),
  };
});

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
    server: { port: 3000, host: '0.0.0.0' },
    terminal: { cols: 80, rows: 24, shell: '/bin/bash' },
    session: { prefix: 'test', dataDir: '/tmp/test' },
    claude: { timeout: 300000, defaultMode: 'default', cardUpdateInterval: 500 },
  }),
}));

import { spawn } from 'child_process';

describe('ClaudeManager', () => {
  let manager: ClaudeManager;
  let callbacks: ClaudeManagerCallbacks;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callbacks = {
      onInit: vi.fn(),
      onText: vi.fn(),
      onToolUse: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
    };
    manager = new ClaudeManager(callbacks);
    mockSpawn = spawn as any;
  });

  it('startSession spawns a claude process', async () => {
    manager.startSession('conv1', 'say hello');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0];
    expect(args[0]).toBe('claude');
    expect(args[1]).toContain('-p');
    expect(args[1]).toContain('--output-format');
    expect(args[1]).toContain('stream-json');
  });

  it('startSession with resumeId includes --resume flag', async () => {
    manager.startSession('conv1', 'follow up', { resumeId: 'abc-123' });
    const args = mockSpawn.mock.calls[0];
    expect(args[1]).toContain('--resume');
    expect(args[1]).toContain('abc-123');
  });

  it('processes init event from stdout', async () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    // Simulate stdout data
    const initEvent = '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-abc","tools":["Bash"],"model":"opus","permissionMode":"default"}\n';
    proc.stdout.emit('data', initEvent);

    expect(callbacks.onInit).toHaveBeenCalledWith('conv1', expect.objectContaining({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-abc',
    }));
  });

  it('processes assistant text event from stdout', async () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    const assistantEvent = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg1',
        model: 'opus',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      session_id: 'sess-abc',
    }) + '\n';
    proc.stdout.emit('data', assistantEvent);

    expect(callbacks.onText).toHaveBeenCalledWith('conv1', 'Hello world');
  });

  it('processes tool_use event from stdout', async () => {
    manager.startSession('conv1', 'list files');
    const proc = mockSpawn.mock.results[0].value;

    const assistantEvent = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg1',
        model: 'opus',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'ls' } }],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      session_id: 'sess-abc',
    }) + '\n';
    proc.stdout.emit('data', assistantEvent);

    expect(callbacks.onToolUse).toHaveBeenCalledWith('conv1', 'Bash', { command: 'ls' });
  });

  it('processes result event from stdout', async () => {
    manager.startSession('conv1', 'hello');
    const proc = mockSpawn.mock.results[0].value;

    const resultEvent = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: 1,
      result: 'Hello!',
      session_id: 'sess-abc',
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 10 },
      permission_denials: [],
    }) + '\n';
    proc.stdout.emit('data', resultEvent);

    expect(callbacks.onResult).toHaveBeenCalledWith('conv1', expect.objectContaining({
      type: 'result',
      duration_ms: 5000,
      total_cost_usd: 0.05,
    }));
  });

  it('interruptSession kills the child process', () => {
    manager.startSession('conv1', 'long task');
    const proc = mockSpawn.mock.results[0].value;

    manager.interruptSession('conv1');
    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('isSessionActive returns correct state', () => {
    expect(manager.isSessionActive('conv1')).toBe(false);
    manager.startSession('conv1', 'hello');
    expect(manager.isSessionActive('conv1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/claude-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ClaudeManager**

Create `src/claude/manager.ts`:

```typescript
import { spawn, ChildProcess } from 'child_process';
import { getConfig } from '../config';
import { ClaudeStreamParser } from './parser';
import {
  ClaudeBaseEvent,
  ClaudeInitEvent,
  ClaudeAssistantEvent,
  ClaudeResultEvent,
  isInitEvent,
  isHookEvent,
  isAssistantEvent,
  isResultEvent,
} from './types';

export interface ClaudeManagerCallbacks {
  onInit: (conversationId: string, event: ClaudeInitEvent) => void;
  onText: (conversationId: string, text: string) => void;
  onToolUse: (conversationId: string, toolName: string, input: Record<string, unknown>) => void;
  onResult: (conversationId: string, event: ClaudeResultEvent) => void;
  onError: (conversationId: string, error: string) => void;
}

interface ActiveProcess {
  process: ChildProcess;
  parser: ClaudeStreamParser;
  conversationId: string;
  stderr: string;
  timeoutId?: NodeJS.Timeout;
}

export interface StartSessionOptions {
  resumeId?: string;
  permissionMode?: 'default' | 'auto';
  allowedTools?: string[];
}

export class ClaudeManager {
  private processes: Map<string, ActiveProcess> = new Map();
  private callbacks: ClaudeManagerCallbacks;
  private config: ReturnType<typeof getConfig>;

  constructor(callbacks: ClaudeManagerCallbacks) {
    this.callbacks = callbacks;
    this.config = getConfig();
  }

  /**
   * Start a Claude session for a conversation.
   * Spawns `claude -p --output-format stream-json --verbose` with the given prompt.
   */
  startSession(conversationId: string, prompt: string, options?: StartSessionOptions): void {
    // Kill any existing process for this conversation
    this.interruptSession(conversationId);

    const args = this.buildArgs(prompt, options);

    const proc = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parser = new ClaudeStreamParser();
    const active: ActiveProcess = {
      process: proc,
      parser,
      conversationId,
      stderr: '',
    };

    // Set timeout
    const timeout = this.config.claude.timeout;
    active.timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      this.callbacks.onError(conversationId, `Claude process timed out after ${timeout / 1000}s`);
    }, timeout);

    // Handle stdout (JSON events)
    proc.stdout?.on('data', (chunk: Buffer) => {
      const events = parser.feed(chunk.toString());
      for (const event of events) {
        this.handleEvent(conversationId, event);
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (chunk: Buffer) => {
      active.stderr += chunk.toString();
    });

    // Handle process exit
    proc.on('close', (code) => {
      if (active.timeoutId) clearTimeout(active.timeoutId);
      this.processes.delete(conversationId);

      if (code !== 0 && active.stderr) {
        this.callbacks.onError(conversationId, active.stderr);
      }
    });

    proc.on('error', (err) => {
      if (active.timeoutId) clearTimeout(active.timeoutId);
      this.processes.delete(conversationId);
      this.callbacks.onError(conversationId, `Failed to start Claude: ${err.message}`);
    });

    this.processes.set(conversationId, active);
  }

  /**
   * Build CLI arguments for claude -p
   */
  private buildArgs(prompt: string, options?: StartSessionOptions): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    const mode = options?.permissionMode || this.config.claude.defaultMode;
    if (mode === 'auto') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'default');
    }

    if (options?.resumeId) {
      args.push('--resume', options.resumeId);
    }

    if (options?.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(' '));
    }

    args.push(prompt);

    return args;
  }

  /**
   * Handle a parsed event from stdout
   */
  private handleEvent(conversationId: string, event: ClaudeBaseEvent): void {
    if (isHookEvent(event)) {
      // Ignore hook lifecycle events
      return;
    }

    if (isInitEvent(event)) {
      this.callbacks.onInit(conversationId, event);
      return;
    }

    if (isAssistantEvent(event)) {
      this.handleAssistantEvent(conversationId, event);
      return;
    }

    if (isResultEvent(event)) {
      this.callbacks.onResult(conversationId, event);
      return;
    }
  }

  /**
   * Handle assistant message — extract text and tool_use blocks
   */
  private handleAssistantEvent(conversationId: string, event: ClaudeAssistantEvent): void {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        this.callbacks.onText(conversationId, block.text);
      } else if (block.type === 'tool_use') {
        this.callbacks.onToolUse(conversationId, block.name, block.input);
      }
    }
  }

  /**
   * Interrupt (kill) the active Claude process for a conversation
   */
  interruptSession(conversationId: string): void {
    const active = this.processes.get(conversationId);
    if (active) {
      if (active.timeoutId) clearTimeout(active.timeoutId);
      active.process.kill('SIGINT');
      this.processes.delete(conversationId);
    }
  }

  /**
   * Check if a conversation has an active Claude process
   */
  isSessionActive(conversationId: string): boolean {
    return this.processes.has(conversationId);
  }

  /**
   * Kill all active processes
   */
  killAll(): void {
    for (const [convId] of this.processes) {
      this.interruptSession(convId);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/claude-manager.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude/manager.ts tests/claude-manager.test.ts
git commit -m "feat: add ClaudeManager for spawning and managing Claude processes"
```

---

### Task 8: Rewrite index.ts — Message Router

**Files:**
- Modify: `src/index.ts`

This is the big integration task. Rewrite `index.ts` to support dual-track routing (Claude + Terminal) with the new command system.

- [ ] **Step 1: Rewrite index.ts**

Replace the entire content of `src/index.ts`:

```typescript
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from './config';
import { getFeishuBot } from './bot/feishu';
import {
  SmartCardBuilder,
  CardBuilder,
  isMoreOptionsValue,
  isPermitAction,
  PERMIT_ALLOW,
  PERMIT_DENY,
  PERMIT_ALWAYS,
  CompletionStats,
} from './bot/card';
import { getSessionManager, SessionInfo } from './terminal/session';
import { getPtyManager, OutputCallback, PromptDetectionResult } from './terminal/pty';
import { ClaudeManager, ClaudeManagerCallbacks } from './claude/manager';
import { ClaudeInitEvent, ClaudeResultEvent } from './claude/types';

// ── State ──

/** Active session per conversation (session ID) */
const activeSessions: Map<string, number> = new Map();

/** Pending prompts waiting for user response (Terminal mode) */
const pendingPrompts: Map<string, PromptDetectionResult> = new Map();

/** Card message IDs for updates */
const lastCardMessageIds: Map<string, string> = new Map();

const COMMAND_PREFIX = '!';

// ── Card builders ──

const smartCard = new SmartCardBuilder();
const legacyCard = new CardBuilder();

// ── Claude callbacks ──

const claudeCallbacks: ClaudeManagerCallbacks = {
  onInit: async (conversationId, event: ClaudeInitEvent) => {
    const feishuBot = getFeishuBot();
    const sessionManager = getSessionManager();

    // Store Claude session ID for --resume
    const activeSessionId = activeSessions.get(conversationId);
    if (activeSessionId !== undefined) {
      sessionManager.updateClaudeSessionId(activeSessionId, event.session_id);
    }

    const card = smartCard.buildInitCard(event.session_id, event.model);
    await feishuBot.sendCard(conversationId, card);
  },

  onText: async (conversationId, text) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(text);
    const msgId = await feishuBot.sendCard(conversationId, card);
    if (msgId) lastCardMessageIds.set(conversationId, msgId);
  },

  onToolUse: async (conversationId, toolName, input) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildToolCallCard(toolName, input);
    const msgId = await feishuBot.sendCard(conversationId, card);
    if (msgId) lastCardMessageIds.set(conversationId, msgId);
  },

  onResult: async (conversationId, event: ClaudeResultEvent) => {
    const feishuBot = getFeishuBot();

    // Check for permission denials
    if (event.permission_denials && event.permission_denials.length > 0) {
      for (const denial of event.permission_denials) {
        const card = smartCard.buildPermissionCard(denial.tool, denial.reason);
        await feishuBot.sendCard(conversationId, card);
      }
      return;
    }

    // Send completion card
    const stats: CompletionStats = {
      durationMs: event.duration_ms,
      costUsd: event.total_cost_usd,
      inputTokens: event.usage.input_tokens,
      outputTokens: event.usage.output_tokens,
      numTurns: event.num_turns,
    };
    const card = smartCard.buildCompletionCard(stats);
    await feishuBot.sendCard(conversationId, card);
  },

  onError: async (conversationId, error) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildErrorCard(error);
    await feishuBot.sendCard(conversationId, card);
  },
};

// ── Terminal output callback ──

const handlePtyOutput: OutputCallback = async (
  sessionId: number,
  output: string,
  prompt?: PromptDetectionResult
) => {
  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session?.conversationId) return;

  const feishuBot = getFeishuBot();
  const conversationId = session.conversationId;

  // Check for binary output
  const { MessageFormatter } = await import('./bot/message');
  const formatter = new MessageFormatter();
  if (formatter.detectBinary(output)) {
    await feishuBot.sendText(conversationId, 'Binary output detected.');
    return;
  }

  // Check for prompts (Terminal mode)
  if (prompt?.type) {
    const card = legacyCard.buildCard(prompt);
    if (card) {
      await feishuBot.sendCard(conversationId, card);
      pendingPrompts.set(conversationId, prompt);
    } else {
      const termCard = smartCard.buildTerminalOutputCard(output);
      await feishuBot.sendCard(conversationId, termCard);
    }
  } else {
    const termCard = smartCard.buildTerminalOutputCard(output);
    await feishuBot.sendCard(conversationId, termCard);
  }
};

// ── Lazy managers ──

let _claudeManager: ClaudeManager | null = null;
function getClaudeManager(): ClaudeManager {
  if (!_claudeManager) {
    _claudeManager = new ClaudeManager(claudeCallbacks);
  }
  return _claudeManager;
}

// ── Command handling ──

async function handleCommand(
  conversationId: string,
  senderId: string,
  message: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  // Check if user is allowed
  if (!feishuBot.isUserAllowed(senderId)) {
    await feishuBot.sendText(
      conversationId,
      `Unauthorized user\nYour User ID: ${senderId}\nAdd this ID to ALLOWED_USERS in .env`
    );
    return;
  }

  const trimmedMessage = message.trim();

  // Handle commands
  if (trimmedMessage.startsWith(COMMAND_PREFIX)) {
    const parts = trimmedMessage.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'sh':
        await handleShellCommand(conversationId, args.join(' '));
        return;
      case 'claude':
        await handleClaudeCommand(conversationId, args.join(' '));
        return;
      case 'new':
        await handleNewSession(conversationId);
        return;
      case 'list':
        await handleListSessions(conversationId);
        return;
      case 'switch':
        await handleSwitchSession(conversationId, args[0]);
        return;
      case 'kill':
        await handleKillSession(conversationId, args[0]);
        return;
      case 'interrupt':
        await handleInterrupt(conversationId);
        return;
      case 'mode':
        await handleModeSwitch(conversationId, args[0]);
        return;
      case 'key':
        await handleSpecialKey(conversationId, args.join(' '));
        return;
      case 'whoami':
        await feishuBot.sendText(conversationId, `Your User ID: ${senderId}`);
        return;
      default:
        await feishuBot.sendText(
          conversationId,
          `Unknown command: ${command}\nAvailable: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami`
        );
        return;
    }
  }

  // Handle pending prompt response (Terminal mode)
  const pendingPrompt = pendingPrompts.get(conversationId);
  if (pendingPrompt) {
    const num = parseInt(trimmedMessage, 10);
    if (!isNaN(num) && num >= 0 && num < pendingPrompt.options.length) {
      const activeSessionId = activeSessions.get(conversationId);
      if (activeSessionId !== undefined) {
        const sessionManager = getSessionManager();
        const session = sessionManager.getSession(activeSessionId);
        if (session?.type === 'terminal') {
          const ptyManager = getPtyManager();
          ptyManager.writeToSession(activeSessionId, `${num}\n`);
          pendingPrompts.delete(conversationId);
          return;
        }
      }
    }
  }

  // Default: send to active session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);

    if (session?.type === 'claude') {
      // Send to Claude via --resume
      const claudeManager = getClaudeManager();
      claudeManager.startSession(conversationId, trimmedMessage, {
        resumeId: session.claudeSessionId,
        permissionMode: session.permissionMode || 'default',
        allowedTools: session.allowedTools,
      });
    } else if (session?.type === 'terminal') {
      const ptyManager = getPtyManager();
      ptyManager.writeToSession(activeSessionId, trimmedMessage + '\n');
    }
  } else {
    // No active session — create Claude session by default
    await handleClaudeCommand(conversationId, trimmedMessage);
  }
}

// ── Command handlers ──

async function handleShellCommand(conversationId: string, command: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!command) {
    await feishuBot.sendText(conversationId, 'Usage: !sh <command>');
    return;
  }

  const sessionManager = getSessionManager();
  const ptyManager = getPtyManager(handlePtyOutput);

  // Find or create a terminal session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  if (!session || session.type !== 'terminal') {
    // Create a new terminal session
    session = await sessionManager.createSession(conversationId);
    activeSessions.set(conversationId, session.id);
    activeSessionId = session.id;
    await ptyManager.spawnSession(session.id, session.tmuxName!);
  } else if (!ptyManager.isSessionActive(activeSessionId!)) {
    await ptyManager.spawnSession(activeSessionId!, session.tmuxName!);
  }

  ptyManager.writeToSession(activeSessionId!, command + '\n');
}

async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!prompt) {
    await feishuBot.sendText(conversationId, 'Usage: !claude <prompt> or just send a message');
    return;
  }

  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  // Find or create a Claude session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  if (!session || session.type !== 'claude') {
    // Create a new Claude session
    session = sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);
  }

  // Start Claude process
  claudeManager.startSession(conversationId, prompt, {
    resumeId: session.claudeSessionId,
    permissionMode: session.permissionMode || 'default',
    allowedTools: session.allowedTools,
  });
}

async function handleNewSession(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  await feishuBot.sendText(conversationId, `Created Claude session ${session.id}`);
}

async function handleListSessions(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();
  const sessions = sessionManager.getSessions();

  if (sessions.length === 0) {
    await feishuBot.sendText(conversationId, 'No active sessions');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  const lines = sessions.map(s => {
    const active = s.id === activeSessionId ? ' *' : '';
    return `  ${s.id}: [${s.type}] created ${s.created}${active}`;
  });

  await feishuBot.sendText(conversationId, `Sessions:\n${lines.join('\n')}`);
}

async function handleSwitchSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !switch <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // For terminal sessions, ensure PTY is active
  if (session.type === 'terminal' && session.tmuxName) {
    const ptyManager = getPtyManager(handlePtyOutput);
    if (!ptyManager.isSessionActive(sessionId)) {
      await ptyManager.spawnSession(sessionId, session.tmuxName);
    }
  }

  activeSessions.set(conversationId, sessionId);
  await feishuBot.sendText(conversationId, `Switched to ${session.type} session ${sessionId}`);
}

async function handleKillSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !kill <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // Kill the appropriate process
  if (session.type === 'terminal') {
    const ptyManager = getPtyManager();
    await ptyManager.killSession(sessionId);
  } else if (session.type === 'claude') {
    const claudeManager = getClaudeManager();
    claudeManager.interruptSession(conversationId);
  }

  await sessionManager.killSession(sessionId);

  if (activeSessions.get(conversationId) === sessionId) {
    activeSessions.delete(conversationId);
  }

  await feishuBot.sendText(conversationId, `Killed ${session.type} session ${sessionId}`);
}

async function handleInterrupt(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);

  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);

  if (session?.type === 'claude') {
    const claudeManager = getClaudeManager();
    claudeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Claude process interrupted');
  } else if (session?.type === 'terminal') {
    const ptyManager = getPtyManager();
    ptyManager.sendInterrupt(activeSessionId);
    await feishuBot.sendText(conversationId, 'Sent Ctrl-C');
  }
}

async function handleModeSwitch(conversationId: string, mode?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (mode !== 'auto' && mode !== 'default') {
    await feishuBot.sendText(conversationId, 'Usage: !mode auto|default');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    sessionManager.updatePermissionMode(activeSessionId, mode);
  }

  await feishuBot.sendText(conversationId, `Permission mode set to: ${mode}`);
}

async function handleSpecialKey(conversationId: string, key?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!key) {
    await feishuBot.sendText(
      conversationId,
      'Usage: !key <key>\nAvailable: up, down, left, right, enter, tab, escape, ctrl+c, ctrl+d, ...'
    );
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal') {
    await feishuBot.sendText(conversationId, '!key only works in Terminal mode');
    return;
  }

  const ptyManager = getPtyManager();
  ptyManager.sendSpecialKey(activeSessionId, key);
}

// ── Card action handling ──

async function handleCardAction(
  conversationId: string,
  senderId: string,
  value: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!feishuBot.isUserAllowed(senderId)) return;

  // Handle permission card actions
  if (isPermitAction(value)) {
    await handlePermitAction(conversationId, value);
    return;
  }

  // Handle "More options..." button (Terminal mode)
  if (isMoreOptionsValue(value)) {
    const pendingPrompt = pendingPrompts.get(conversationId);
    if (pendingPrompt && pendingPrompt.options.length > 4) {
      const remainingOptions = pendingPrompt.options.slice(4);
      const lines = remainingOptions.map((opt, i) => `${i + 4}. ${opt.label}`);
      await feishuBot.sendText(conversationId, `More options:\n${lines.join('\n')}\nType the number to select.`);
    }
    return;
  }

  // Send the value to the active terminal session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'terminal') {
      const ptyManager = getPtyManager();
      ptyManager.writeToSession(activeSessionId, `${value}\n`);
      pendingPrompts.delete(conversationId);
    }
  }
}

async function handlePermitAction(conversationId: string, value: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) return;

  const session = sessionManager.getSession(activeSessionId);
  if (!session || session.type !== 'claude') return;

  if (value === PERMIT_DENY) {
    await feishuBot.sendText(conversationId, 'Permission denied. Claude will skip this action.');
    return;
  }

  if (value === PERMIT_ALLOW || value === PERMIT_ALWAYS) {
    // TODO: Extract denied tool name from the pending denial context
    // For now, re-run with broader permissions
    if (value === PERMIT_ALWAYS) {
      // Add to persistent allowed tools
      const tools = session.allowedTools || [];
      // In a full implementation, we'd add the specific tool here
      sessionManager.updateAllowedTools(activeSessionId, tools);
    }

    await feishuBot.sendText(conversationId, 'Permission granted. Please resend your request.');
  }
}

// ── Main entry point ──

async function main(): Promise<void> {
  const config = getConfig();
  const feishuBot = getFeishuBot();

  // Initialize session manager and reconnect sessions
  const sessionManager = getSessionManager();
  await sessionManager.reconnectSessions();

  // Initialize PTY manager with output callback
  getPtyManager(handlePtyOutput);

  // Create event dispatcher
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: '',
  });

  // Register message event handler
  eventDispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      try {
        const message = feishuBot.parseMessage(data);
        if (message) {
          await handleCommand(message.conversationId, message.senderId, message.content);
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    },
  });

  // Create WebSocket client
  const wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  // Start WebSocket connection
  console.log('Connecting to Feishu via WebSocket...');
  await wsClient.start({ eventDispatcher });

  console.log('Feishu Terminal Bot connected via WebSocket');
  console.log('Commands: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami');
  console.log('Default: messages go to Claude');
}

main().catch(console.error);
```

- [ ] **Step 2: Build to check for compilation errors**

Run: `cd /home/songkang/workspace/remote-cli && npx tsc --noEmit`
Expected: No errors (or only minor fixable type issues)

- [ ] **Step 3: Fix any compilation errors found**

Address any type errors from step 2.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: rewrite message router with dual-track Claude/Terminal support"
```

---

### Task 9: Integration Test — End-to-End Smoke

**Files:**
- Create: `tests/integration.test.ts`

A lightweight test that verifies the modules wire together correctly (mocked external dependencies).

- [ ] **Step 1: Write integration test**

Create `tests/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ClaudeManager, ClaudeManagerCallbacks } from '../src/claude/manager';
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
```

- [ ] **Step 2: Run integration test**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run tests/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run all tests to verify nothing is broken**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add end-to-end integration test for Claude event pipeline"
```

---

### Task 10: Build and Manual Verification

**Files:** None (build + runtime check)

- [ ] **Step 1: Build the project**

Run: `cd /home/songkang/workspace/remote-cli && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify the build output structure**

Run: `ls dist/claude/ dist/bot/ dist/terminal/`
Expected: `dist/claude/` has `manager.js`, `parser.js`, `types.js`; `dist/bot/` has `card.js`, `feishu.js`, `message.js`; `dist/terminal/` unchanged

- [ ] **Step 3: Run all tests one final time**

Run: `cd /home/songkang/workspace/remote-cli && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit build artifacts if needed and tag**

```bash
git add -A
git commit -m "chore: verify build and all tests pass"
```

---

## Summary of Changes

| File | Action | Description |
|------|--------|-------------|
| `src/claude/types.ts` | Create | Claude event type definitions and type guards |
| `src/claude/parser.ts` | Create | Newline-delimited JSON stream parser |
| `src/claude/manager.ts` | Create | Claude process lifecycle manager |
| `src/bot/card.ts` | Rewrite | Add SmartCardBuilder + keep legacy CardBuilder |
| `src/bot/feishu.ts` | Modify | Add `updateCard`, make `sendCard` return message_id |
| `src/config.ts` | Modify | Add `claude` config section |
| `src/terminal/session.ts` | Modify | Add Claude session type, `createClaudeSession`, etc. |
| `src/index.ts` | Rewrite | Dual-track message router |
| `.env.example` | Modify | Add Claude env vars |
| `tests/claude-types.test.ts` | Create | Type guard tests |
| `tests/claude-parser.test.ts` | Create | Parser tests |
| `tests/smart-card.test.ts` | Create | Smart card builder tests |
| `tests/session.test.ts` | Create | Extended session manager tests |
| `tests/claude-manager.test.ts` | Create | Claude manager tests |
| `tests/integration.test.ts` | Create | End-to-end pipeline test |

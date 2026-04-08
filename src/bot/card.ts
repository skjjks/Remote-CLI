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

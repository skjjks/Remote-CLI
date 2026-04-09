/**
 * Smart card builder module for Feishu Terminal Bot.
 * Builds dynamically-partitioned Feishu cards for Claude events and terminal output.
 */

import type { PromptDetectionResult } from '../terminal/prompt';

// ── Feishu Card V2 types (markdown-based) ──

export interface FeishuCardV2 {
  config: { wide_screen_mode: boolean };
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
  private card(title: string, template: string, elements: FeishuCardElement[]): FeishuCardV2 {
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title }, template },
      elements,
    };
  }

  buildInitCard(sessionId: string, model: string): FeishuCardV2 {
    return this.card('Claude Session Started', 'blue', [
      { tag: 'markdown', content: `**Session:** \`${sessionId}\`\n**Model:** ${model}` },
    ]);
  }

  buildTextCard(text: string, footer?: { model?: string; cwd?: string; context?: string; status?: string; costUsd?: number }): FeishuCardV2 {
    const truncated = text.length > MAX_CARD_CONTENT_LENGTH
      ? text.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n\n... (truncated)'
      : text;

    // Dynamic title based on status
    const statusMap: Record<string, string> = {
      thinking: 'Claude (thinking...)',
      processing: 'Claude (processing...)',
      done: 'Claude',
      working: 'Claude (working...)',
      Bash: 'Claude (running command...)',
      Edit: 'Claude (editing file...)',
      Update: 'Claude (editing file...)',
      Read: 'Claude (reading file...)',
      Write: 'Claude (writing file...)',
      Glob: 'Claude (searching files...)',
      Grep: 'Claude (searching code...)',
      Agent: 'Claude (running agent...)',
    };
    const title = footer?.status ? (statusMap[footer.status] || `Claude (${footer.status}...)`) : 'Claude';

    const elements: FeishuCardElement[] = [
      { tag: 'markdown', content: truncated },
    ];
    const footerParts: string[] = [];
    if (footer?.model) footerParts.push(footer.model);
    if (footer?.cwd) footerParts.push(footer.cwd);
    if (footer?.context) footerParts.push(`Context ${footer.context}`);
    if (footer?.costUsd) footerParts.push(`$${footer.costUsd.toFixed(2)}`);
    if (footerParts.length > 0) {
      elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join('  ·  ') }] });
    }
    return this.card(title, 'purple', elements);
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
    } else if ((toolName === 'Read' || toolName === 'Write') && input.file_path) {
      paramDisplay = `**File:** \`${input.file_path}\``;
    } else if ((toolName === 'Glob' || toolName === 'Grep') && input.pattern) {
      paramDisplay = `**Pattern:** \`${input.pattern}\``;
    } else {
      const jsonStr = JSON.stringify(input, null, 2);
      paramDisplay = `\`\`\`json\n${jsonStr.slice(0, 500)}\n\`\`\``;
    }
    return this.card(`Tool: ${toolName}`, 'turquoise', [
      { tag: 'markdown', content: paramDisplay },
      { tag: 'note', elements: [{ tag: 'plain_text', content: 'Running...' }] },
    ]);
  }

  buildToolResultCard(toolName: string, output: string, durationSec: number): FeishuCardV2 {
    const truncated = output.length > MAX_CARD_CONTENT_LENGTH
      ? output.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n... (truncated)'
      : output;
    return this.card(`Tool: ${toolName}`, 'turquoise', [
      { tag: 'markdown', content: `\`\`\`\n${truncated}\n\`\`\`` },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `Done - ${durationSec.toFixed(1)}s` }] },
    ]);
  }

  buildPermissionCard(toolName: string, description: string): FeishuCardV2 {
    return this.card('Confirmation Required', 'red', [
      { tag: 'markdown', content: `Claude wants to use **${toolName}**:\n\`\`\`\n${description}\n\`\`\`` },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: 'Allow' }, value: PERMIT_ALLOW, type: 'primary' },
          { tag: 'button', text: { tag: 'plain_text', content: 'Deny' }, value: PERMIT_DENY, type: 'danger' },
          { tag: 'button', text: { tag: 'plain_text', content: 'Always Allow' }, value: PERMIT_ALWAYS },
        ],
      },
    ]);
  }

  buildCompletionCard(stats: CompletionStats): FeishuCardV2 {
    const durationSec = (stats.durationMs / 1000).toFixed(1);
    return this.card('Session Complete', 'green', [
      { tag: 'markdown', content: [
        `**Duration:** ${durationSec}s`,
        `**Turns:** ${stats.numTurns}`,
        `**Tokens:** ${stats.inputTokens.toLocaleString()} in / ${stats.outputTokens.toLocaleString()} out`,
        `**Cost:** $${stats.costUsd.toFixed(4)}`,
      ].join('\n') },
    ]);
  }

  buildTerminalOutputCard(output: string, opts?: { command?: string; sessionId?: number; cwd?: string }): FeishuCardV2 {
    const truncated = output.length > MAX_CARD_CONTENT_LENGTH
      ? output.slice(0, MAX_CARD_CONTENT_LENGTH) + '\n... (truncated)'
      : output;
    const title = opts?.command ? `$ ${opts.command}` : 'Terminal';
    const elements: FeishuCardElement[] = [
      { tag: 'markdown', content: `\`\`\`\n${truncated}\n\`\`\`` },
    ];
    const footerParts: string[] = [];
    if (opts?.sessionId !== undefined) footerParts.push(`Session #${opts.sessionId}`);
    if (opts?.cwd) footerParts.push(opts.cwd);
    if (footerParts.length > 0) {
      elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join('  ·  ') }] });
    }
    return this.card(title, 'grey', elements);
  }

  buildMenuCard(title: string, options: Array<{ label: string; index: number; selected: boolean }>, hint: string): FeishuCardV2 {
    const parts: string[] = [];

    // Context/description above options
    if (title) {
      parts.push(title);
      parts.push('');
    }

    // Options
    for (const opt of options) {
      if (opt.selected) {
        parts.push(`**> ${opt.index}. ${opt.label} <**`);
      } else {
        parts.push(`  ${opt.index}. ${opt.label}`);
      }
    }

    if (hint) {
      parts.push('');
      parts.push(`_${hint}_`);
    }
    parts.push('\nType a number to select.');

    return this.card('Claude', 'purple', [
      { tag: 'markdown', content: parts.join('\n') },
    ]);
  }

  buildHelpCard(): FeishuCardV2 {
    const content = [
      '**Claude (default)**',
      'Direct messages go to Claude',
      '',
      '| Command | Description |',
      '| --- | --- |',
      '| `!help` | Show this help |',
      '| `!claude <prompt>` | Start/send to Claude |',
      '| `!sh <cmd>` | Run shell command |',
      '| `!new` | New Claude session |',
      '| `!list` | List all sessions |',
      '| `!switch <id>` | Switch session |',
      '| `!kill <id>` | Kill session |',
      '| `!interrupt` | Ctrl-C / stop |',
      '| `!cd <path>` | Switch Claude working directory |',
      '| `!mode auto\\|default` | Permission mode |',
      '| `!key <key>` | Send key (up/down/enter/escape/ctrl+c) |',
      '| `!whoami` | Show your User ID |',
      '',
      '**Tips**',
      '- Type a number to select menu options',
      '- `!key escape` to exit menus',
    ].join('\n');
    return this.card('Help', 'blue', [
      { tag: 'markdown', content },
    ]);
  }

  buildErrorCard(error: string): FeishuCardV2 {
    return this.card('Error', 'red', [
      { tag: 'markdown', content: `\`\`\`\n${error}\n\`\`\`` },
    ]);
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

export function isMenuAction(value: string): boolean {
  return /^__menu_\d+__$/.test(value);
}

export function getMenuIndex(value: string): number {
  const match = value.match(/^__menu_(\d+)__$/);
  return match ? parseInt(match[1], 10) : -1;
}

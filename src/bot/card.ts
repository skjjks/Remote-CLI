/**
 * Smart card builder module for Feishu Terminal Bot.
 * Builds dynamically-partitioned Feishu cards for Claude events and terminal output.
 */


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


// ── Constants ──

const MAX_VISIBLE_BUTTONS = 4;
const MORE_OPTIONS_VALUE = '__more__';
const MAX_CARD_CONTENT_LENGTH = 10000;

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

  /**
   * Split long text into chunks that fit within card element limits.
   * Splits at paragraph boundaries (double newline) when possible.
   */
  private splitContent(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a paragraph boundary
      let splitIdx = remaining.lastIndexOf('\n\n', maxLength);
      if (splitIdx < maxLength * 0.3) {
        // No good paragraph break, try single newline
        splitIdx = remaining.lastIndexOf('\n', maxLength);
      }
      if (splitIdx < maxLength * 0.3) {
        // No good newline break, hard split
        splitIdx = maxLength;
      }

      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
    }

    return chunks;
  }

  private stripAnsi(text: string): string {
    // CSI sequences (colors, cursor movement, etc.)
    let result = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    // OSC sequences (terminal title, hyperlinks): ESC ] ... ST or ESC ] ... BEL
    result = result.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    // Other escape sequences: ESC followed by single char
    result = result.replace(/\x1b[^[\]]/g, '');
    return result;
  }

  /**
   * Escape markdown-sensitive characters in terminal output so Feishu
   * renders it as plain text instead of interpreting formatting.
   */
  private escapeMarkdown(text: string): string {
    return text
      // Escape paired *word* and **word** patterns (bold/italic)
      .replace(/\*([^\s*]([^*]*[^\s*])?)\*/g, '\\*$1\\*')
      // Escape backtick pairs that Feishu would render as inline code
      .replace(/`([^`]+)`/g, '\\`$1\\`')
      // Escape [text](url) link patterns
      .replace(/\[([^\]]+)\]\(/g, '\\[$1\\](');
  }

  /**
   * Detect the likely language/format of terminal output for syntax highlighting.
   * Returns a language identifier for code blocks, or 'plain' for plain text display.
   */
  private detectOutputLanguage(output: string): string {
    const trimmed = output.trimStart();

    // JSON: starts with { or [
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json';
    }

    const lines = output.split('\n');

    // Diff: multiple lines starting with diff markers
    let diffMarkers = 0;
    for (const line of lines) {
      if (/^(\+\+\+|---|@@|\+[^+]|-[^-]|diff --)/.test(line)) {
        diffMarkers++;
      }
    }
    if (diffMarkers >= 3) {
      return 'diff';
    }

    // Git log: commit hash + Author + Date pattern
    if (/^commit [a-f0-9]{7,40}/.test(trimmed)) {
      let gitLogMarkers = 0;
      for (const line of lines.slice(0, 10)) {
        if (/^(commit [a-f0-9]|Author:|Date:|Merge:)/.test(line)) {
          gitLogMarkers++;
        }
      }
      if (gitLogMarkers >= 2) return 'bash';
    }

    // Python traceback
    if (trimmed.startsWith('Traceback (most recent call last)')) {
      return 'python';
    }

    // XML/HTML: multiple lines with tags
    let tagCount = 0;
    for (const line of lines.slice(0, 15)) {
      if (/^\s*<[a-zA-Z/!?]/.test(line)) {
        tagCount++;
      }
    }
    if (tagCount >= 3) {
      return 'xml';
    }

    // SQL: starts with common SQL keywords
    const sqlPattern = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|WITH)\b/i;
    if (sqlPattern.test(trimmed)) {
      return 'sql';
    }

    // YAML: starts with --- or multiple key: value lines
    if (trimmed.startsWith('---')) {
      return 'yaml';
    }
    let kvCount = 0;
    for (const line of lines.slice(0, 10)) {
      if (/^\s*[\w.-]+:\s+\S/.test(line)) {
        kvCount++;
      }
    }
    if (kvCount >= 3) {
      return 'yaml';
    }

    // Default: plain text (no code block)
    return 'plain';
  }

  private hasErrorIndicators(output: string): boolean {
    const lower = output.toLowerCase();
    const patterns = [
      'error:',
      'fatal:',
      'command not found',
      'permission denied',
      'no such file or directory',
      'exit code',
      'exited with',
    ];
    return patterns.some(p => lower.includes(p));
  }

  buildInitCard(sessionId: string, model: string): FeishuCardV2 {
    return this.card('Claude Session Started', 'blue', [
      { tag: 'markdown', content: `**Session:** \`${sessionId}\`\n**Model:** ${model}` },
    ]);
  }

  /**
   * Parse markdown tables into Feishu native table elements.
   * Returns mixed array of markdown text segments and table elements.
   */
  private parseTablesFromText(text: string): FeishuCardElement[] {
    const lines = text.split('\n');
    const elements: FeishuCardElement[] = [];
    let currentText: string[] = [];

    const flushText = () => {
      const t = currentText.join('\n').trim();
      if (t) {
        const chunks = this.splitContent(t, MAX_CARD_CONTENT_LENGTH);
        for (const chunk of chunks) {
          elements.push({ tag: 'markdown', content: chunk });
        }
      }
      currentText = [];
    };

    let i = 0;
    while (i < lines.length) {
      // Detect markdown table: line with |, followed by separator line with |---|
      if (lines[i].includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+\s*\|/.test(lines[i + 1])) {
        flushText();

        // Parse header
        const headerCells = lines[i].split('|').map(c => c.trim()).filter(c => c);
        i++; // skip separator line
        i++;

        // Parse rows
        const rows: Record<string, string>[] = [];
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
          const cells = lines[i].split('|').map(c => c.trim()).filter(c => c);
          const row: Record<string, string> = {};
          headerCells.forEach((h, idx) => {
            row[`col_${idx}`] = cells[idx] || '';
          });
          rows.push(row);
          i++;
        }

        // Build Feishu table element
        const columns = headerCells.map((h, idx) => ({
          name: `col_${idx}`,
          display_name: h,
          data_type: 'text' as const,
          width: 'auto' as const,
        }));

        elements.push({
          tag: 'table',
          page_size: Math.max(rows.length, 1),
          row_height: 'low',
          header_style: { text_align: 'left', text_size: 'normal', background_style: 'grey', bold: true },
          columns,
          rows,
        } as any);
      } else {
        currentText.push(lines[i]);
        i++;
      }
    }

    flushText();
    return elements;
  }

  /**
   * Detect space-aligned columnar terminal output (ps, docker, ls -l, df, etc.)
   * and convert to a Feishu native table element.
   * Returns null if the output is not tabular.
   */
  parseTerminalTable(text: string): FeishuCardElement | null {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 3) return null;

    // Header line: first non-empty line
    const headerLine = lines[0];

    // Detect column boundaries by finding runs of 2+ spaces in the header
    const colStarts: number[] = [0];
    let inSpace = false;
    for (let i = 0; i < headerLine.length; i++) {
      if (headerLine[i] === ' ') {
        if (!inSpace) inSpace = true;
      } else {
        if (inSpace && i > 0) {
          // Check if previous gap was 2+ spaces
          let gapStart = i - 1;
          while (gapStart > 0 && headerLine[gapStart - 1] === ' ') gapStart--;
          if (i - gapStart >= 2) {
            colStarts.push(i);
          }
        }
        inSpace = false;
      }
    }

    // Need at least 2 columns
    if (colStarts.length < 2) return null;

    // Extract headers
    const headers: string[] = [];
    for (let c = 0; c < colStarts.length; c++) {
      const start = colStarts[c];
      const end = c + 1 < colStarts.length ? colStarts[c + 1] : headerLine.length;
      headers.push(headerLine.slice(start, end).trim());
    }

    // Validate: check that data rows roughly align with headers
    // At least 60% of data rows must have content matching column positions
    let alignedRows = 0;
    for (let i = 1; i < lines.length; i++) {
      let colsFound = 0;
      for (let c = 0; c < colStarts.length; c++) {
        const start = colStarts[c];
        if (start < lines[i].length && lines[i][start] !== ' ') {
          colsFound++;
        }
      }
      if (colsFound >= Math.ceil(colStarts.length * 0.4)) {
        alignedRows++;
      }
    }

    if (alignedRows < (lines.length - 1) * 0.5) return null;

    // Parse data rows using column positions
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row: Record<string, string> = {};
      for (let c = 0; c < colStarts.length; c++) {
        const start = colStarts[c];
        const end = c + 1 < colStarts.length ? colStarts[c + 1] : lines[i].length;
        row[`col_${c}`] = (start < lines[i].length ? lines[i].slice(start, end).trim() : '');
      }
      rows.push(row);
    }

    const columns = headers.map((h, idx) => ({
      name: `col_${idx}`,
      display_name: h,
      data_type: 'text' as const,
      width: 'auto' as const,
    }));

    return {
      tag: 'table',
      page_size: Math.max(rows.length, 1),
      row_height: 'low',
      header_style: { text_align: 'left', text_size: 'normal', background_style: 'grey', bold: true },
      columns,
      rows,
    } as any;
  }

  buildTextCard(text: string, footer?: { backend?: string; sessionId?: string; model?: string; cwd?: string; context?: string; status?: string; costUsd?: number; inputTokens?: number; outputTokens?: number }): FeishuCardV2 {
    const elements: FeishuCardElement[] = this.parseTablesFromText(text);

    // Backend name + session ID for title
    const backendNames: Record<string, string> = { opencode: 'Opencode', clouddev: 'CloudDev' };
    const backendName = backendNames[footer?.backend || ''] || 'Claude';
    const sessionTag = footer?.sessionId ? ` [${footer.sessionId}]` : '';
    const backendColors: Record<string, string> = { opencode: 'grey', clouddev: 'blue' };
    const color = backendColors[footer?.backend || ''] || 'orange';

    // Dynamic title based on status
    const baseTitle = `${backendName}${sessionTag}`;
    const statusMap: Record<string, string> = {
      thinking: `${baseTitle} (thinking...)`,
      processing: `${baseTitle} (processing...)`,
      done: baseTitle,
      working: `${baseTitle} (working...)`,
      Bash: `${baseTitle} (running command...)`,
      Edit: `${baseTitle} (editing file...)`,
      Update: `${baseTitle} (editing file...)`,
      Read: `${baseTitle} (reading file...)`,
      Write: `${baseTitle} (writing file...)`,
      Glob: `${baseTitle} (searching files...)`,
      Grep: `${baseTitle} (searching code...)`,
      Agent: `${baseTitle} (running agent...)`,
    };
    const title = footer?.status ? (statusMap[footer.status] || `${baseTitle} (${footer.status}...)`) : baseTitle;

    const footerParts: string[] = [];
    if (footer?.model) footerParts.push(footer.model);
    if (footer?.cwd) footerParts.push(footer.cwd);
    if (footer?.context) footerParts.push(`Context ${footer.context}`);
    if (footer?.inputTokens || footer?.outputTokens) {
      const tokensStr = `${(footer.inputTokens || 0).toLocaleString()} in / ${(footer.outputTokens || 0).toLocaleString()} out`;
      footerParts.push(tokensStr);
    }
    if (footer?.costUsd) footerParts.push(`$${footer.costUsd.toFixed(4)}`);
    if (footerParts.length > 0) {
      elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join('  ·  ') }] });
    }
    return this.card(title, color, elements);
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
    const chunks = this.splitContent(output, MAX_CARD_CONTENT_LENGTH);
    const elements: FeishuCardElement[] = chunks.map(chunk => ({
      tag: 'markdown' as const,
      content: `\`\`\`\n${chunk}\n\`\`\``,
    }));
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `Done - ${durationSec.toFixed(1)}s` }] });
    return this.card(`Tool: ${toolName}`, 'turquoise', elements);
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

  buildTerminalOutputCard(output: string, opts?: { command?: string; sessionId?: number; cwd?: string; durationMs?: number; running?: boolean }): FeishuCardV2 {
    const cleaned = this.stripAnsi(output);
    const color = this.hasErrorIndicators(cleaned) ? 'red' : 'blue';

    // Title: show command with running/done status
    let title = opts?.command ? `$ ${opts.command}` : 'Terminal';
    if (opts?.running) {
      title += ' (running...)';
    }

    const lines = cleaned.split('\n');
    const lang = this.detectOutputLanguage(cleaned);
    const useCodeBlock = lang !== 'plain'; // JSON, diff, YAML, XML, SQL, Python keep code blocks
    const isShort = lines.length <= 3 && !useCodeBlock;

    let elements: FeishuCardElement[];

    if (isShort) {
      // Short output: bold text
      elements = [{ tag: 'markdown' as const, content: `**${this.escapeMarkdown(cleaned)}**` }];
    } else if (useCodeBlock) {
      // Structured formats: code blocks with syntax highlighting
      const chunks = this.splitContent(cleaned, MAX_CARD_CONTENT_LENGTH);
      elements = chunks.map(chunk => ({
        tag: 'markdown' as const,
        content: `\`\`\`${lang}\n${chunk}\n\`\`\``,
      }));
    } else {
      // Plain markdown text (escaped to prevent formatting)
      const chunks = this.splitContent(cleaned, MAX_CARD_CONTENT_LENGTH);
      elements = chunks.map(chunk => ({
        tag: 'markdown' as const,
        content: this.escapeMarkdown(chunk),
      }));
    }

    // Footer
    const footerParts: string[] = [];
    if (opts?.sessionId !== undefined) footerParts.push(`Session #${opts.sessionId}`);
    if (opts?.cwd) footerParts.push(opts.cwd);
    if (opts?.durationMs !== undefined) footerParts.push(`${(opts.durationMs / 1000).toFixed(1)}s`);
    if (footerParts.length > 0) {
      elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join('  \u00b7  ') }] });
    }
    return this.card(title, color, elements);
  }

  buildMenuCard(title: string, options: Array<{ label: string; index: number; selected: boolean }>, hint: string): FeishuCardV2 {
    const parts: string[] = [];

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
      parts.push(hint);
    }
    parts.push('\nType a number to select.');

    return this.card(title || 'Action Required', 'orange', [
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
      '| `!opencode <prompt>` / `!oc` | Start/send to opencode |',
      '| `!cloud` / `!cloud <user>` | Connect to engineering cloud |',
      '| `!sh <cmd>` | Run shell command |',
      '| `!new` / `!new claude` / `!new oc` | New terminal / Claude / opencode session |',
      '| `!list` | List all sessions |',
      '| `!switch <id>` | Switch session |',
      '| `!kill <id>` | Kill session |',
      '| `!interrupt` | Ctrl-C / stop |',
      '| `!cd <path>` | Switch AI working directory |',
      '| `!model` / `!model <name>` | Show or switch model |',
      '| `!mode auto\\|default` | Permission mode |',
      '| `!key <key>` | Send key (up/down/enter/escape/ctrl+c) |',
      '| `!history` | Show shell command history |',
      '| `!whoami` | Show your User ID |',
      '',
      '**Interactive Mode**',
      '| Command | Description |',
      '| --- | --- |',
      '| `!esc` / `!enter` / `!tab` | Send special key |',
      '| `!up` / `!down` / `!left` / `!right` | Arrow keys |',
      '| `!ctrl+c` / `!ctrl+d` / `!ctrl+z` | Ctrl combos |',
      '| `!screen` / `!sc` | Show current terminal screen |',
      '| `!raw` | Force raw input mode (no Enter appended) |',
      '| `!raw off` | Resume auto-detection |',
      '| `!backspace` / `!bs` | Backspace key |',
      '',
      '**Tips**',
      '- Type a number to select menu options',
      '- `!key escape` to exit menus',
      '- `!cloud` auto-connects via SSH relay with QR or password+token auth',
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


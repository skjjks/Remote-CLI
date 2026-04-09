import stripAnsi from 'strip-ansi';

/**
 * Constants for message formatting
 */
export const MESSAGE_CONSTANTS = {
  /** Maximum buffer size per session (4KB) */
  MAX_BUFFER_SIZE: 4096,
  /** Flush threshold at 80% capacity (3.2KB) */
  FLUSH_THRESHOLD: 3200,
  /** Flush timeout in milliseconds (500ms) */
  FLUSH_TIMEOUT: 500,
  /** Maximum length per message (2000 characters) */
  MAX_MESSAGE_LENGTH: 2000,
  /** Indicator for truncated content */
  TRUNCATION_INDICATOR: '\n\n... Show more',
} as const;

/**
 * AnsiStripper class for more control over ANSI code stripping
 */
export class AnsiStripper {
  // Regex patterns for common ANSI escape sequences
  private static readonly ANSI_ESCAPE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  private static readonly COLOR_CODES = /\x1b\[[0-9;]*m/g;
  private static readonly CURSOR_MOVEMENT = /\x1b\[(?:\d+)?(?:[ABCD]|H|f)/g;
  private static readonly ERASE_COMMANDS = /\x1b\[(?:\d+)?(?:J|K)/g;
  private static readonly SCREEN_MODES = /\x1b\[(?:\d+)?(?:h|l)/g;
  private static readonly CURSOR_VISIBILITY = /\x1b\[(?:\?25[hl])/g;
  private static readonly ALTERNATE_SCREEN = /\x1b\[(?:\?1049[hl])/g;

  /**
   * Strip all ANSI escape codes from text while preserving newlines
   * @param text - Input text with potential ANSI codes
   * @returns Text with ANSI codes removed
   */
  strip(text: string): string {
    return text
      .replace(AnsiStripper.ALTERNATE_SCREEN, '')
      .replace(AnsiStripper.CURSOR_VISIBILITY, '')
      .replace(AnsiStripper.SCREEN_MODES, '')
      .replace(AnsiStripper.ERASE_COMMANDS, '')
      .replace(AnsiStripper.CURSOR_MOVEMENT, '')
      .replace(AnsiStripper.COLOR_CODES, '')
      .replace(AnsiStripper.ANSI_ESCAPE, '');
  }

  /**
   * Strip ANSI codes using the strip-ansi package (fallback method)
   * @param text - Input text
   * @returns Text with ANSI codes removed
   */
  stripWithPackage(text: string): string {
    return stripAnsi(text);
  }
}

/**
 * Result of truncation operation
 */
export interface TruncationResult {
  /** Truncated text */
  text: string;
  /** Whether truncation occurred */
  truncated: boolean;
}

/**
 * MessageFormatter class for formatting terminal output for Feishu
 */
export class MessageFormatter {
  private ansiStripper: AnsiStripper;
  private lastPrompt: string = '';

  constructor() {
    this.ansiStripper = new AnsiStripper();
  }

  /**
   * Strip ANSI escape codes from text
   * @param text - Input text with potential ANSI codes
   * @returns Text with ANSI codes removed
   */
  stripAnsi(text: string): string {
    return this.ansiStripper.strip(text);
  }

  /**
   * Detect and extract shell prompt from output
   * @param text - Text to analyze
   * @returns Detected prompt pattern or empty string
   */
  detectPrompt(text: string): string {
    // Common prompt patterns:
    // (base) user@host:~$ or (base) user@host:~/path$
    // user@host:~$ or user@host:~/path#
    // $ or # at end of line
    // [user@host]$ or [user@host]#

    const lines = text.split('\n');
    for (const line of lines) {
      const cleaned = this.stripAnsi(line).trim();
      // Match common prompt patterns
      const promptMatch = cleaned.match(/^(?:\([^)]+\)\s*)?(?:[\w.-]+@[\w.-]+(?::[^\s$#]*)?[\$#]|\[[\w.@]+\][\$#]|[\$#])$/);
      if (promptMatch) {
        return promptMatch[0];
      }
    }
    return '';
  }

  /**
   * Remove command echo and prompt from output
   * @param text - Raw terminal output
   * @returns Cleaned output without prompts and command echoes
   */
  cleanOutput(text: string): string {
    // Strip ANSI codes first
    let cleaned = this.stripAnsi(text);

    // Split into lines
    const lines = cleaned.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines at the beginning
      if (resultLines.length === 0 && trimmedLine === '') {
        continue;
      }

      // Skip lines that look like prompts
      if (this.isPromptLine(trimmedLine)) {
        this.lastPrompt = trimmedLine;
        continue;
      }

      resultLines.push(line);
    }

    // Remove trailing prompt if present
    while (resultLines.length > 0 && this.isPromptLine(resultLines[resultLines.length - 1].trim())) {
      resultLines.pop();
    }

    // Remove trailing empty lines
    while (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === '') {
      resultLines.pop();
    }

    return resultLines.join('\n');
  }

  /**
   * Check if a line looks like a shell prompt
   */
  private isPromptLine(line: string): boolean {
    if (!line) return false;

    // Match common prompt patterns:
    // (base) user@host:~$
    // user@host:~/path$
    // [user@host]$
    // root@host:~#
    // $
    // #
    const promptPatterns = [
      /^(?:\([^)]+\)\s*)?[\w.-]+@[\w.-]+(?::[^\s$#]*)?[\$#]$/,  // user@host:path$ or (env) user@host:path$
      /^\[[\w.@:-]+\][\$#]$/,                                     // [user@host]$
      /^[\$#]$/,                                                  // just $ or #
      /^(?:\([^)]+\)\s*)?[\w.-]+@[\w.-]+[\$#]$/,                 // user@host$
    ];

    return promptPatterns.some(pattern => pattern.test(line));
  }

  /**
   * Truncate text to maximum length with indicator
   * @param text - Text to truncate
   * @param maxLength - Maximum length
   * @returns Truncation result with truncated text and flag
   */
  truncate(text: string, maxLength: number): TruncationResult {
    if (text.length <= maxLength) {
      return { text, truncated: false };
    }

    const indicator = MESSAGE_CONSTANTS.TRUNCATION_INDICATOR;
    const availableLength = maxLength - indicator.length;
    const truncatedText = text.slice(0, availableLength) + indicator;

    return { text: truncatedText, truncated: true };
  }

  /**
   * Format output for Feishu compatibility with code block
   * Splits text into messages that fit within Feishu limits
   * @param text - Text to format
   * @returns Array of formatted messages
   */
  formatOutput(text: string): string[] {
    // Strip ANSI codes first
    let cleanedText = this.stripAnsi(text);

    // Try to clean output, but if result is empty, use original (stripped) text
    const cleanedOutput = this.cleanOutput(text);
    if (cleanedOutput.trim()) {
      cleanedText = cleanedOutput;
    }

    // If still empty, return empty array
    if (!cleanedText.trim()) {
      return [];
    }

    // Wrap in code block
    const codeBlockStart = '```\n';
    const codeBlockEnd = '\n```';
    const overhead = codeBlockStart.length + codeBlockEnd.length;

    // Split into messages
    const messages: string[] = [];
    let remaining = cleanedText;
    const maxLen = MESSAGE_CONSTANTS.MAX_MESSAGE_LENGTH - overhead;
    const indicatorLen = MESSAGE_CONSTANTS.TRUNCATION_INDICATOR.length;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        messages.push(codeBlockStart + remaining + codeBlockEnd);
        break;
      }

      // Find a good break point (newline) if possible
      let breakPoint = maxLen - indicatorLen;
      const newlineSearch = remaining.lastIndexOf('\n', breakPoint);

      if (newlineSearch > maxLen * 0.5) {
        // Use newline as break point if it's reasonably close
        breakPoint = newlineSearch + 1;
        messages.push(codeBlockStart + remaining.slice(0, breakPoint) + codeBlockEnd);
        remaining = remaining.slice(breakPoint);
      } else {
        // Truncate with indicator
        const truncated = remaining.slice(0, breakPoint) + MESSAGE_CONSTANTS.TRUNCATION_INDICATOR;
        messages.push(codeBlockStart + truncated + codeBlockEnd);
        remaining = remaining.slice(breakPoint);
      }
    }

    return messages;
  }

  /**
   * Detect if text contains mostly binary content
   * Returns true if >50% of characters are non-printable
   * @param text - Text to check
   * @returns True if text is mostly binary
   */
  detectBinary(text: string): boolean {
    if (text.length === 0) {
      return false;
    }

    let nonPrintableCount = 0;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);

      // Printable ASCII range: 32-126 (space to ~)
      // Also count newlines (10), carriage returns (13), and tabs (9) as printable
      if (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        code > 126
      ) {
        // Check if it's a valid UTF-8 continuation or multi-byte character
        // Multi-byte UTF-8 characters have codes > 127
        if (code > 126 && code < 256) {
          // Extended ASCII, might be part of UTF-8 sequence, consider printable
          continue;
        }
        if (code >= 256) {
          // Unicode characters are considered printable
          continue;
        }
        nonPrintableCount++;
      }
    }

    return nonPrintableCount / len > 0.5;
  }
}

/**
 * Flush reason enum
 */
export enum FlushReason {
  /** Buffer reached flush threshold */
  THRESHOLD,
  /** Timeout triggered flush */
  TIMEOUT,
  /** Manual flush */
  MANUAL,
}

/**
 * OutputBuffer class for buffering terminal output
 */
export class OutputBuffer {
  private buffer: string = '';
  private lastFlushTime: number = Date.now();
  private timeoutId: NodeJS.Timeout | null = null;
  private onFlush?: (messages: string[], reason: FlushReason) => void;
  private formatter: MessageFormatter;

  /** Remaining content after truncation for pagination */
  private remainingContent: string = '';

  constructor(onFlush?: (messages: string[], reason: FlushReason) => void) {
    this.onFlush = onFlush;
    this.formatter = new MessageFormatter();
    this.startTimeout();
  }

  /**
   * Start the timeout-based flush mechanism
   */
  private startTimeout(): void {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.flush(FlushReason.TIMEOUT);
      } else {
        this.startTimeout();
      }
    }, MESSAGE_CONSTANTS.FLUSH_TIMEOUT);
  }

  /**
   * Clear the current timeout
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Write a chunk to the buffer
   * @param chunk - Text chunk to add to buffer
   */
  write(chunk: string): void {
    this.buffer += chunk;

    // Check if buffer exceeds threshold
    if (this.buffer.length >= MESSAGE_CONSTANTS.FLUSH_THRESHOLD) {
      this.flush(FlushReason.THRESHOLD);
    }
  }

  /**
   * Flush the buffer and return messages
   * @param reason - Reason for flush
   * @returns Array of formatted messages
   */
  flush(reason: FlushReason = FlushReason.MANUAL): string[] {
    if (this.buffer.length === 0) {
      this.startTimeout();
      return [];
    }

    const messages = this.formatter.formatOutput(this.buffer);

    // Store remaining content for pagination
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.endsWith(MESSAGE_CONSTANTS.TRUNCATION_INDICATOR)) {
        // Calculate remaining content
        const totalLength = this.buffer.length;
        const sentLength = messages.reduce((sum, msg) => sum + msg.length, 0);
        // Account for truncation indicators that weren't in original
        const indicatorCount = messages.filter(m =>
          m.endsWith(MESSAGE_CONSTANTS.TRUNCATION_INDICATOR)
        ).length;
        const indicatorTotalLen = indicatorCount * MESSAGE_CONSTANTS.TRUNCATION_INDICATOR.length;

        this.remainingContent = this.buffer.slice(
          totalLength - (sentLength - indicatorTotalLen - (messages.length - 1) * indicatorTotalLen)
        );
      } else {
        this.remainingContent = '';
      }
    }

    // Clear buffer
    this.buffer = '';
    this.lastFlushTime = Date.now();

    // Call flush callback if provided
    if (this.onFlush) {
      this.onFlush(messages, reason);
    }

    // Restart timeout
    this.startTimeout();

    return messages;
  }

  /**
   * Get remaining buffer content after truncation
   * @returns Remaining content or empty string
   */
  getRemaining(): string {
    return this.remainingContent;
  }

  /**
   * Check if there's more content to show
   * @returns True if there's remaining content
   */
  hasMore(): boolean {
    return this.remainingContent.length > 0;
  }

  /**
   * Get current buffer size
   * @returns Current buffer length
   */
  getSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if buffer should be flushed due to threshold
   * @returns True if buffer is at or above threshold
   */
  shouldFlush(): boolean {
    return this.buffer.length >= MESSAGE_CONSTANTS.FLUSH_THRESHOLD;
  }

  /**
   * Get time since last flush
   * @returns Milliseconds since last flush
   */
  getTimeSinceLastFlush(): number {
    return Date.now() - this.lastFlushTime;
  }

  /**
   * Clear the buffer without flushing
   */
  clear(): void {
    this.buffer = '';
    this.remainingContent = '';
  }

  /**
   * Destroy the buffer and clean up resources
   */
  destroy(): void {
    this.clearTimeout();
    this.buffer = '';
    this.remainingContent = '';
  }
}

// Re-export strip-ansi for convenience
export { stripAnsi };

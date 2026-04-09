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
      } catch (err) {
        // Malformed JSON — log and skip
        console.warn('[ClaudeStreamParser] Skipping malformed line:', trimmed.slice(0, 120), err instanceof Error ? err.message : err);
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

/**
 * Prompt detector module for detecting interactive prompts in terminal output.
 * Supports yes/no prompts, numbered options, and AskUserQuestion JSON format.
 */

export interface PromptOption {
  label: string;
  value: string;
}

export interface PromptDetectionResult {
  type: 'yesno' | 'numbered' | 'askuser' | null;
  message: string;
  options: PromptOption[];
  isMultiSelect: boolean;
  rawJson?: object;
}

/**
 * JsonStreamParser for detecting and extracting AskUserQuestion JSON from streaming output.
 * Handles JSON that may be split across multiple chunks.
 */
export class JsonStreamParser {
  private buffer: string = '';
  private jsonStartIndex: number = -1;
  private braceDepth: number = 0;
  private inString: boolean = false;
  private escapeNext: boolean = false;

  /**
   * Reset the parser state
   */
  reset(): void {
    this.buffer = '';
    this.jsonStartIndex = -1;
    this.braceDepth = 0;
    this.inString = false;
    this.escapeNext = false;
  }

  /**
   * Get the current buffer content
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Process a chunk of output and attempt to extract complete JSON.
   * @param chunk - The output chunk to process
   * @returns The complete JSON object if found, null otherwise
   */
  process(chunk: string): object | null {
    this.buffer += chunk;

    const jsonStartPattern = '{"questions":';

    // If we haven't found the start of JSON yet, look for it
    if (this.jsonStartIndex === -1) {
      const startIndex = this.buffer.indexOf(jsonStartPattern);
      if (startIndex !== -1) {
        this.jsonStartIndex = startIndex;
        // Initialize brace depth with the opening brace
        this.braceDepth = 0;
        this.inString = false;
        this.escapeNext = false;

        // Process from the start of the JSON
        for (let i = this.jsonStartIndex; i < this.buffer.length; i++) {
          const char = this.buffer[i];

          if (this.escapeNext) {
            this.escapeNext = false;
            continue;
          }

          if (char === '\\' && this.inString) {
            this.escapeNext = true;
            continue;
          }

          if (char === '"') {
            this.inString = !this.inString;
            continue;
          }

          if (!this.inString) {
            if (char === '{') {
              this.braceDepth++;
            } else if (char === '}') {
              this.braceDepth--;
              if (this.braceDepth === 0) {
                // Found complete JSON
                const jsonStr = this.buffer.substring(this.jsonStartIndex, i + 1);
                try {
                  const parsed = JSON.parse(jsonStr);
                  // Clear the processed portion from buffer
                  this.buffer = this.buffer.substring(i + 1);
                  this.jsonStartIndex = -1;
                  return parsed;
                } catch {
                  // Invalid JSON, reset and continue
                  this.jsonStartIndex = -1;
                  this.braceDepth = 0;
                  return null;
                }
              }
            }
          }
        }
      }
    } else {
      // Continue processing from where we left off
      for (let i = this.buffer.length - chunk.length; i < this.buffer.length; i++) {
        const char = this.buffer[i];

        if (this.escapeNext) {
          this.escapeNext = false;
          continue;
        }

        if (char === '\\' && this.inString) {
          this.escapeNext = true;
          continue;
        }

        if (char === '"') {
          this.inString = !this.inString;
          continue;
        }

        if (!this.inString) {
          if (char === '{') {
            this.braceDepth++;
          } else if (char === '}') {
            this.braceDepth--;
            if (this.braceDepth === 0) {
              // Found complete JSON
              const jsonStr = this.buffer.substring(this.jsonStartIndex, i + 1);
              try {
                const parsed = JSON.parse(jsonStr);
                // Clear the processed portion from buffer
                this.buffer = this.buffer.substring(i + 1);
                this.jsonStartIndex = -1;
                return parsed;
              } catch {
                // Invalid JSON, reset and continue
                this.jsonStartIndex = -1;
                this.braceDepth = 0;
                return null;
              }
            }
          }
        }
      }
    }

    return null;
  }
}

/**
 * PromptDetector for detecting various types of interactive prompts.
 */
export class PromptDetector {
  /**
   * Detect yes/no prompt patterns in output.
   * Matches patterns like [y/n], [Y/n], (y/n), Y/n, etc.
   */
  detectYesNo(output: string): PromptDetectionResult | null {
    // Patterns for yes/no prompts
    const yesNoPatterns = [
      /\[([Yy])\/([Nn])\]/,
      /\(([Yy])\/([Nn])\)/,
      /\b([Yy])\/([Nn])\b/,
      /\[([Yy])\/([Nn])\/([Qq])\]/,  // Yes/No/Quit pattern
      /\(([Yy])\/([Nn])\/([Qq])\)/,
    ];

    for (const pattern of yesNoPatterns) {
      const match = output.match(pattern);
      if (match) {
        // Find the message before the prompt
        const matchIndex = output.search(pattern);
        const messagePart = output.substring(0, matchIndex).trim();

        // Extract the actual question/prompt text
        const lines = messagePart.split('\n');
        const message = lines[lines.length - 1] || 'Continue?';

        return {
          type: 'yesno',
          message,
          options: [
            { label: 'Yes', value: 'y' },
            { label: 'No', value: 'n' },
          ],
          isMultiSelect: false,
        };
      }
    }

    return null;
  }

  /**
   * Detect numbered option prompts in output.
   * Matches patterns like (1) Option (2) Option, 1) Option 2) Option, etc.
   */
  detectNumbered(output: string): PromptDetectionResult | null {
    const options: PromptOption[] = [];

    // Pattern to match numbered options
    // Matches: (1) Option, 1) Option, 1. Option, [1] Option
    const optionPattern = /(?:\((\d+)\)|\[(\d+)\]|(\d+)\)|(\d+)\.)\s*([^\n]+)/g;

    let match;
    let lastIndex = 0;
    const matchedIndices: number[] = [];

    while ((match = optionPattern.exec(output)) !== null) {
      // Get the number from whichever group matched
      const num = match[1] || match[2] || match[3] || match[4];
      if (!num) continue;

      const optionNum = parseInt(num, 10);
      const optionText = match[5].trim();

      // Validate option number is reasonable
      if (optionNum > 0 && optionNum <= 100 && optionText.length > 0) {
        // Check for consecutive numbers
        if (options.length === 0 || optionNum === options.length + 1) {
          options.push({
            label: optionText,
            value: num,
          });
          matchedIndices.push(match.index);
          lastIndex = match.index + match[0].length;
        }
      }
    }

    // Require at least 2 options to be considered a numbered prompt
    if (options.length >= 2) {
      // Find message before the first option
      const firstOptionIndex = matchedIndices[0];
      const messagePart = output.substring(0, firstOptionIndex).trim();
      const lines = messagePart.split('\n');
      const message = lines[lines.length - 1] || 'Select an option:';

      return {
        type: 'numbered',
        message,
        options,
        isMultiSelect: false,
      };
    }

    return null;
  }

  /**
   * Detect AskUserQuestion JSON format from Claude Code.
   * Uses JsonStreamParser to handle streaming/chunked output.
   */
  detectAskUser(parser: JsonStreamParser, chunk: string): PromptDetectionResult | null {
    const json = parser.process(chunk);

    if (!json || !isAskUserQuestion(json)) {
      return null;
    }

    const questions = json.questions;
    if (!questions || questions.length === 0) {
      return null;
    }

    // Process the first question
    const question = questions[0];
    const options: PromptOption[] = [];
    let isMultiSelect = false;

    // Handle different question types
    if (question.type === 'select' && question.options) {
      isMultiSelect = question.multiple === true;
      for (const opt of question.options) {
        if (typeof opt === 'object' && opt !== null && 'value' in opt) {
          options.push({
            label: String(opt.label ?? opt.value),
            value: String(opt.value),
          });
        }
      }
    } else if (question.type === 'confirm') {
      options.push(
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' }
      );
    } else if (question.type === 'text' || question.type === 'input') {
      // Text input - no options needed
    }

    return {
      type: 'askuser',
      message: question.message || question.prompt || 'Input required',
      options,
      isMultiSelect,
      rawJson: json,
    };
  }
}

/**
 * Type guard for AskUserQuestion format
 */
interface AskUserQuestion {
  questions: Array<{
    type?: string;
    message?: string;
    prompt?: string;
    options?: Array<{ value: unknown; label?: unknown } | string>;
    multiple?: boolean;
  }>;
}

function isAskUserQuestion(obj: unknown): obj is AskUserQuestion {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const o = obj as Record<string, unknown>;
  return 'questions' in o && Array.isArray(o.questions);
}

/**
 * Main function to detect prompts in terminal output.
 * Tries all available detectors in order.
 */
export function detectPrompt(
  output: string,
  jsonParser?: JsonStreamParser
): PromptDetectionResult {
  const detector = new PromptDetector();

  // Try yes/no detection first
  const yesNoResult = detector.detectYesNo(output);
  if (yesNoResult) {
    return yesNoResult;
  }

  // Try numbered options detection
  const numberedResult = detector.detectNumbered(output);
  if (numberedResult) {
    return numberedResult;
  }

  // Try AskUser JSON detection if parser is provided
  if (jsonParser) {
    const askUserResult = detector.detectAskUser(jsonParser, '');
    if (askUserResult) {
      return askUserResult;
    }
  }

  // No prompt detected
  return {
    type: null,
    message: '',
    options: [],
    isMultiSelect: false,
  };
}

/**
 * Detect prompts using the JSON parser with a new chunk.
 */
export function detectPromptWithChunk(
  output: string,
  jsonParser: JsonStreamParser,
  chunk: string
): PromptDetectionResult {
  const detector = new PromptDetector();

  // Try yes/no detection first
  const yesNoResult = detector.detectYesNo(output);
  if (yesNoResult) {
    return yesNoResult;
  }

  // Try numbered options detection
  const numberedResult = detector.detectNumbered(output);
  if (numberedResult) {
    return numberedResult;
  }

  // Try AskUser JSON detection
  const askUserResult = detector.detectAskUser(jsonParser, chunk);
  if (askUserResult) {
    return askUserResult;
  }

  // No prompt detected
  return {
    type: null,
    message: '',
    options: [],
    isMultiSelect: false,
  };
}

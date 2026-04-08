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

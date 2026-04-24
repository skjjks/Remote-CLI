import { query, type Query, type SDKMessage, type Options as SDKOptions, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getConfig } from '../../config';
import type { AISessionDriver, PendingPermission } from '../types';
import type { AIManagerCallbacks } from '../manager';
import { pendingRequests, modelOverrides } from '../../state';
import { buildMetadata, createThrottledUpdater, createPendingRequest } from '../shared';

/** Keys the SDK child process needs to authenticate and route to the right provider. */
const REQUIRED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

/**
 * Ensure ANTHROPIC_* env vars are present in process.env.
 * If any are missing, fill them from ~/.claude/settings.json → env.
 */
let _envPatched = false;
function ensureClaudeEnv(): void {
  if (_envPatched) return;
  _envPatched = true;

  const missing = REQUIRED_ENV_KEYS.filter(k => !process.env[k]);
  if (missing.length === 0) return;

  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const envBlock: Record<string, string> = settings.env ?? {};

    for (const key of missing) {
      if (envBlock[key]) {
        process.env[key] = envBlock[key];
      }
    }

    const filled = missing.filter(k => process.env[k]);
    if (filled.length > 0) {
      console.log(`[CLAUDE-SDK] Patched env from ~/.claude/settings.json: ${filled.join(', ')}`);
    }
  } catch {
    // settings.json not found or unreadable — no-op
  }
}

interface ClaudeSession {
  conversationId: string;
  sessionId?: string;       // Claude session_id from init event
  activeQuery?: Query;       // Current running query
  messageId?: string;        // Current Feishu card message ID
  accumulatedText: string;   // Accumulated response text
  model?: string;
  cwd?: string;
}

export class ClaudeSDKDriver implements AISessionDriver {
  private sessions: Map<string, ClaudeSession> = new Map();
  private callbacks: AIManagerCallbacks;
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  constructor(callbacks: AIManagerCallbacks) {
    this.callbacks = callbacks;
  }

  async start(conversationId: string, options: { cwd?: string }): Promise<void> {
    // Check for existing session to resume
    const existing = this.sessions.get(conversationId);

    const session: ClaudeSession = {
      conversationId,
      sessionId: existing?.sessionId,
      accumulatedText: '',
    };
    this.sessions.set(conversationId, session);

    // Don't send a prompt on start -- just initialize
    // The first sendMessage will send the actual prompt
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    ensureClaudeEnv();

    const session = this.sessions.get(conversationId);
    if (!session) {
      this.callbacks.onError(conversationId, 'No active Claude session');
      return;
    }

    const config = getConfig();
    const mode = config.claude.defaultMode;

    const sdkOptions: Partial<SDKOptions> = {
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'Agent', 'WebFetch', 'NotebookEdit', 'TodoRead', 'TodoWrite'],
      settingSources: ['project' as any],  // Load .claude/skills, CLAUDE.md, slash commands
      // Adaptive thinking (Opus 4.6+): Claude decides when/how much to think.
      // Upstream Bedrock-backed proxy rejects the legacy `{type:'enabled'}` format.
      thinking: { type: 'adaptive' } as any,
    };

    // Apply model: override > env default > opus
    const modelOverride = modelOverrides.get(conversationId);
    sdkOptions.model = modelOverride
      || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
      || 'claude-opus-4-6';

    if (mode === 'auto') {
      sdkOptions.permissionMode = 'bypassPermissions';
      sdkOptions.allowDangerouslySkipPermissions = true;
    } else {
      // In default (non-auto) mode, register permission callback
      sdkOptions.canUseTool = async (toolName, input, options) => {
        console.log(`[CLAUDE-PERM] canUseTool hit: tool=${toolName} conv=${conversationId} input-keys=${Object.keys(input || {}).join(',')}`);
        return new Promise<PermissionResult>((resolve) => {
          const requestId = createPendingRequest('permission', conversationId, resolve, config.claude.permissionTimeout);

          // Deny AskUserQuestion — no terminal UI in SDK mode.
          // Tell Claude to ask questions directly in text output instead.
          if (toolName === 'AskUserQuestion') {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(requestId);
            }
            resolve({
              behavior: 'deny',
              message: 'AskUserQuestion is not available in this environment. Ask your questions directly in your text response instead — the user will reply in the next message.',
            });
            return;
          }

          // Build description of what the tool wants to do
          let description = '';
          const menuTitle = `${options.title || toolName} wants permission`;

          if (toolName === 'Bash' && input.command) {
            description = `\`\`\`\n${String(input.command).slice(0, 500)}\n\`\`\``;
          } else if (toolName === 'Edit' && input.file_path) {
            description = `File: \`${input.file_path}\``;
          } else if ((toolName === 'Read' || toolName === 'Write') && input.file_path) {
            description = `File: \`${input.file_path}\``;
          } else {
            description = JSON.stringify(input, null, 2).slice(0, 500);
          }

          // Send permission card via onMenu callback
          this.callbacks.onMenu(conversationId, {
            title: menuTitle,
            options: [
              { label: 'Allow', index: 0, selected: false },
              { label: 'Deny', index: 1, selected: false },
              { label: 'Allow All', index: 2, selected: false },
            ],
            hint: description,
          });
        });
      };

      // Register elicitation callback for MCP / AskUserQuestion
      sdkOptions.onElicitation = async (request, { signal }) => {
        return new Promise<any>((resolve) => {
          const requestId = createPendingRequest('question', conversationId, resolve, config.claude.permissionTimeout);

          signal.addEventListener('abort', () => {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(requestId);
            }
            resolve({ action: 'cancel' as const });
          }, { once: true });

          // Build menu from elicitation message
          const title = request.title || request.message || 'Claude has a question';
          const hint = request.description || '';

          // For form-based elicitations, show accept/decline
          this.callbacks.onMenu(conversationId, {
            title,
            options: [
              { label: 'Accept', index: 0, selected: false },
              { label: 'Decline', index: 1, selected: false },
            ],
            hint,
          });
        });
      };
    }

    if (session.sessionId) {
      sdkOptions.resume = session.sessionId;
    }

    // Reset accumulated text for new message
    session.accumulatedText = '';
    session.messageId = undefined;

    // Create query
    const q = query({ prompt: message, options: sdkOptions as SDKOptions });
    session.activeQuery = q;

    // Consume stream in background
    this.consumeStream(conversationId, session, q).catch(err => {
      console.error(`[CLAUDE-SDK] Stream error for ${conversationId}:`, err);
      this.callbacks.onError(conversationId, `Stream error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async consumeStream(conversationId: string, session: ClaudeSession, q: Query): Promise<void> {
    const config = getConfig();
    const throttle = createThrottledUpdater(this.callbacks, config.claude.cardUpdateInterval);

    try {
      for await (const msg of q) {
        // Capture session ID, model, cwd from init event
        if (msg.type === 'system' && 'subtype' in msg && (msg as any).subtype === 'init') {
          const initMsg = msg as any;
          session.sessionId = initMsg.session_id;
          session.model = initMsg.model;
          session.cwd = initMsg.cwd;
          continue;
        }

        // Assistant message -- extract text content
        if (msg.type === 'assistant') {
          const assistantMsg = msg as any;
          const textBlocks = assistantMsg.message?.content?.filter((b: any) => b.type === 'text') || [];
          const toolBlocks = assistantMsg.message?.content?.filter((b: any) => b.type === 'tool_use') || [];

          // Accumulate text
          for (const block of textBlocks) {
            if (block.text) {
              session.accumulatedText += (session.accumulatedText ? '\n' : '') + block.text;
            }
          }

          if (toolBlocks.length > 0) {
            console.log(`[CLAUDE-TOOL] assistant used ${toolBlocks.length} tool(s): ${toolBlocks.map((b: any) => b.name).join(', ')} conv=${conversationId}`);
          }

          // Handle tool use blocks
          for (const block of toolBlocks) {
            const toolName = block.name || 'Tool';
            const input = block.input || {};

            // Show tool use as status
            const inputSummary = typeof input === 'object'
              ? Object.entries(input).map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`).join(', ')
              : String(input).slice(0, 100);
            session.accumulatedText += `\n\n**${toolName}**(${inputSummary})`;
          }

          // Create card if first content
          if (!session.messageId && session.accumulatedText) {
            const meta = buildMetadata({ backend: 'claude', sessionId: session.sessionId, model: session.model, cwd: session.cwd, status: 'working' });
            session.messageId = await this.callbacks.onStreamStart(conversationId, meta);
          }

          // Throttled update
          if (session.messageId && session.accumulatedText) {
            const meta = buildMetadata({ backend: 'claude', sessionId: session.sessionId, model: session.model, cwd: session.cwd, status: 'working' });
            throttle.update(conversationId, session.messageId, session.accumulatedText, meta);
          }
          continue;
        }

        // Tool progress -- update status
        if (msg.type === 'tool_progress') {
          // Just note the tool in progress for metadata
          continue;
        }

        // Result -- stream complete
        if (msg.type === 'result') {
          const result = msg as any;
          const metadata = buildMetadata({
            backend: 'claude',
            sessionId: session.sessionId,
            model: session.model,
            cwd: session.cwd,
            costUsd: result.total_cost_usd,
            inputTokens: result.usage?.input_tokens,
            outputTokens: result.usage?.output_tokens,
            status: 'done',
          });

          // Flush any pending content
          if (session.messageId && session.accumulatedText) {
            throttle.flush(conversationId, session.messageId, session.accumulatedText, metadata);
          }

          if (session.messageId && session.accumulatedText) {
            this.callbacks.onStreamEnd(conversationId, session.messageId, session.accumulatedText, metadata);
          } else if (result.result) {
            // Fast response -- never streamed
            session.accumulatedText = result.result;
            const meta = buildMetadata({ backend: 'claude', sessionId: session.sessionId, model: session.model, cwd: session.cwd, status: 'working' });
            session.messageId = await this.callbacks.onStreamStart(conversationId, meta);
            if (session.messageId) {
              this.callbacks.onStreamEnd(conversationId, session.messageId, session.accumulatedText, metadata);
            }
          }

          session.activeQuery = undefined;
          return;
        }
      }
    } catch (err) {
      session.activeQuery = undefined;
      throw err;
    }
  }


  async selectMenuOption(conversationId: string, index: number): Promise<void> {
    // With SDK, menus are handled via canUseTool permissions, not numbered menus
    // If needed, send as text message
    await this.sendMessage(conversationId, String(index));
  }

  async interrupt(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session?.activeQuery) {
      await session.activeQuery.interrupt();
      session.activeQuery = undefined;
    }
  }

  async isAlive(conversationId: string): Promise<boolean> {
    return this.sessions.has(conversationId);
  }

  async reconnect(conversationId: string, sessionId: string): Promise<boolean> {
    // Store session ID for resume on next sendMessage
    const session: ClaudeSession = {
      conversationId,
      sessionId,
      accumulatedText: '',
    };
    this.sessions.set(conversationId, session);
    console.log(`[CLAUDE-SDK] Registered session ${sessionId} for resume`);
    return true;
  }

  async kill(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      if (session.activeQuery) {
        // Use the generator's return() to cleanly close
        await session.activeQuery.return(undefined as any);
        session.activeQuery = undefined;
      }
      this.sessions.delete(conversationId);
    }
  }

  async killAll(): Promise<void> {
    for (const [convId] of this.sessions) {
      await this.kill(convId);
    }
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  getSessionId(conversationId: string): string | undefined {
    return this.sessions.get(conversationId)?.sessionId;
  }

  /** Resolve a pending permission request (called from card action handler). */
  resolvePermission(toolUseID: string, allow: boolean): void {
    const pending = this.pendingPermissions.get(toolUseID);
    if (pending) {
      pending.resolve(allow
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'User denied permission' }
      );
      this.pendingPermissions.delete(toolUseID);
    }
  }
}

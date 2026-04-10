import type { AISessionDriver } from '../types';
import type { AIManagerCallbacks, AIMetadata } from '../manager';

// @opencode-ai/sdk is ESM-only. We use dynamic import() to load it from CJS.
// All SDK types are used structurally (duck-typed) to avoid compile-time ESM imports.
type OpencodeClient = any;

let _sdkModule: any = null;
async function loadSDK(): Promise<{ createOpencode: (opts?: any) => Promise<{ client: any; server: { url: string; close(): void } }> }> {
  if (!_sdkModule) {
    // Use Function constructor to preserve real ESM import() — prevents
    // TypeScript from compiling it into require() in CommonJS output.
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    _sdkModule = await dynamicImport('@opencode-ai/sdk');
  }
  return _sdkModule;
}

interface SessionState {
  conversationId: string;
  sessionId?: string;       // Opencode session ID
  messageId?: string;        // Current Feishu card message ID
  accumulatedText: string;
}

// Singleton server — shared across all driver instances
let _server: { url: string; close(): void } | null = null;
let _client: OpencodeClient | null = null;

async function ensureServer(): Promise<OpencodeClient> {
  if (_client) return _client;
  const sdk = await loadSDK();
  const result = await sdk.createOpencode({ port: 0 });
  _server = result.server;
  _client = result.client;
  console.log(`[OPENCODE-SDK] Server started at ${result.server.url}`);
  return _client;
}

export class OpencodeSDKDriver implements AISessionDriver {
  private sessions: Map<string, SessionState> = new Map();
  private callbacks: AIManagerCallbacks;
  private eventLoopRunning = false;

  constructor(callbacks: AIManagerCallbacks) {
    this.callbacks = callbacks;
  }

  async start(conversationId: string, options: { cwd?: string }): Promise<void> {
    const client = await ensureServer();

    // Create a new opencode session
    const result = await client.session.create({
      body: { title: `feishu-${conversationId.slice(-8)}` },
      query: options.cwd ? { directory: options.cwd } : undefined,
    });

    const sessionData = result.data as any;
    const sessionId = sessionData?.id;

    const session: SessionState = {
      conversationId,
      sessionId,
      accumulatedText: '',
    };
    this.sessions.set(conversationId, session);

    // Start the global event loop if not already running
    if (!this.eventLoopRunning) {
      this.startEventLoop(client);
    }
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session?.sessionId) {
      this.callbacks.onError(conversationId, 'No active opencode session');
      return;
    }

    const client = await ensureServer();

    // Reset for new message
    session.accumulatedText = '';
    session.messageId = undefined;

    // Send prompt asynchronously — returns immediately, events arrive via SSE
    await client.session.promptAsync({
      path: { id: session.sessionId },
      body: {
        parts: [{ type: 'text' as const, text: message }],
        agent: 'build',  // Use the primary agent
      },
    });

    // Create the initial Feishu card
    session.messageId = await this.callbacks.onStreamStart(conversationId);
  }

  private async startEventLoop(client: OpencodeClient): Promise<void> {
    this.eventLoopRunning = true;
    try {
      // event.subscribe returns { stream: AsyncGenerator<Event> }
      const { stream } = await client.event.subscribe();

      for await (const rawEvent of stream) {
        // The stream yields Event objects (union type) directly.
        // However, with the global endpoint it may be wrapped as GlobalEvent.
        const event = rawEvent as any;

        // Unwrap GlobalEvent wrapper if present
        let payload: any;
        if ('payload' in event && event.payload) {
          payload = event.payload as any;
        } else {
          payload = event as any;
        }

        this.handleEvent(payload);
      }
    } catch (err) {
      console.error('[OPENCODE-SDK] Event loop error:', err);
    } finally {
      this.eventLoopRunning = false;
    }
  }

  private handleEvent(event: any): void {
    switch (event.type) {
      case 'message.part.updated':
        this.handlePartUpdated(event as any);
        break;

      case 'session.status':
        this.handleSessionStatus(event as any);
        break;

      case 'session.error':
        this.handleSessionError(event as any);
        break;

      default:
        // Ignore other event types (file.edited, todo.updated, etc.)
        break;
    }
  }

  private handlePartUpdated(event: any): void {
    const { part, delta } = event.properties;
    const session = this.findSessionById(part.sessionID);
    if (!session) return;

    if (part.type === 'text') {
      const textPart = part as any;
      if (delta) {
        // Incremental delta — append
        session.accumulatedText += delta;
      } else if (textPart.text) {
        // Full replacement — use the full text
        // Only replace if this is likely a full snapshot (no delta field)
        session.accumulatedText = textPart.text;
      }
    } else if (part.type === 'tool') {
      const toolPart = part as any;
      const toolName = toolPart.tool || 'Tool';
      const state = toolPart.state;

      if (state.status === 'running') {
        const title = state.title || toolName;
        session.accumulatedText += `\n\n**${title}** (running...)`;
      } else if (state.status === 'completed') {
        const title = state.title || toolName;
        const output = state.output ? state.output.slice(0, 200) : '';
        session.accumulatedText += `\n\n**${title}**: ${output}`;
      } else if (state.status === 'error') {
        session.accumulatedText += `\n\n**${toolName}** error: ${state.error}`;
      }
    } else if (part.type === 'step-finish') {
      const stepPart = part as any;
      // Track cost from step-finish events
      if (stepPart.cost) {
        // Cost info is available but we accumulate at session end
      }
    }

    // Stream update to Feishu card
    if (session.messageId && session.accumulatedText) {
      this.callbacks.onStreamUpdate(
        session.conversationId,
        session.messageId,
        session.accumulatedText,
        { backend: 'opencode', status: 'working' },
      );
    }
  }

  private handleSessionStatus(event: any): void {
    const { sessionID, status } = event.properties;
    const session = this.findSessionById(sessionID);
    if (!session) return;

    if (status.type === 'idle') {
      // Session finished processing
      if (session.accumulatedText && session.messageId) {
        const metadata: AIMetadata = { backend: 'opencode', status: 'done' };
        this.callbacks.onStreamEnd(
          session.conversationId,
          session.messageId,
          session.accumulatedText,
          metadata,
        );
      }
    }
    // 'busy' and 'retry' are transient — no special handling needed
  }

  private handleSessionError(event: any): void {
    const { sessionID, error } = event.properties;
    const session = sessionID ? this.findSessionById(sessionID) : undefined;
    if (!session) return;

    const errorMsg = error
      ? ('message' in error.data ? String(error.data.message) : error.name)
      : 'Unknown opencode error';

    this.callbacks.onError(session.conversationId, errorMsg);
  }

  private findSessionById(sessionId: string | undefined): SessionState | undefined {
    if (!sessionId) return undefined;
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session;
    }
    return undefined;
  }

  async selectMenuOption(conversationId: string, index: number): Promise<void> {
    // Opencode doesn't have numbered menus — send as text message
    await this.sendMessage(conversationId, String(index));
  }

  async interrupt(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session?.sessionId) {
      try {
        const client = await ensureServer();
        await client.session.abort({ path: { id: session.sessionId } });
      } catch (err) {
        console.warn('[OPENCODE-SDK] Failed to abort session:', err instanceof Error ? err.message : err);
      }
    }
  }

  async isAlive(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId);
    if (!session?.sessionId) return false;
    try {
      const client = await ensureServer();
      const result = await client.session.get({ path: { id: session.sessionId } });
      return !!(result.data);
    } catch {
      return false;
    }
  }

  async reconnect(conversationId: string, sessionId: string): Promise<boolean> {
    try {
      const client = await ensureServer();
      const result = await client.session.get({ path: { id: sessionId } });
      if (result.data) {
        this.sessions.set(conversationId, {
          conversationId,
          sessionId,
          accumulatedText: '',
        });
        console.log(`[OPENCODE-SDK] Reconnected session ${sessionId}`);
        if (!this.eventLoopRunning) this.startEventLoop(client);
        return true;
      }
    } catch {
      // Session doesn't exist on the server
    }
    return false;
  }

  async kill(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session?.sessionId) {
      try {
        const client = await ensureServer();
        await client.session.delete({ path: { id: session.sessionId } });
      } catch (err) {
        console.warn('[OPENCODE-SDK] Failed to delete session:', err instanceof Error ? err.message : err);
      }
    }
    this.sessions.delete(conversationId);
  }

  async killAll(): Promise<void> {
    for (const [convId] of this.sessions) {
      await this.kill(convId);
    }
    // Shut down the singleton server
    if (_server) {
      _server.close();
      _server = null;
      _client = null;
      this.eventLoopRunning = false;
      console.log('[OPENCODE-SDK] Server stopped');
    }
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  getSessionId(conversationId: string): string | undefined {
    return this.sessions.get(conversationId)?.sessionId;
  }
}

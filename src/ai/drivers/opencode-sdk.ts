import type { AISessionDriver } from '../types';
import type { AIManagerCallbacks, AIMetadata } from '../manager';
import { pendingRequests, modelOverrides } from '../../state';

// @opencode-ai/sdk is ESM-only. We use dynamic import() to load it from CJS.
// All SDK types are used structurally (duck-typed) to avoid compile-time ESM imports.
type OpencodeClient = any;

let _sdkModule: any = null;
async function loadSDK(): Promise<{ createOpencode: (opts?: any) => Promise<{ client: any; server: { url: string; close(): void } }> }> {
  if (!_sdkModule) {
    // Dynamic import of ESM-only module
    // Use Function constructor to preserve real ESM import() —
    // prevents TypeScript from compiling it into require() in CJS output.
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
  assistantMessageIds: Set<string>;
  lastTokens?: { input: number; output: number };
  lastCost?: number;
  cwd?: string;
  model?: string;
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
    console.log(`[OPENCODE-SDK] Session created: ${sessionId}`);

    const session: SessionState = {
      conversationId,
      sessionId,
      accumulatedText: '',
      assistantMessageIds: new Set(),
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
    session.assistantMessageIds.clear();

    // Build prompt body with optional model override
    const promptBody: any = {
      parts: [{ type: 'text' as const, text: message }],
      agent: 'build',
    };
    // Apply model override if set (format: "ProviderName/modelID")
    const modelOverride = modelOverrides.get(conversationId);
    if (modelOverride && modelOverride.includes('/')) {
      const slashIdx = modelOverride.indexOf('/');
      promptBody.model = {
        providerID: modelOverride.slice(0, slashIdx),
        modelID: modelOverride.slice(slashIdx + 1),
      };
    }

    // Send prompt asynchronously — returns immediately, events arrive via SSE
    await client.session.promptAsync({
      path: { id: session.sessionId },
      body: promptBody,
    });

    // Create the initial Feishu card
    session.messageId = await this.callbacks.onStreamStart(conversationId, { backend: 'opencode', sessionId: session.sessionId, status: 'thinking' });
  }

  private async startEventLoop(client: OpencodeClient): Promise<void> {
    this.eventLoopRunning = true;
    try {
      const result = await client.event.subscribe();
      const stream = (result as any)?.stream || result;

      for await (const rawEvent of stream) {
        const event = rawEvent as any;

        // Unwrap GlobalEvent wrapper if present
        let payload: any;
        if ('payload' in event && event.payload) {
          payload = event.payload;
        } else {
          payload = event;
        }

        const evtType = payload?.type;
        // Log interesting events
        if (evtType === 'question.asked' || evtType === 'permission.updated') {
          console.log(`[OPENCODE-SDK] Event ${evtType}:`, JSON.stringify(payload, null, 2)?.slice(0, 800));
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
      case 'message.updated':
        this.handleMessageUpdated(event);
        break;

      case 'message.part.updated':
        this.handlePartUpdated(event);
        break;

      case 'session.status':
        this.handleSessionStatus(event);
        break;

      case 'session.error':
        this.handleSessionError(event);
        break;

      case 'message.part.delta':
        this.handlePartDelta(event);
        break;

      case 'permission.updated':
        this.handlePermission(event);
        break;

      case 'question.asked':
        this.handleQuestionAsked(event);
        break;

      default:
        break;
    }
  }

  private handleMessageUpdated(event: any): void {
    const { info } = event.properties;
    const sessionID = event.properties.sessionID || info?.sessionID;
    const session = this.findSessionById(sessionID);
    if (!session) return;

    // Track assistant message IDs so we can filter out user message parts
    if (info?.role === 'assistant' && info?.id) {
      session.assistantMessageIds.add(info.id);
      // Extract metadata from assistant message
      if (info.tokens) {
        session.lastTokens = {
          input: info.tokens.input || 0,
          output: info.tokens.output || 0,
        };
      }
      if (info.cost !== undefined) {
        session.lastCost = info.cost;
      }
      if (info.path?.cwd) {
        session.cwd = info.path.cwd;
      }
      if (info.modelID) {
        session.model = `${info.providerID || ''}/${info.modelID}`;
      }
    }
  }

  private handlePartDelta(event: any): void {
    const { sessionID, delta } = event.properties || {};
    if (!delta || !sessionID) return;
    const session = this.findSessionById(sessionID);
    if (!session) return;

    // Append text delta
    session.accumulatedText += delta;

    // Stream update
    if (session.messageId && session.accumulatedText) {
      this.callbacks.onStreamUpdate(
        session.conversationId,
        session.messageId,
        session.accumulatedText,
        {
          backend: 'opencode',
          sessionId: session.sessionId,
          model: session.model,
          cwd: session.cwd,
          status: 'working',
        },
      );
    }
  }

  private handleQuestionAsked(event: any): void {
    const props = event.properties || {};
    const sessionID = props.sessionID;
    const session = sessionID ? this.findSessionById(sessionID) : undefined;
    if (!session) return;

    // Build question card from the event
    const question = props.question || props.title || 'opencode has a question';
    const options = (props.options || []) as Array<{ label: string; value?: string; description?: string }>;

    const menuOptions = options.map((opt: any, i: number) => ({
      label: `${opt.label || opt.value || opt}${opt.description ? ' — ' + opt.description : ''}`,
      index: i,
      selected: false,
    }));

    if (menuOptions.length > 0) {
      this.callbacks.onMenu(session.conversationId, {
        title: question,
        options: menuOptions,
        hint: '',
      });
    } else {
      // No structured options — show as text in the stream
      session.accumulatedText += `\n\n**Question:** ${question}`;
      if (session.messageId) {
        this.callbacks.onStreamUpdate(
          session.conversationId,
          session.messageId,
          session.accumulatedText,
          { backend: 'opencode', sessionId: session.sessionId, status: 'working' },
        );
      }
    }
  }

  private handlePartUpdated(event: any): void {
    const { part, delta } = event.properties;
    const sessionID = event.properties.sessionID || part.sessionID;
    const session = this.findSessionById(sessionID);
    if (!session) return;

    // Only process parts from assistant messages (skip user echo)
    const messageID = part.messageID;
    if (messageID && !session.assistantMessageIds.has(messageID)) return;

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
        {
          backend: 'opencode',
          sessionId: session.sessionId,
          model: session.model,
          cwd: session.cwd,
          inputTokens: session.lastTokens?.input,
          outputTokens: session.lastTokens?.output,
          costUsd: session.lastCost,
          status: 'working',
        },
      );
    }
  }

  private async handleSessionStatus(event: any): Promise<void> {
    const { sessionID, status } = event.properties;
    const session = this.findSessionById(sessionID);
    if (!session) return;

    if (status.type === 'idle') {
      // Fetch final message details for tokens/cost
      try {
        const client = await ensureServer();
        const msgs = await client.session.messages({ path: { id: session.sessionId! } });
        const messagesData = (msgs.data || []) as any[];
        // Find last assistant message
        for (let i = messagesData.length - 1; i >= 0; i--) {
          const msg = messagesData[i]?.info;
          if (msg?.role === 'assistant') {
            if (msg.tokens) {
              session.lastTokens = { input: msg.tokens.input || 0, output: msg.tokens.output || 0 };
            }
            if (msg.cost !== undefined) session.lastCost = msg.cost;
            if (msg.path?.cwd) session.cwd = msg.path.cwd;
            if (msg.modelID) session.model = `${msg.providerID || ''}/${msg.modelID}`;
            break;
          }
        }
      } catch (err) {
        console.warn('[OPENCODE-SDK] Failed to fetch final message details:', err instanceof Error ? err.message : err);
      }
      if (session.accumulatedText && session.messageId) {
        const metadata: AIMetadata = {
          backend: 'opencode',
          sessionId: session.sessionId,
          model: session.model,
          cwd: session.cwd,
          inputTokens: session.lastTokens?.input,
          outputTokens: session.lastTokens?.output,
          costUsd: session.lastCost,
          status: 'done',
        };
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

  private handlePermission(event: any): void {
    const permission = event.properties;
    const session = this.findSessionById(permission.sessionID);
    if (!session) return;

    const permissionId = permission.id;
    const title = permission.title || permission.type || 'Permission request';

    // Build description from metadata
    let description = `**${permission.type}**`;
    if (permission.pattern) {
      const patterns = Array.isArray(permission.pattern) ? permission.pattern : [permission.pattern];
      description += `\n${patterns.join(', ')}`;
    }

    // Store pending request
    const requestId = `oc-perm-${permissionId}`;
    const timer = setTimeout(() => {
      // Auto-reject after 5 minutes
      pendingRequests.delete(requestId);
      this.respondToPermission(session.sessionId!, permissionId, 'reject');
    }, 5 * 60 * 1000);

    pendingRequests.set(requestId, {
      type: 'permission',
      resolve: (result: any) => {
        clearTimeout(timer);
        const response = result.behavior === 'allow'
          ? (result.updatedPermissions?.length ? 'always' : 'once')
          : 'reject';
        this.respondToPermission(session.sessionId!, permissionId, response);
      },
      conversationId: session.conversationId,
      timer,
    });

    // Send permission card via menu callback
    this.callbacks.onMenu(session.conversationId, {
      title,
      options: [
        { label: 'Allow', index: 0, selected: false },
        { label: 'Deny', index: 1, selected: false },
        { label: 'Allow Always', index: 2, selected: false },
      ],
      hint: description,
    });
  }

  private async respondToPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    try {
      const client = await ensureServer();
      await (client as any).postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response },
      });
    } catch (err) {
      console.warn('[OPENCODE-SDK] Failed to respond to permission:', err instanceof Error ? err.message : err);
    }
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
          assistantMessageIds: new Set(),
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

import { getFeishuBot } from '../bot/feishu';
import { getSessionManager, SessionInfo } from '../terminal/session';
import { AIManager, AIManagerCallbacks } from '../ai/manager';
import { ClaudeSDKDriver } from '../ai/drivers/claude-sdk';
import { OpencodeSDKDriver } from '../ai/drivers/opencode-sdk';
import { activeSessions, smartCard } from '../state';
import { resolvePendingInput } from '../ai/shared';

// ── Shared AI callbacks ──

const aiCallbacks: AIManagerCallbacks = {
  onStreamStart: async (conversationId, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard('thinking...', metadata);
    return await feishuBot.sendCard(conversationId, card);
  },

  onStreamUpdate: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(err => console.warn('[CARD] Failed to update card on stream update:', err.message || err));
  },

  onStreamEnd: (conversationId, messageId, content, metadata) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(content, metadata);
    feishuBot.updateCard(messageId, card).catch(err => console.warn('[CARD] Failed to update card on stream end:', err.message || err));

    // Persist SDK session ID if available (Claude init event sets it during stream)
    if (metadata?.sessionId) {
      const activeSessionId = activeSessions.get(conversationId);
      if (activeSessionId !== undefined) {
        const sessionManager = getSessionManager();
        const session = sessionManager.getSession(activeSessionId);
        if (session && !session.sdkSessionId) {
          sessionManager.updateSdkSessionId(activeSessionId, metadata.sessionId);
        }
      }
    }
  },

  onMenu: async (conversationId, menu) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildMenuCard(menu.title, menu.options, menu.hint);
    await feishuBot.sendCard(conversationId, card);
  },

  onError: async (conversationId, error) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildErrorCard(error);
    await feishuBot.sendCard(conversationId, card);
  },
};

// ── Lazy singleton managers ──

let _claudeManager: AIManager | null = null;
export function getClaudeManager(): AIManager {
  if (!_claudeManager) {
    const driver = new ClaudeSDKDriver(aiCallbacks);
    _claudeManager = new AIManager(aiCallbacks, driver);
  }
  return _claudeManager;
}

let _opencodeManager: AIManager | null = null;
export function getOpencodeManager(): AIManager {
  if (!_opencodeManager) {
    const driver = new OpencodeSDKDriver(aiCallbacks);
    _opencodeManager = new AIManager(aiCallbacks, driver);
  }
  return _opencodeManager;
}

// ── Shared AI command handler ──

type AIBackendType = 'claude' | 'opencode';

/**
 * Find or create an AI session for the given conversation and backend.
 * Handles session lookup, reconnection, and creation.
 *
 * When a new session must be started asynchronously, `firstPrompt` is
 * sent automatically after the session is ready and `ready` is false.
 * The caller should return without sending the message itself.
 */
async function ensureAISession(
  conversationId: string,
  backend: AIBackendType,
  firstPrompt: string,
): Promise<{ manager: AIManager; session: SessionInfo; ready: boolean }> {
  const sessionManager = getSessionManager();
  const manager = backend === 'opencode' ? getOpencodeManager() : getClaudeManager();
  const label = backend === 'opencode' ? 'opencode' : 'Claude';
  const feishuBot = getFeishuBot();

  const activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  // If active session is a different type, look for an existing session of the right type
  if (!session || session.type !== backend) {
    const existing = sessionManager.getSessions().find(
      s => s.type === backend && s.conversationId === conversationId,
    );
    if (existing) {
      session = existing;
      activeSessions.set(conversationId, session.id);
    }
  }

  // Create new session if needed
  if (!session || session.type !== backend) {
    session = backend === 'opencode'
      ? sessionManager.createOpencodeSession(conversationId)
      : sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);

    feishuBot.sendText(conversationId, `Starting ${label} session...`).catch(err => console.warn('[FEISHU] Failed to send start notification:', err.message || err));
    manager.startSession(conversationId, `${backend}-${session.id}`).then(() => {
      const sdkSessionId = manager.getSessionId(conversationId);
      if (sdkSessionId) {
        sessionManager.updateSdkSessionId(session!.id, sdkSessionId);
      }
      manager.sendMessage(conversationId, firstPrompt).catch(err => {
        console.error(`Failed to send message to ${label}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to start ${label} session:`, err);
      feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send error card:', err2.message || err2));
    });
    return { manager, session, ready: false };
  }

  // Update activity timestamp
  sessionManager.updateLastActivity(session.id);

  // Check if session is still alive
  const alive = await manager.isSessionAlive(conversationId);
  const logPrefix = backend === 'opencode' ? '[OPENCODE]' : '[CLAUDE]';
  console.log(`${logPrefix} session alive=${alive}, sdkSessionId=${session.sdkSessionId || 'none'}`);

  if (!alive) {
    if (session.sdkSessionId) {
      console.log(`${logPrefix} Resuming session ${session.sdkSessionId}`);
      feishuBot.sendText(conversationId, `Resuming ${label} session...`).catch(err => console.warn('[FEISHU] Failed to send resume notification:', err.message || err));
      await manager.reconnectSession(conversationId, session.sdkSessionId);
      return { manager, session, ready: true };
    }

    // Reuse existing session record — start a new SDK session but keep the same session ID
    feishuBot.sendText(conversationId, `Starting new ${label} session...`).catch(err => console.warn('[FEISHU] Failed to send restart notification:', err.message || err));
    manager.startSession(conversationId, `${backend}-${session.id}`).then(() => {
      const sdkSessionId = manager.getSessionId(conversationId);
      if (sdkSessionId) {
        sessionManager.updateSdkSessionId(session!.id, sdkSessionId);
      }
      manager.sendMessage(conversationId, firstPrompt).catch(err => {
        console.error(`Failed to send message to ${label}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to start ${label} session:`, err);
    });
    return { manager, session, ready: false };
  }

  return { manager, session, ready: true };
}

async function handleAICommand(
  conversationId: string,
  prompt: string,
  backend: AIBackendType
): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!prompt) {
    await feishuBot.sendText(conversationId, `Usage: !${backend} <prompt> or just send a message`);
    return;
  }

  // Check for pending permission/question responses
  if (resolvePendingInput(conversationId, prompt)) {
    return;
  }

  // ensureAISession sends firstPrompt automatically when starting a new session
  const { manager, ready } = await ensureAISession(conversationId, backend, prompt);

  if (!ready) {
    // New session starting asynchronously — prompt will be sent after start completes
    return;
  }

  // Existing session — check if this is a menu selection (single number)
  const num = parseInt(prompt, 10);
  const logPrefix = backend === 'opencode' ? '[OPENCODE]' : '[CLAUDE]';
  if (!isNaN(num) && prompt.trim() === String(num)) {
    console.log(`${logPrefix} selectMenuOption(${num})`);
    manager.selectMenuOption(conversationId, num).catch(err => {
      console.error('Failed to select menu option:', err);
    });
  } else {
    manager.sendMessage(conversationId, prompt).catch(err => {
      console.error(`Failed to send message to ${backend}:`, err);
    });
  }
}

// ── Public command handlers ──

export async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
  return handleAICommand(conversationId, prompt, 'claude');
}

export async function handleOpencodeCommand(conversationId: string, prompt: string): Promise<void> {
  return handleAICommand(conversationId, prompt, 'opencode');
}

export async function handleCd(conversationId: string, dir: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!dir) {
    await feishuBot.sendText(conversationId, 'Usage: !cd <path>\nExample: !cd ~/workspace/my-project');
    return;
  }

  const sessionManager = getSessionManager();

  // Detect current backend from active session type
  let backend: AIBackendType = 'claude';
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const currentSession = sessionManager.getSession(activeSessionId);
    if (currentSession?.type === 'opencode') {
      backend = 'opencode';
    }
  }

  const manager = backend === 'opencode' ? getOpencodeManager() : getClaudeManager();

  // If there's an active AI session, send cd command within it (preserves context)
  if (activeSessionId !== undefined) {
    const session = sessionManager.getSession(activeSessionId);
    if ((session?.type === 'claude' || session?.type === 'opencode') && await manager.isSessionAlive(conversationId)) {
      manager.sendMessage(conversationId, `Please change your working directory to ${dir} using the Bash tool: cd ${dir} && pwd`).catch(err => {
        console.error('Failed to send cd message:', err);
      });
      return;
    }
  }

  // No active session — create new session in the specified directory
  const session = backend === 'opencode'
    ? sessionManager.createOpencodeSession(conversationId)
    : sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  const label = backend === 'opencode' ? 'opencode' : 'Claude';
  feishuBot.sendText(conversationId, `Starting ${label} in ${dir} ...`).catch(err => console.warn('[FEISHU] Failed to send cd notification:', err.message || err));
  manager.startSession(conversationId, `${backend}-${session.id}`, dir).then(() => {
    const sdkSessionId = manager.getSessionId(conversationId);
    if (sdkSessionId) {
      sessionManager.updateSdkSessionId(session.id, sdkSessionId);
    }
  }).catch(err => {
    console.error(`Failed to start ${label} in dir:`, err);
    feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send cd error card:', err2.message || err2));
  });
}

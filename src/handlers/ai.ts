import { getFeishuBot } from '../bot/feishu';
import { getSessionManager, SessionInfo } from '../terminal/session';
import { AIManager, AIManagerCallbacks } from '../ai/manager';
import { CLAUDE_BACKEND, OPENCODE_BACKEND } from '../ai/backend';
import { activeSessions, smartCard } from '../state';

// ── Shared AI callbacks ──

const aiCallbacks: AIManagerCallbacks = {
  onStreamStart: async (conversationId) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard('thinking...');
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
    _claudeManager = new AIManager(aiCallbacks, CLAUDE_BACKEND);
  }
  return _claudeManager;
}

let _opencodeManager: AIManager | null = null;
export function getOpencodeManager(): AIManager {
  if (!_opencodeManager) {
    _opencodeManager = new AIManager(aiCallbacks, OPENCODE_BACKEND);
  }
  return _opencodeManager;
}

// ── Shared AI command handler ──

type AIBackendType = 'claude' | 'opencode';

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

  const sessionManager = getSessionManager();
  const manager = backend === 'opencode' ? getOpencodeManager() : getClaudeManager();

  // Find or create a session for this backend
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  // Create new tmux session if needed (fire-and-forget -- don't block Feishu handler)
  if (!session || session.type !== backend) {
    session = backend === 'opencode'
      ? sessionManager.createOpencodeSession(conversationId)
      : sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);

    const tmuxName = `${backend}-${session.id}`;
    session.tmuxName = tmuxName;
    sessionManager.updateClaudeSessionId(session.id, tmuxName);

    // Non-blocking: start session in background, send message when ready
    const label = backend === 'opencode' ? 'opencode' : 'Claude';
    feishuBot.sendText(conversationId, `Starting ${label} session...`).catch(err => console.warn('[FEISHU] Failed to send start notification:', err.message || err));
    manager.startSession(conversationId, tmuxName).then(() => {
      manager.sendMessage(conversationId, prompt).catch(err => {
        console.error(`Failed to send message to ${label}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to start ${label} session:`, err);
      feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send error card:', err2.message || err2));
    });
    return;
  }

  // Update activity timestamp
  sessionManager.updateLastActivity(session.id);

  // Check if tmux session is still alive
  const alive = await manager.isSessionAlive(conversationId);
  const logPrefix = backend === 'opencode' ? '[OPENCODE]' : '[CLAUDE]';
  console.log(`${logPrefix} session alive=${alive}, prompt="${prompt.slice(0, 20)}"`);
  if (!alive) {
    const tmuxName = `${backend}-${session.id}-${Date.now()}`;
    const label = backend === 'opencode' ? 'opencode' : 'Claude';
    feishuBot.sendText(conversationId, `Restarting ${label} session...`).catch(err => console.warn('[FEISHU] Failed to send restart notification:', err.message || err));
    manager.startSession(conversationId, tmuxName).then(() => {
      manager.sendMessage(conversationId, prompt).catch(err => {
        console.error(`Failed to send message to ${label}:`, err);
      });
    }).catch(err => {
      console.error(`Failed to restart ${label} session:`, err);
    });
    return;
  }

  // Existing session -- check if this is a menu selection (single number)
  const num = parseInt(prompt, 10);
  if (!isNaN(num) && prompt.trim() === String(num)) {
    console.log(`${logPrefix} selectMenuOption(${num})`);
    manager.selectMenuOption(conversationId, num).catch(err => {
      console.error('Failed to select menu option:', err);
    });
  } else {
    // Regular message
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

  // Kill current AI session if exists
  if (activeSessionId !== undefined) {
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'claude' || session?.type === 'opencode') {
      await manager.killSession(conversationId);
      await sessionManager.killSession(activeSessionId);
    }
  }

  // Create new session in the specified directory
  const session = backend === 'opencode'
    ? sessionManager.createOpencodeSession(conversationId)
    : sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  const tmuxName = `${backend}-${session.id}`;
  session.tmuxName = tmuxName;
  sessionManager.updateClaudeSessionId(session.id, tmuxName);

  const label = backend === 'opencode' ? 'opencode' : 'Claude';
  feishuBot.sendText(conversationId, `Switching to ${dir} ...`).catch(err => console.warn('[FEISHU] Failed to send cd notification:', err.message || err));
  manager.startSession(conversationId, tmuxName, dir).catch(err => {
    console.error(`Failed to start ${label} in dir:`, err);
    feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send cd error card:', err2.message || err2));
  });
}

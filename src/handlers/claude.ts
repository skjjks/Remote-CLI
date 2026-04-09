import { getFeishuBot } from '../bot/feishu';
import { getSessionManager, SessionInfo } from '../terminal/session';
import { ClaudeManager, ClaudeManagerCallbacks } from '../claude/manager';
import { activeSessions, smartCard } from '../state';

// ── Claude callbacks ──

const claudeCallbacks: ClaudeManagerCallbacks = {
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

// ── Lazy managers ──

let _claudeManager: ClaudeManager | null = null;
export function getClaudeManager(): ClaudeManager {
  if (!_claudeManager) {
    _claudeManager = new ClaudeManager(claudeCallbacks);
  }
  return _claudeManager;
}

// ── Claude command handlers ──

export async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!prompt) {
    await feishuBot.sendText(conversationId, 'Usage: !claude <prompt> or just send a message');
    return;
  }

  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  // Find or create a Claude session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  // Create new Claude tmux session if needed (fire-and-forget — don't block Feishu handler)
  if (!session || session.type !== 'claude') {
    session = sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);

    const tmuxName = `claude-${session.id}`;
    session.tmuxName = tmuxName;
    sessionManager.updateClaudeSessionId(session.id, tmuxName);

    // Non-blocking: start session in background, send message when ready
    feishuBot.sendText(conversationId, 'Starting Claude session...').catch(err => console.warn('[FEISHU] Failed to send start notification:', err.message || err));
    claudeManager.startSession(conversationId, tmuxName).then(() => {
      claudeManager.sendMessage(conversationId, prompt).catch(err => {
        console.error('Failed to send message to Claude:', err);
      });
    }).catch(err => {
      console.error('Failed to start Claude session:', err);
      feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send error card:', err2.message || err2));
    });
    return;
  }

  // Update activity timestamp
  sessionManager.updateLastActivity(session.id);

  // Check if tmux session is still alive
  const alive = await claudeManager.isSessionAlive(conversationId);
  console.log(`[CLAUDE] session alive=${alive}, prompt="${prompt.slice(0, 20)}"`);
  if (!alive) {
    const tmuxName = `claude-${session.id}-${Date.now()}`;
    feishuBot.sendText(conversationId, 'Restarting Claude session...').catch(err => console.warn('[FEISHU] Failed to send restart notification:', err.message || err));
    claudeManager.startSession(conversationId, tmuxName).then(() => {
      claudeManager.sendMessage(conversationId, prompt).catch(err => {
        console.error('Failed to send message to Claude:', err);
      });
    }).catch(err => {
      console.error('Failed to restart Claude session:', err);
    });
    return;
  }

  // Existing session — check if this is a menu selection (single number)
  const num = parseInt(prompt, 10);
  if (!isNaN(num) && prompt.trim() === String(num)) {
    console.log(`[CLAUDE] selectMenuOption(${num})`);
    claudeManager.selectMenuOption(conversationId, num).catch(err => {
      console.error('Failed to select menu option:', err);
    });
  } else {
    // Regular message
    claudeManager.sendMessage(conversationId, prompt).catch(err => {
      console.error('Failed to send message to Claude:', err);
    });
  }
}

export async function handleCd(conversationId: string, dir: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!dir) {
    await feishuBot.sendText(conversationId, 'Usage: !cd <path>\nExample: !cd ~/workspace/my-project');
    return;
  }

  const sessionManager = getSessionManager();
  const claudeManager = getClaudeManager();

  // Kill current Claude session if exists
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'claude') {
      await claudeManager.killSession(conversationId);
      await sessionManager.killSession(activeSessionId);
    }
  }

  // Create new Claude session in the specified directory
  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  const tmuxName = `claude-${session.id}`;
  session.tmuxName = tmuxName;
  sessionManager.updateClaudeSessionId(session.id, tmuxName);

  feishuBot.sendText(conversationId, `Switching to ${dir} ...`).catch(err => console.warn('[FEISHU] Failed to send cd notification:', err.message || err));
  claudeManager.startSession(conversationId, tmuxName, dir).catch(err => {
    console.error('Failed to start Claude in dir:', err);
    feishuBot.sendCard(conversationId, smartCard.buildErrorCard(String(err))).catch(err2 => console.warn('[FEISHU] Failed to send cd error card:', err2.message || err2));
  });
}

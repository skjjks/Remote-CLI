import { getFeishuBot } from '../bot/feishu';
import { getSessionManager } from '../terminal/session';
import * as tmux from '../terminal/tmux';
import { activeSessions, commandHistory, modelOverrides } from '../state';
import { getClaudeManager, getOpencodeManager } from './ai';

// ── Session management handlers ──

export async function handleNewSession(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  await feishuBot.sendText(conversationId, `Created Claude session ${session.id}`);
}

export async function handleListSessions(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();
  const sessions = sessionManager.getSessions();

  if (sessions.length === 0) {
    await feishuBot.sendText(conversationId, 'No active sessions');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  const lines = sessions.map(s => {
    const active = s.id === activeSessionId ? ' *' : '';
    return `  ${s.id}: [${s.type}] created ${s.created}${active}`;
  });

  await feishuBot.sendText(conversationId, `Sessions:\n${lines.join('\n')}`);
}

export async function handleSwitchSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !switch <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // For terminal sessions, verify tmux session still exists
  if (session.type === 'terminal' && session.tmuxName) {
    const exists = await tmux.sessionExists(session.tmuxName);
    if (!exists) {
      await feishuBot.sendText(conversationId, `Session ${sessionId} no longer exists`);
      return;
    }
  }

  activeSessions.set(conversationId, sessionId);
  await feishuBot.sendText(conversationId, `Switched to ${session.type} session ${sessionId}`);
}

export async function handleKillSession(conversationId: string, idStr?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!idStr) {
    await feishuBot.sendText(conversationId, 'Usage: !kill <session_id>');
    return;
  }

  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId)) {
    await feishuBot.sendText(conversationId, 'Invalid session ID');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    await feishuBot.sendText(conversationId, `Session ${sessionId} not found`);
    return;
  }

  // Kill the appropriate process
  if (session.type === 'terminal' && session.tmuxName) {
    try { await tmux.killSession(session.tmuxName); } catch (err) { console.warn('[SESSION] Failed to kill tmux session:', err instanceof Error ? err.message : err); }
  } else if (session.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.killSession(conversationId);
  } else if (session.type === 'opencode') {
    const opencodeManager = getOpencodeManager();
    await opencodeManager.killSession(conversationId);
  }

  await sessionManager.killSession(sessionId);

  if (activeSessions.get(conversationId) === sessionId) {
    activeSessions.delete(conversationId);
  }

  await feishuBot.sendText(conversationId, `Killed ${session.type} session ${sessionId}`);
}

export async function handleInterrupt(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const activeSessionId = activeSessions.get(conversationId);

  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);

  if (session?.type === 'claude') {
    const claudeManager = getClaudeManager();
    await claudeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Claude interrupted');
  } else if (session?.type === 'opencode') {
    const opencodeManager = getOpencodeManager();
    await opencodeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Opencode interrupted');
  } else if (session?.type === 'terminal' && session.tmuxName) {
    await tmux.sendKeys(session.tmuxName, 'C-c');
    await feishuBot.sendText(conversationId, 'Sent Ctrl-C');
  }
}

export async function handleModeSwitch(conversationId: string, mode?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (mode !== 'auto' && mode !== 'default') {
    await feishuBot.sendText(conversationId, 'Usage: !mode auto|default');
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    sessionManager.updatePermissionMode(activeSessionId, mode);
  }

  await feishuBot.sendText(conversationId, `Permission mode set to: ${mode}`);
}

export async function handleHistory(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const history = commandHistory.get(conversationId);

  if (!history || history.length === 0) {
    await feishuBot.sendText(conversationId, 'No command history');
    return;
  }

  const lines = history.map((cmd, i) => `  ${i + 1}. ${cmd}`);
  await feishuBot.sendText(conversationId, `Command history:\n${lines.join('\n')}`);
}

// Common model shortcuts
const MODEL_SHORTCUTS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  'sonnet-4': 'claude-sonnet-4-6',
  'opus-4': 'claude-opus-4-6',
  'opus-fast': 'claude-opus-4-6-fast',
};

// Popular models to show in the list (curated from full model list)
const POPULAR_MODELS = [
  { shortcut: 'opus', model: 'claude-opus-4-6', desc: 'Most capable' },
  { shortcut: 'opus-fast', model: 'claude-opus-4-6-fast', desc: 'Opus fast mode' },
  { shortcut: 'sonnet', model: 'claude-sonnet-4-6', desc: 'Balanced' },
  { shortcut: 'haiku', model: 'claude-haiku-4-5-20251001', desc: 'Fast & cheap' },
];

export async function handleModel(conversationId: string, model?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!model || model === 'list') {
    const current = modelOverrides.get(conversationId);
    const lines = [
      current ? `Current: **${current}**` : 'Current: default (no override)',
      '',
      '**Quick switch:**',
      ...POPULAR_MODELS.map(m => `  \`!model ${m.shortcut}\` → ${m.model} (${m.desc})`),
      '',
      'Or use full name: `!model claude-sonnet-4-5`',
      'For opencode: `!model anthropic/claude-sonnet-4-6`',
      '',
      '`!model reset` to clear override',
    ];
    await feishuBot.sendText(conversationId, lines.join('\n'));
    return;
  }

  if (model === 'reset' || model === 'clear') {
    modelOverrides.delete(conversationId);
    await feishuBot.sendText(conversationId, 'Model override cleared. Using default model.');
    return;
  }

  const resolved = MODEL_SHORTCUTS[model.toLowerCase()] || model;
  modelOverrides.set(conversationId, resolved);
  await feishuBot.sendText(conversationId, `Model set to: **${resolved}**\nNext message will use this model.`);
}

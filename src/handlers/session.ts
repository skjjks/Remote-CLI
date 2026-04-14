import { getFeishuBot } from '../bot/feishu';
import { getSessionManager } from '../terminal/session';
import * as tmux from '../terminal/tmux';
import { activeSessions, commandHistory, modelOverrides } from '../state';
import { getClaudeManager, getOpencodeManager } from './ai';
import { getModelShortcuts, resolveModel, getPopularModels } from '../ai/models';

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
    const sid = (s.type === 'claude' || s.type === 'opencode') && s.sdkSessionId
      ? ` (${s.sdkSessionId})`
      : '';
    return `  ${s.id}: [${s.type}]${sid} created ${s.created}${active}`;
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

export async function handleKillSession(conversationId: string, args: string[]): Promise<void> {
  const feishuBot = getFeishuBot();

  if (args.length === 0) {
    await feishuBot.sendText(conversationId, 'Usage: !kill <id> [id2 id3...] or !kill all');
    return;
  }

  const sessionManager = getSessionManager();

  // Handle "!kill all"
  if (args[0] === 'all') {
    const sessions = sessionManager.getSessions();
    const count = sessions.length;
    for (const s of sessions) {
      await killSingleSession(conversationId, s.id, sessionManager);
    }
    await feishuBot.sendText(conversationId, `Killed all ${count} sessions`);
    return;
  }

  // Kill multiple IDs: !kill 1 2 3
  const killed: string[] = [];
  for (const idStr of args) {
    const sessionId = parseInt(idStr, 10);
    if (isNaN(sessionId)) {
      killed.push(`${idStr}: invalid ID`);
      continue;
    }
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      killed.push(`${sessionId}: not found`);
      continue;
    }
    await killSingleSession(conversationId, sessionId, sessionManager);
    killed.push(`${sessionId}: killed (${session.type})`);
  }

  await feishuBot.sendText(conversationId, killed.join('\n'));
}

async function killSingleSession(conversationId: string, sessionId: number, sessionManager: ReturnType<typeof getSessionManager>): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  if (!session) return;

  if ((session.type === 'terminal' || session.type === 'clouddev') && session.tmuxName) {
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
  } else if ((session?.type === 'terminal' || session?.type === 'clouddev') && session?.tmuxName) {
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

export async function handleModel(conversationId: string, model?: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  // Detect current backend
  const activeSessionId = activeSessions.get(conversationId);
  const session = activeSessionId !== undefined ? sessionManager.getSession(activeSessionId) : undefined;
  const isOpencode = session?.type === 'opencode';

  if (!model || model === 'list') {
    const current = modelOverrides.get(conversationId);
    const lines: string[] = [
      current ? `Current: **${current}**` : 'Current: default (no override)',
      '',
    ];

    const label = isOpencode ? 'Opencode' : 'Claude';
    lines.push(`**${label} models:**`);
    for (const m of getPopularModels(isOpencode ? 'opencode' : 'claude')) {
      const suffix = m.desc ? ` (${m.desc})` : '';
      lines.push(`  \`!model ${m.shortcut}\` → ${m.model}${suffix}`);
    }

    lines.push('', 'Or use full model name directly', '`!model reset` to clear override');
    await feishuBot.sendText(conversationId, lines.join('\n'));
    return;
  }

  if (model === 'reset' || model === 'clear') {
    modelOverrides.delete(conversationId);
    await feishuBot.sendText(conversationId, 'Model override cleared. Using default model.');
    return;
  }

  // Resolve shortcuts based on backend
  const backend = isOpencode ? 'opencode' as const : 'claude' as const;
  const resolved = resolveModel(backend, model);
  modelOverrides.set(conversationId, resolved);
  await feishuBot.sendText(conversationId, `Model set to: **${resolved}**\nNext message will use this model.`);
}

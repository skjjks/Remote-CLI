import { getFeishuBot } from '../bot/feishu';
import { getSessionManager } from '../terminal/session';
import * as tmux from '../terminal/tmux';
import {
  isMoreOptionsValue,
  isPermitAction,
  isMenuAction,
  getMenuIndex,
  PERMIT_ALLOW,
  PERMIT_DENY,
  PERMIT_ALWAYS,
} from '../bot/card';
import { activeSessions, pendingPrompts } from '../state';
import { getClaudeManager } from './claude';

// ── Card action handlers ──

export async function handleCardAction(
  conversationId: string,
  senderId: string,
  value: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!feishuBot.isUserAllowed(senderId)) return;

  // Handle menu selection (Claude interactive menus)
  if (isMenuAction(value)) {
    const claudeManager = getClaudeManager();
    const menuIndex = getMenuIndex(value);
    if (menuIndex >= 0) {
      await claudeManager.selectMenuOption(conversationId, menuIndex);
    }
    return;
  }

  // Handle permission card actions
  if (isPermitAction(value)) {
    await handlePermitAction(conversationId, value);
    return;
  }

  // Handle "More options..." button (Terminal mode)
  if (isMoreOptionsValue(value)) {
    const pendingPrompt = pendingPrompts.get(conversationId);
    if (pendingPrompt && pendingPrompt.options.length > 4) {
      const remainingOptions = pendingPrompt.options.slice(4);
      const lines = remainingOptions.map((opt: any, i: number) => `${i + 4}. ${opt.label}`);
      await feishuBot.sendText(conversationId, `More options:\n${lines.join('\n')}\nType the number to select.`);
    }
    return;
  }

  // Send the value to the active terminal session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);
    if (session?.type === 'terminal' && session.tmuxName) {
      await tmux.sendKeys(session.tmuxName, value);
      await tmux.sendKeys(session.tmuxName, 'Enter');
      pendingPrompts.delete(conversationId);
    }
  }
}

export async function handlePermitAction(conversationId: string, value: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) return;

  const session = sessionManager.getSession(activeSessionId);
  if (!session || session.type !== 'claude') return;

  if (value === PERMIT_DENY) {
    await feishuBot.sendText(conversationId, 'Permission denied. Claude will skip this action.');
    return;
  }

  if (value === PERMIT_ALLOW || value === PERMIT_ALWAYS) {
    if (value === PERMIT_ALWAYS) {
      const tools = session.allowedTools || [];
      sessionManager.updateAllowedTools(activeSessionId, tools);
    }

    await feishuBot.sendText(conversationId, 'Permission granted. Please resend your request.');
  }
}

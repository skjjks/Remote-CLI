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
import { activeSessions, pendingPrompts, pendingRequests } from '../state';
import { getClaudeManager } from './ai';

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
    const menuIndex = getMenuIndex(value);

    // Check if this resolves a pending elicitation (question) request
    const pendingKey = [...pendingRequests.keys()].find(k => {
      const req = pendingRequests.get(k);
      return req?.conversationId === conversationId && req.type === 'question';
    });

    if (pendingKey) {
      const pending = pendingRequests.get(pendingKey)!;
      pendingRequests.delete(pendingKey);

      if (menuIndex === 0) {
        pending.resolve({ action: 'accept' });
      } else {
        pending.resolve({ action: 'decline' });
      }
      return;
    }

    // Also check for pending permission requests (when menu card is used for permissions)
    const pendingPermKey = [...pendingRequests.keys()].find(k => {
      const req = pendingRequests.get(k);
      return req?.conversationId === conversationId && req.type === 'permission';
    });

    if (pendingPermKey) {
      const pending = pendingRequests.get(pendingPermKey)!;
      pendingRequests.delete(pendingPermKey);

      if (menuIndex === 0) {
        pending.resolve({ behavior: 'allow' });
      } else if (menuIndex === 2) {
        pending.resolve({ behavior: 'allow', updatedPermissions: [] });
      } else {
        pending.resolve({ behavior: 'deny', message: 'User denied permission' });
      }
      return;
    }

    // No pending request — forward as regular menu selection
    const claudeManager = getClaudeManager();
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
      const lines = remainingOptions.map((opt, i) => `${i + 4}. ${opt.label}`);
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

  // Try to resolve a pending SDK permission request first
  const pendingKey = [...pendingRequests.keys()].find(k => {
    const req = pendingRequests.get(k);
    return req?.conversationId === conversationId && req.type === 'permission';
  });

  if (pendingKey) {
    const pending = pendingRequests.get(pendingKey)!;
    pendingRequests.delete(pendingKey);

    if (value === PERMIT_DENY) {
      pending.resolve({ behavior: 'deny', message: 'User denied permission' });
      return;
    }
    if (value === PERMIT_ALWAYS) {
      pending.resolve({ behavior: 'allow', updatedPermissions: [] });
      return;
    }
    // PERMIT_ALLOW
    pending.resolve({ behavior: 'allow' });
    return;
  }

  // Fallback: legacy terminal-mode permission handling
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

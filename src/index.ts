import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from './config';
import { getFeishuBot } from './bot/feishu';
import { getSessionManager, type SessionInfo } from './terminal/session';
import * as tmux from './terminal/tmux';
import { getShortcutKey } from './terminal/interactive';
import { activeSessions, pendingPrompts, pendingFileUploads, lastRequester, COMMAND_PREFIX, smartCard } from './state';
import { handleShellCommand, handleSpecialKey, handleShortcutKey, handleRawMode, handleScreen, handleTerminalInput } from './handlers/terminal';
import { handleClaudeCommand, handleOpencodeCommand, handleCd, getClaudeManager, getOpencodeManager } from './handlers/ai';
import { handleCloudCommand, forwardToClouddev } from './handlers/clouddev';
import { handleFileUpload, handleFileDownload, handleFileOverwriteResponse } from './handlers/file';
import type { AIManager } from './ai/manager';
import { handleNewSession, handleListSessions, handleSwitchSession, handleKillSession, handleInterrupt, handleModeSwitch, handleHistory, handleModel } from './handlers/session';

// ── Command handling ──

async function handleCommand(
  conversationId: string,
  senderId: string,
  message: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  // Check if user is allowed
  if (!feishuBot.isUserAllowed(senderId)) {
    await feishuBot.sendText(
      conversationId,
      `Unauthorized user\nYour User ID: ${senderId}\nAdd this ID to ALLOWED_USERS in .env`
    );
    return;
  }

  const trimmedMessage = message.trim();

  // Handle commands
  if (trimmedMessage.startsWith(COMMAND_PREFIX)) {
    const parts = trimmedMessage.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
      case 'h':
        await feishuBot.sendCard(conversationId, smartCard.buildHelpCard());
        return;
      case 'sh':
        await handleShellCommand(conversationId, args.join(' '));
        return;
      case 'claude':
        await handleClaudeCommand(conversationId, args.join(' '));
        return;
      case 'opencode':
      case 'oc':
        await handleOpencodeCommand(conversationId, args.join(' '));
        return;
      case 'new':
        await handleNewSession(conversationId, args[0]);
        return;
      case 'list':
        await handleListSessions(conversationId);
        return;
      case 'switch':
        await handleSwitchSession(conversationId, args[0]);
        return;
      case 'kill':
        await handleKillSession(conversationId, args);
        return;
      case 'interrupt':
        await handleInterrupt(conversationId);
        return;
      case 'mode':
        await handleModeSwitch(conversationId, args[0]);
        return;
      case 'history':
        await handleHistory(conversationId);
        return;
      case 'model':
        await handleModel(conversationId, args.join(' '));
        return;
      case 'key':
        await handleSpecialKey(conversationId, args.join(' '));
        return;
      case 'raw':
        await handleRawMode(conversationId, args[0]);
        return;
      case 'screen':
      case 'sc':
        await handleScreen(conversationId);
        return;
      case 'cd':
        await handleCd(conversationId, args.join(' '));
        return;
      case 'cloud':
        await handleCloudCommand(conversationId, args[0]);
        return;
      case 'dl':
      case 'download':
        await handleFileDownload(conversationId, args.join(' '));
        return;
      case 'whoami':
        await feishuBot.sendText(conversationId, `Your User ID: ${senderId}`);
        return;
      default: {
        // Check if this is a shortcut command (e.g., !esc, !enter, !tab)
        const shortcutKey = getShortcutKey(command);
        if (shortcutKey) {
          await handleShortcutKey(conversationId, shortcutKey);
          return;
        }
        await feishuBot.sendText(conversationId, `Unknown command: ${command}\nType !help to see all commands`);
        return;
      }
    }
  }

  // Handle pending prompt response (Terminal mode)
  const pendingPrompt = pendingPrompts.get(conversationId);
  if (pendingPrompt) {
    const num = parseInt(trimmedMessage, 10);
    if (!isNaN(num) && num >= 0 && num < pendingPrompt.options.length) {
      const activeSessionId = activeSessions.get(conversationId);
      if (activeSessionId !== undefined) {
        const sessionManager = getSessionManager();
        const session = sessionManager.getSession(activeSessionId);
        if (session?.type === 'terminal' && session.tmuxName) {
          await tmux.sendKeys(session.tmuxName, String(num));
          await tmux.sendKeys(session.tmuxName, 'Enter');
          pendingPrompts.delete(conversationId);
          return;
        }
      }
    }
  }

  // Handle file overwrite confirmation responses
  if (pendingFileUploads.has(conversationId)) {
    const handled = await handleFileOverwriteResponse(conversationId, trimmedMessage);
    if (handled) return;
  }

  // Route to active session
  await routeToActiveSession(conversationId, trimmedMessage);
}

/**
 * Route a message to the user's active session (claude/opencode/terminal).
 * If no session exists, creates a Claude session by default.
 */
async function routeToActiveSession(conversationId: string, message: string): Promise<void> {
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);

    if (session?.type === 'claude') {
      handleClaudeCommand(conversationId, message);
    } else if (session?.type === 'opencode') {
      handleOpencodeCommand(conversationId, message);
    } else if (session?.type === 'terminal' && session.tmuxName) {
      await handleTerminalInput(conversationId, activeSessionId, session.tmuxName, message, session.rawMode);
    } else if (session?.type === 'clouddev' && session.tmuxName) {
      if (session.clouddevStatus === 'connected') {
        // Connected — behaves like a regular terminal
        await handleTerminalInput(conversationId, activeSessionId, session.tmuxName, message, session.rawMode);
      } else {
        // Still connecting — forward input for auth (password, token, etc.)
        await forwardToClouddev(conversationId, session.tmuxName, message);
      }
    }
  } else {
    await handleClaudeCommand(conversationId, message);
  }
}

// ── Main entry point ──

/**
 * Reconnect AI sessions for a specific backend type after bot restart.
 */
async function reconnectBackend(
  type: 'claude' | 'opencode',
  manager: AIManager,
  sessions: SessionInfo[],
  sessionManager: ReturnType<typeof getSessionManager>,
): Promise<void> {
  for (const session of sessions) {
    if (session.type !== type || !session.sdkSessionId || !session.conversationId) continue;
    const ok = await manager.reconnectSession(session.conversationId, session.sdkSessionId);
    if (ok) {
      activeSessions.set(session.conversationId, session.id);
    } else {
      console.log(`[INIT] ${type} session ${session.id} (${session.sdkSessionId}) no longer exists, removing`);
      await sessionManager.killSession(session.id).catch(err =>
        console.warn('[INIT] Failed to kill stale session:', err.message || err),
      );
    }
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const feishuBot = getFeishuBot();

  // Initialize session manager and reconnect sessions
  const sessionManager = getSessionManager();
  await sessionManager.reconnectSessions();

  // Reconnect AI sessions that survived bot restart
  const claudeManager = getClaudeManager();
  const opencodeManager = getOpencodeManager();
  const allSessions = sessionManager.getSessions();
  await reconnectBackend('claude', claudeManager, allSessions, sessionManager);
  await reconnectBackend('opencode', opencodeManager, allSessions, sessionManager);

  // Create event dispatcher
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: '',
  });

  // Register message event handler
  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const message = feishuBot.parseMessage(data);
      if (message && message.senderId && message.conversationId) {
        lastRequester.set(message.conversationId, message.senderId);
      }
      if (message) {
        console.log(`[MSG] ${message.content.slice(0, 50)}`);

        // Handle folder messages — not supported
        if (message.messageType === 'folder') {
          feishuBot.sendText(message.conversationId, 'Folder upload is not supported. Please send files individually or pack as zip/tar.gz first.')
            .catch(err => console.error('[FILE] Folder reply error:', err));
          return;
        }

        // Handle file/image messages separately
        if (message.messageType === 'file' || message.messageType === 'image') {
          if (message.fileKey && message.fileName) {
            const resourceType = message.messageType === 'image' ? 'image' : 'file';
            const reactionId = await feishuBot.addReaction(message.messageId, 'Typing');
            handleFileUpload(message.conversationId, message.messageId, message.fileKey, message.fileName, resourceType)
              .catch(err => console.error('[FILE] Upload error:', err))
              .finally(() => {
                if (reactionId) feishuBot.removeReaction(message.messageId, reactionId).catch(() => {});
              });
          }
          return;
        }

        // Add typing reaction, process, then remove
        const doWork = async () => {
          const reactionId = await feishuBot.addReaction(message.messageId, 'Typing');
          try {
            await handleCommand(message.conversationId, message.senderId, message.content);
          } finally {
            if (reactionId) {
              feishuBot.removeReaction(message.messageId, reactionId).catch(err => console.warn('[FEISHU] Failed to remove reaction:', err.message || err));
            }
          }
        };
        doWork().catch(err => console.error('[MSG] Error:', err));
      }
    },
    'card.action.trigger': async (data: unknown) => {
      const { handleCardAction } = await import('./handlers/card-action');
      return handleCardAction(data);
    },
  });

  // Create WebSocket client
  // Card action callbacks (card.action.trigger) ARE supported in WebSocket mode
  // for the new schema-2.0 card format. The event is registered on eventDispatcher
  // above. Legacy schema-1.0 card callbacks (card.action.trigger_v1) are not.
  const wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  // Start WebSocket connection
  console.log('Connecting to Feishu via WebSocket...');
  await wsClient.start({ eventDispatcher });

  console.log('Feishu Terminal Bot connected via WebSocket');
  console.log('Commands: !sh, !claude, !opencode, !cloud, !new, !list, !switch, !kill, !interrupt, !mode, !key, !raw, !screen, !history, !esc, !enter, !tab, !whoami');
  console.log('Default: messages go to Claude');

  // Periodic cleanup of stale sessions
  setInterval(async () => {
    const cleaned = await sessionManager.cleanupStaleSessions(config.session.staleTimeout);
    if (cleaned > 0) {
      console.log(`[CLEANUP] Removed ${cleaned} stale sessions`);
    }
  }, config.session.cleanupInterval);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] Received ${signal}, cleaning up...`);
    try {
      await claudeManager.killAll();
      console.log('[SHUTDOWN] Claude sessions cleaned up');
      await opencodeManager.killAll();
      console.log('[SHUTDOWN] Opencode sessions cleaned up');
    } catch (err) {
      console.warn('[SHUTDOWN] Error cleaning up Claude sessions:', err instanceof Error ? err.message : err);
    }
    console.log('[SHUTDOWN] Done');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
  });
}

main().catch(console.error);

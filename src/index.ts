import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from './config';
import { getFeishuBot } from './bot/feishu';
import { getSessionManager } from './terminal/session';
import * as tmux from './terminal/tmux';
import { isInteractiveProgram, getShortcutKey } from './terminal/interactive';
import { activeSessions, pendingPrompts, COMMAND_PREFIX, smartCard } from './state';
import { handleShellCommand, handleSpecialKey, handleShortcutKey, handleRawMode, handleScreen, extractCommandOutput } from './handlers/terminal';
import { handleClaudeCommand, handleOpencodeCommand, handleCd, getClaudeManager, getOpencodeManager } from './handlers/ai';
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
        await handleNewSession(conversationId);
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

  // Default: send to active session
  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId !== undefined) {
    const sessionManager = getSessionManager();
    const session = sessionManager.getSession(activeSessionId);

    if (session?.type === 'claude') {
      // Route through handleClaudeCommand which handles reconnection
      handleClaudeCommand(conversationId, trimmedMessage);
    } else if (session?.type === 'opencode') {
      handleOpencodeCommand(conversationId, trimmedMessage);
    } else if (session?.type === 'terminal' && session.tmuxName) {
      const cmd = trimmedMessage;
      const sid = activeSessionId;
      const tmuxName = session.tmuxName;

      // Determine if raw mode is active
      let useRawMode = session.rawMode === true;
      if (session.rawMode === undefined) {
        try {
          const currentCmd = await tmux.getCurrentCommand(tmuxName);
          useRawMode = isInteractiveProgram(currentCmd);
        } catch (err) {
          console.warn('[TMUX] Failed to detect current command:', err instanceof Error ? err.message : err);
          useRawMode = false;
        }
      }

      // Use literal mode for user-provided text to prevent tmux key name interpretation
      await tmux.sendLiteralKeys(tmuxName, cmd);
      if (!useRawMode) {
        await tmux.sendKeys(tmuxName, 'Enter');
      }

      // Capture screen feedback
      const cfg = getConfig();
      const delay = useRawMode ? cfg.timing.rawModeCaptureDelay : cfg.timing.shellCaptureDelay;
      setTimeout(async () => {
        try {
          const captured = await tmux.capturePane(tmuxName);
          if (useRawMode) {
            // Raw mode: show full screen capture
            const card = smartCard.buildTerminalOutputCard(captured, { sessionId: sid });
            await feishuBot.sendCard(conversationId, card);
          } else {
            // Normal mode: extract command output
            const { output, cwd } = extractCommandOutput(captured, cmd);
            const card = smartCard.buildTerminalOutputCard(output, { command: cmd, sessionId: sid, cwd });
            await feishuBot.sendCard(conversationId, card);
          }
        } catch (err) {
          console.error('Failed to capture pane:', err);
        }
      }, delay);
    }
  } else {
    // No active session — create Claude session by default
    await handleClaudeCommand(conversationId, trimmedMessage);
  }
}

// ── Main entry point ──

async function main(): Promise<void> {
  const config = getConfig();
  const feishuBot = getFeishuBot();

  // Initialize session manager and reconnect sessions
  const sessionManager = getSessionManager();
  await sessionManager.reconnectSessions();

  // Reconnect Claude SDK sessions that survived bot restart
  const claudeManager = getClaudeManager();
  const allSessions = sessionManager.getSessions();
  for (const session of allSessions) {
    if (session.type === 'claude' && session.claudeSessionId && session.conversationId) {
      const ok = await claudeManager.reconnectSession(session.conversationId, session.claudeSessionId);
      if (ok) {
        activeSessions.set(session.conversationId, session.id);
      } else {
        console.log(`[INIT] Claude session ${session.id} (${session.claudeSessionId}) no longer exists, removing`);
        await sessionManager.killSession(session.id).catch(err => console.warn('[INIT] Failed to kill stale session:', err.message || err));
      }
    }
  }

  // Reconnect opencode SDK sessions
  const opencodeManager = getOpencodeManager();
  for (const session of allSessions) {
    if (session.type === 'opencode' && session.claudeSessionId && session.conversationId) {
      const ok = await opencodeManager.reconnectSession(session.conversationId, session.claudeSessionId);
      if (ok) {
        activeSessions.set(session.conversationId, session.id);
      } else {
        console.log(`[INIT] Opencode session ${session.id} (${session.claudeSessionId}) no longer exists, removing`);
        await sessionManager.killSession(session.id).catch(err => console.warn('[INIT] Failed to kill stale session:', err.message || err));
      }
    }
  }

  // Create event dispatcher
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: '',
  });

  // Register message event handler
  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const message = feishuBot.parseMessage(data);
      if (message) {
        console.log(`[MSG] ${message.content.slice(0, 50)}`);
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
  });

  // Create WebSocket client
  // Note: Card action callbacks (button clicks) are NOT supported in WebSocket mode.
  // Users interact by typing numbers/text instead of clicking buttons.
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
  console.log('Commands: !sh, !claude, !opencode, !new, !list, !switch, !kill, !interrupt, !mode, !key, !raw, !screen, !history, !esc, !enter, !tab, !whoami');
  console.log('Default: messages go to Claude');

  // Periodic cleanup of stale sessions (every hour)
  setInterval(async () => {
    const cleaned = await sessionManager.cleanupStaleSessions(24 * 60 * 60 * 1000);
    if (cleaned > 0) {
      console.log(`[CLEANUP] Removed ${cleaned} stale sessions`);
    }
  }, 60 * 60 * 1000);

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

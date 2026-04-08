import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from './config';
import { getFeishuBot } from './bot/feishu';
import {
  SmartCardBuilder,
  CardBuilder,
  isMoreOptionsValue,
  isPermitAction,
  PERMIT_ALLOW,
  PERMIT_DENY,
  PERMIT_ALWAYS,
  CompletionStats,
} from './bot/card';
import { getSessionManager, SessionInfo } from './terminal/session';
import { getPtyManager, OutputCallback, PromptDetectionResult } from './terminal/pty';
import { ClaudeManager, ClaudeManagerCallbacks } from './claude/manager';
import { ClaudeInitEvent, ClaudeResultEvent } from './claude/types';

// ── State ──

/** Active session per conversation (session ID) */
const activeSessions: Map<string, number> = new Map();

/** Pending prompts waiting for user response (Terminal mode) */
const pendingPrompts: Map<string, PromptDetectionResult> = new Map();

/** Card message IDs for updates */
const lastCardMessageIds: Map<string, string> = new Map();

const COMMAND_PREFIX = '!';

// ── Card builders ──

const smartCard = new SmartCardBuilder();
const legacyCard = new CardBuilder();

// ── Claude callbacks ──

const claudeCallbacks: ClaudeManagerCallbacks = {
  onInit: async (conversationId, event: ClaudeInitEvent) => {
    const feishuBot = getFeishuBot();
    const sessionManager = getSessionManager();

    // Store Claude session ID for --resume
    const activeSessionId = activeSessions.get(conversationId);
    if (activeSessionId !== undefined) {
      sessionManager.updateClaudeSessionId(activeSessionId, event.session_id);
    }

    const card = smartCard.buildInitCard(event.session_id, event.model);
    await feishuBot.sendCard(conversationId, card);
  },

  onText: async (conversationId, text) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildTextCard(text);
    const msgId = await feishuBot.sendCard(conversationId, card);
    if (msgId) lastCardMessageIds.set(conversationId, msgId);
  },

  onToolUse: async (conversationId, toolName, input) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildToolCallCard(toolName, input);
    const msgId = await feishuBot.sendCard(conversationId, card);
    if (msgId) lastCardMessageIds.set(conversationId, msgId);
  },

  onResult: async (conversationId, event: ClaudeResultEvent) => {
    const feishuBot = getFeishuBot();

    // Check for permission denials
    if (event.permission_denials && event.permission_denials.length > 0) {
      for (const denial of event.permission_denials) {
        const card = smartCard.buildPermissionCard(denial.tool, denial.reason);
        await feishuBot.sendCard(conversationId, card);
      }
      return;
    }

    // Send completion card
    const stats: CompletionStats = {
      durationMs: event.duration_ms,
      costUsd: event.total_cost_usd,
      inputTokens: event.usage.input_tokens,
      outputTokens: event.usage.output_tokens,
      numTurns: event.num_turns,
    };
    const card = smartCard.buildCompletionCard(stats);
    await feishuBot.sendCard(conversationId, card);
  },

  onError: async (conversationId, error) => {
    const feishuBot = getFeishuBot();
    const card = smartCard.buildErrorCard(error);
    await feishuBot.sendCard(conversationId, card);
  },
};

// ── Terminal output callback ──

const handlePtyOutput: OutputCallback = async (
  sessionId: number,
  output: string,
  prompt?: PromptDetectionResult
) => {
  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(sessionId);
  if (!session?.conversationId) return;

  const feishuBot = getFeishuBot();
  const conversationId = session.conversationId;

  // Check for binary output
  const { MessageFormatter } = await import('./bot/message');
  const formatter = new MessageFormatter();
  if (formatter.detectBinary(output)) {
    await feishuBot.sendText(conversationId, 'Binary output detected.');
    return;
  }

  // Check for prompts (Terminal mode)
  if (prompt?.type) {
    const card = legacyCard.buildCard(prompt);
    if (card) {
      await feishuBot.sendCard(conversationId, card);
      pendingPrompts.set(conversationId, prompt);
    } else {
      const termCard = smartCard.buildTerminalOutputCard(output);
      await feishuBot.sendCard(conversationId, termCard);
    }
  } else {
    const termCard = smartCard.buildTerminalOutputCard(output);
    await feishuBot.sendCard(conversationId, termCard);
  }
};

// ── Lazy managers ──

let _claudeManager: ClaudeManager | null = null;
function getClaudeManager(): ClaudeManager {
  if (!_claudeManager) {
    _claudeManager = new ClaudeManager(claudeCallbacks);
  }
  return _claudeManager;
}

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
      case 'sh':
        await handleShellCommand(conversationId, args.join(' '));
        return;
      case 'claude':
        await handleClaudeCommand(conversationId, args.join(' '));
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
        await handleKillSession(conversationId, args[0]);
        return;
      case 'interrupt':
        await handleInterrupt(conversationId);
        return;
      case 'mode':
        await handleModeSwitch(conversationId, args[0]);
        return;
      case 'key':
        await handleSpecialKey(conversationId, args.join(' '));
        return;
      case 'whoami':
        await feishuBot.sendText(conversationId, `Your User ID: ${senderId}`);
        return;
      default:
        await feishuBot.sendText(
          conversationId,
          `Unknown command: ${command}\nAvailable: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami`
        );
        return;
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
        if (session?.type === 'terminal') {
          const ptyManager = getPtyManager();
          ptyManager.writeToSession(activeSessionId, `${num}\n`);
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
      // Send to Claude via --resume
      const claudeManager = getClaudeManager();
      claudeManager.startSession(conversationId, trimmedMessage, {
        resumeId: session.claudeSessionId,
        permissionMode: session.permissionMode || 'default',
        allowedTools: session.allowedTools,
      });
    } else if (session?.type === 'terminal') {
      const ptyManager = getPtyManager();
      ptyManager.writeToSession(activeSessionId, trimmedMessage + '\n');
    }
  } else {
    // No active session — create Claude session by default
    await handleClaudeCommand(conversationId, trimmedMessage);
  }
}

// ── Command handlers ──

async function handleShellCommand(conversationId: string, command: string): Promise<void> {
  const feishuBot = getFeishuBot();
  if (!command) {
    await feishuBot.sendText(conversationId, 'Usage: !sh <command>');
    return;
  }

  const sessionManager = getSessionManager();
  const ptyManager = getPtyManager(handlePtyOutput);

  // Find or create a terminal session
  let activeSessionId = activeSessions.get(conversationId);
  let session: SessionInfo | undefined;

  if (activeSessionId !== undefined) {
    session = sessionManager.getSession(activeSessionId);
  }

  if (!session || session.type !== 'terminal') {
    // Create a new terminal session
    session = await sessionManager.createSession(conversationId);
    activeSessions.set(conversationId, session.id);
    activeSessionId = session.id;
    await ptyManager.spawnSession(session.id, session.tmuxName!);
  } else if (!ptyManager.isSessionActive(activeSessionId!)) {
    await ptyManager.spawnSession(activeSessionId!, session.tmuxName!);
  }

  ptyManager.writeToSession(activeSessionId!, command + '\n');
}

async function handleClaudeCommand(conversationId: string, prompt: string): Promise<void> {
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

  if (!session || session.type !== 'claude') {
    // Create a new Claude session
    session = sessionManager.createClaudeSession(conversationId);
    activeSessions.set(conversationId, session.id);
  }

  // Start Claude process
  claudeManager.startSession(conversationId, prompt, {
    resumeId: session.claudeSessionId,
    permissionMode: session.permissionMode || 'default',
    allowedTools: session.allowedTools,
  });
}

async function handleNewSession(conversationId: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const sessionManager = getSessionManager();

  const session = sessionManager.createClaudeSession(conversationId);
  activeSessions.set(conversationId, session.id);

  await feishuBot.sendText(conversationId, `Created Claude session ${session.id}`);
}

async function handleListSessions(conversationId: string): Promise<void> {
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

async function handleSwitchSession(conversationId: string, idStr?: string): Promise<void> {
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

  // For terminal sessions, ensure PTY is active
  if (session.type === 'terminal' && session.tmuxName) {
    const ptyManager = getPtyManager(handlePtyOutput);
    if (!ptyManager.isSessionActive(sessionId)) {
      await ptyManager.spawnSession(sessionId, session.tmuxName);
    }
  }

  activeSessions.set(conversationId, sessionId);
  await feishuBot.sendText(conversationId, `Switched to ${session.type} session ${sessionId}`);
}

async function handleKillSession(conversationId: string, idStr?: string): Promise<void> {
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
  if (session.type === 'terminal') {
    const ptyManager = getPtyManager();
    await ptyManager.killSession(sessionId);
  } else if (session.type === 'claude') {
    const claudeManager = getClaudeManager();
    claudeManager.interruptSession(conversationId);
  }

  await sessionManager.killSession(sessionId);

  if (activeSessions.get(conversationId) === sessionId) {
    activeSessions.delete(conversationId);
  }

  await feishuBot.sendText(conversationId, `Killed ${session.type} session ${sessionId}`);
}

async function handleInterrupt(conversationId: string): Promise<void> {
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
    claudeManager.interruptSession(conversationId);
    await feishuBot.sendText(conversationId, 'Claude process interrupted');
  } else if (session?.type === 'terminal') {
    const ptyManager = getPtyManager();
    ptyManager.sendInterrupt(activeSessionId);
    await feishuBot.sendText(conversationId, 'Sent Ctrl-C');
  }
}

async function handleModeSwitch(conversationId: string, mode?: string): Promise<void> {
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

async function handleSpecialKey(conversationId: string, key?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!key) {
    await feishuBot.sendText(
      conversationId,
      'Usage: !key <key>\nAvailable: up, down, left, right, enter, tab, escape, ctrl+c, ctrl+d, ...'
    );
    return;
  }

  const activeSessionId = activeSessions.get(conversationId);
  if (activeSessionId === undefined) {
    await feishuBot.sendText(conversationId, 'No active session');
    return;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.getSession(activeSessionId);
  if (session?.type !== 'terminal') {
    await feishuBot.sendText(conversationId, '!key only works in Terminal mode');
    return;
  }

  const ptyManager = getPtyManager();
  ptyManager.sendSpecialKey(activeSessionId, key);
}

// ── Card action handling ──

async function handleCardAction(
  conversationId: string,
  senderId: string,
  value: string
): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!feishuBot.isUserAllowed(senderId)) return;

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
    if (session?.type === 'terminal') {
      const ptyManager = getPtyManager();
      ptyManager.writeToSession(activeSessionId, `${value}\n`);
      pendingPrompts.delete(conversationId);
    }
  }
}

async function handlePermitAction(conversationId: string, value: string): Promise<void> {
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

// ── Main entry point ──

async function main(): Promise<void> {
  const config = getConfig();
  const feishuBot = getFeishuBot();

  // Initialize session manager and reconnect sessions
  const sessionManager = getSessionManager();
  await sessionManager.reconnectSessions();

  // Initialize PTY manager with output callback
  getPtyManager(handlePtyOutput);

  // Create event dispatcher
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: '',
  });

  // Register message event handler
  eventDispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      try {
        const message = feishuBot.parseMessage(data);
        if (message) {
          await handleCommand(message.conversationId, message.senderId, message.content);
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    },
  });

  // Create WebSocket client
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
  console.log('Commands: !sh, !claude, !new, !list, !switch, !kill, !interrupt, !mode, !key, !whoami');
  console.log('Default: messages go to Claude');
}

main().catch(console.error);

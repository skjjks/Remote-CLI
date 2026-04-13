import { getFeishuBot } from '../bot/feishu';
import { getConfig } from '../config';
import { getSessionManager } from '../terminal/session';
import { activeSessions, smartCard } from '../state';
import { CloudDevConnector, ConnectorCallbacks, ConnectorState } from '../clouddev/connector';

/** Active connectors — keyed by conversationId */
const activeConnectors: Map<string, CloudDevConnector> = new Map();

/**
 * Handle `!cloud` or `!cloud <username>` command.
 * Creates a clouddev session and starts the SSH connection flow.
 */
export async function handleCloudCommand(conversationId: string, usernameOverride?: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const config = getConfig();
  const sessionManager = getSessionManager();

  const username = usernameOverride || config.clouddev.username;
  if (!username) {
    await feishuBot.sendText(conversationId, 'No username configured. Set CLOUDDEV_USERNAME in .env or use: !cloud <username>');
    return;
  }

  // Kill existing connector for this conversation if any
  const existingConnector = activeConnectors.get(conversationId);
  if (existingConnector) {
    existingConnector.stop();
    activeConnectors.delete(conversationId);
  }

  // Create a clouddev session
  const session = await sessionManager.createClouddevSession(conversationId);
  activeSessions.set(conversationId, session.id);

  // Create the initial progress card — will be updated in real-time
  const initCard = smartCard.buildTextCard(
    `Connecting to \`${config.clouddev.relayHost}\`...`,
    { backend: 'clouddev', status: 'connecting' },
  );
  let cardMessageId = await feishuBot.sendCard(conversationId, initCard);
  let authUrl: string | undefined;

  const stateLabels: Record<string, string> = {
    ssh_sent: 'SSH connecting...',
    auth_waiting: 'waiting for auth',
    token_waiting: 'please enter token',
    sync_sent: 'syncing...',
    domain_sent: 'entering cloud...',
    connected: 'done',
    failed: 'failed',
  };

  // Set up callbacks
  const callbacks: ConnectorCallbacks = {
    onStateChange: (state: ConnectorState, message: string) => {
      console.log(`[CLOUDDEV] ${conversationId} → ${state}: ${message}`);
      sessionManager.updateClouddevStatus(session.id, state === 'connected' ? 'connected'
        : state === 'failed' ? 'failed'
        : state === 'auth_waiting' ? 'auth_waiting'
        : 'connecting');
    },

    onAuthRequired: async (_type, url, _screenshot) => {
      // Just store the URL — the real-time card update will display it
      if (url) authUrl = url;
    },

    onScreenUpdate: async (state, screenshot) => {
      if (!cardMessageId) return;
      const status = stateLabels[state] || state;
      const authLine = authUrl ? `\n\n[点击扫码认证](${authUrl})` : '';
      const card = smartCard.buildTextCard(
        `${authLine}\n\n\`\`\`\n${screenshot}\n\`\`\``,
        { backend: 'clouddev', status },
      );
      feishuBot.updateCard(cardMessageId, card).catch(err =>
        console.warn('[CLOUDDEV] Failed to update card:', err.message || err),
      );
    },

    onConnected: async () => {
      activeConnectors.delete(conversationId);
      if (cardMessageId) {
        const card = smartCard.buildTextCard(
          `Connected to engineering cloud!\nSession ${session.id} is now active. Send commands directly.`,
          { backend: 'clouddev', status: 'done' },
        );
        feishuBot.updateCard(cardMessageId, card).catch(err =>
          console.warn('[CLOUDDEV] Failed to update card:', err.message || err),
        );
      }
    },

    onFailed: async (error) => {
      activeConnectors.delete(conversationId);
      if (cardMessageId) {
        const card = smartCard.buildErrorCard(`CloudDev connection failed: ${error}`);
        feishuBot.updateCard(cardMessageId, card).catch(err =>
          console.warn('[CLOUDDEV] Failed to update card:', err.message || err),
        );
      }
    },
  };

  // Start the connector
  const connector = new CloudDevConnector(session.tmuxName!, callbacks, { username });
  activeConnectors.set(conversationId, connector);

  await connector.start();
  connector.startPolling();
}

/**
 * Forward user input to an active clouddev session that is still connecting.
 * Used for typing passwords, tokens, etc. during the auth phase.
 * No separate card is sent — the real-time CloudDev card handles display.
 */
export async function forwardToClouddev(conversationId: string, tmuxName: string, message: string): Promise<void> {
  const tmux = await import('../terminal/tmux');
  await tmux.sendLiteralKeys(tmuxName, message);
  await tmux.sendKeys(tmuxName, 'Enter');
}

/**
 * Get the active connector for a conversation (if connecting).
 */
export function getActiveConnector(conversationId: string): CloudDevConnector | undefined {
  return activeConnectors.get(conversationId);
}

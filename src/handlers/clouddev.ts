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

  await feishuBot.sendText(conversationId, `Connecting to engineering cloud as ${username}...`);

  // Set up callbacks
  const callbacks: ConnectorCallbacks = {
    onStateChange: (state: ConnectorState, message: string) => {
      console.log(`[CLOUDDEV] ${conversationId} → ${state}: ${message}`);
      sessionManager.updateClouddevStatus(session.id, state === 'connected' ? 'connected'
        : state === 'failed' ? 'failed'
        : state === 'auth_waiting' ? 'auth_waiting'
        : 'connecting');
    },

    onAuthRequired: async (type, url, screenshot) => {
      if (type === 'qrcode' && url) {
        // Send clickable link + screenshot to Feishu
        const card = smartCard.buildTextCard(
          `**工程云认证 — 请扫码**\n\n[点击扫码认证](${url})\n\n\`\`\`\n${(screenshot || '').slice(-500)}\n\`\`\``,
          { backend: 'clouddev', status: 'auth' },
        );
        await feishuBot.sendCard(conversationId, card);
      } else if (type === 'password') {
        if (config.clouddev.emailPassword) {
          await feishuBot.sendText(conversationId, 'Password auto-filled. If a token is needed, type it here.');
        } else {
          await feishuBot.sendText(conversationId, 'Password required — type your email password here.');
        }
      }
    },

    onConnected: async () => {
      activeConnectors.delete(conversationId);
      await feishuBot.sendText(conversationId, `Connected to engineering cloud!\nSession ${session.id} is now active. Send commands directly.`);
    },

    onFailed: async (error) => {
      activeConnectors.delete(conversationId);
      await feishuBot.sendCard(conversationId, smartCard.buildErrorCard(`CloudDev connection failed: ${error}`));
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
 */
export async function forwardToClouddev(conversationId: string, tmuxName: string, message: string): Promise<void> {
  const feishuBot = getFeishuBot();
  const tmux = await import('../terminal/tmux');

  await tmux.sendLiteralKeys(tmuxName, message);
  await tmux.sendKeys(tmuxName, 'Enter');

  // Send screen capture feedback after a short delay
  setTimeout(async () => {
    try {
      const captured = await tmux.capturePane(tmuxName);
      const card = smartCard.buildTerminalOutputCard(captured, {});
      await feishuBot.sendCard(conversationId, card);
    } catch (err) {
      console.error('[CLOUDDEV] Failed to capture pane:', err);
    }
  }, 1500);
}

/**
 * Get the active connector for a conversation (if connecting).
 */
export function getActiveConnector(conversationId: string): CloudDevConnector | undefined {
  return activeConnectors.get(conversationId);
}

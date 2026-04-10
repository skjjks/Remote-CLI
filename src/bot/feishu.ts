import * as lark from '@larksuiteoapi/node-sdk';
import crypto from 'crypto';
import express from 'express';
import { getConfig } from '../config';

export interface FeishuMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'post' | 'interactive';
}

export interface FeishuCardAction {
  action: 'click';
  value: string;
}

export class FeishuBot {
  private client: lark.Client;
  private config: ReturnType<typeof getConfig>;

  constructor() {
    this.config = getConfig();
    this.client = new lark.Client({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });
  }

  /**
   * Verify webhook request signature
   * Feishu signs requests with HMAC-SHA256
   */
  verifySignature(timestamp: string, body: string, signature: string): boolean {
    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime) || Math.abs(now - requestTime) > 300) {
      return false;
    }

    // Compute HMAC-SHA256
    const content = timestamp + '\n' + body;
    const expectedSignature = crypto
      .createHmac('sha256', this.config.feishu.appSecret)
      .update(content)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Check if user is in allowed list
   */
  isUserAllowed(userId: string): boolean {
    const allowedUsers = this.config.security.allowedUsers;
    // If no whitelist configured, allow all (development mode)
    if (allowedUsers.length === 0) {
      return true;
    }
    return allowedUsers.includes(userId);
  }

  /**
   * Parse incoming message from webhook event
   */
  parseMessage(event: unknown): FeishuMessage | null {
    try {
      const data = event as Record<string, unknown>;
      const message = data.message as Record<string, unknown> | undefined;
      const sender = data.sender as Record<string, unknown> | undefined;
      if (!message || !sender) {
        return null;
      }

      const senderIdObj = sender.sender_id as Record<string, unknown> | undefined;
      const senderId = (senderIdObj?.user_id || senderIdObj?.open_id) as string | undefined;
      if (!senderId) {
        return null;
      }

      let content = '';
      let messageType: FeishuMessage['messageType'] = 'text';

      if (message.content) {
        const parsed = JSON.parse(message.content as string);
        if (parsed.text) {
          content = parsed.text;
        } else if (parsed.post) {
          // Extract text from post message
          content = this.extractTextFromPost(parsed.post);
          messageType = 'post';
        }
      }

      return {
        messageId: message.message_id as string,
        conversationId: message.chat_id as string,
        senderId,
        content,
        messageType,
      };
    } catch (error) {
      console.error('Failed to parse message:', error);
      return null;
    }
  }

  /**
   * Parse card action from webhook event
   */
  parseCardAction(event: unknown): { action: FeishuCardAction; conversationId: string; senderId: string } | null {
    try {
      const data = event as Record<string, unknown>;
      const action = data.action as Record<string, unknown> | undefined;
      const context = data.context as Record<string, unknown> | undefined;
      if (!action || !context) {
        return null;
      }

      const senderId = (context.open_id || context.user_id) as string | undefined;
      if (!senderId) {
        return null;
      }

      return {
        action: {
          action: 'click',
          value: action.value as string,
        },
        conversationId: context.chat_id as string,
        senderId,
      };
    } catch (error) {
      console.error('Failed to parse card action:', error);
      return null;
    }
  }

  /**
   * Send text message to a conversation
   */
  async sendText(conversationId: string, text: string): Promise<void> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: conversationId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      const res = response as Record<string, unknown>;
      const resData = res?.data as Record<string, unknown> | undefined;
      if (res?.code && res.code !== 0) {
        console.error('[API] sendText error:', res.code, res.msg);
      } else {
        console.log('[API] sendText OK, msg_id:', resData?.message_id);
      }
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      console.error('[API] sendText FAILED:', err?.code, err?.msg || (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  /**
   * Send interactive card to a conversation
   * Returns the message_id for later updates
   */
  async sendCard(conversationId: string, card: object): Promise<string | undefined> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: conversationId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
      const res = response as Record<string, unknown>;
      const resData = res?.data as Record<string, unknown> | undefined;
      if (res?.code && res.code !== 0) {
        console.error('[API] sendCard error:', res.code, res.msg);
        return undefined;
      }
      console.log('[API] sendCard OK, msg_id:', resData?.message_id);
      return resData?.message_id as string | undefined;
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      console.error('[API] sendCard FAILED:', err?.code, err?.msg || (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  /**
   * Update an existing card message
   * Uses PATCH /open-apis/im/v1/messages/:message_id
   */
  async updateCard(messageId: string, card: object): Promise<void> {
    try {
      await this.client.im.message.patch({
        path: {
          message_id: messageId,
        },
        data: {
          content: JSON.stringify(card),
        },
      });
    } catch (error: unknown) {
      // Feishu rate limit (230020) or other API errors — log concisely, don't dump full Axios object
      const axiosErr = error as any;
      const code = axiosErr?.response?.data?.code;
      const msg = axiosErr?.response?.data?.msg;
      if (code === 230020) {
        // Rate limit — expected under fast streaming, just skip silently
      } else {
        console.warn(`[CARD] Failed to update card: ${msg || (error instanceof Error ? error.message : String(error))}`);
      }
      // Don't throw — card update failures are non-critical
    }
  }

  /**
   * Add a reaction (emoji) to a message
   */
  async addReaction(messageId: string, emojiType: string): Promise<string | undefined> {
    try {
      const response = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      });
      const res = response as Record<string, unknown>;
      const resData = res?.data as Record<string, unknown> | undefined;
      if (res?.code && res.code !== 0) {
        console.error('[API] addReaction error:', res.code, res.msg);
        return undefined;
      }
      console.log('[API] addReaction OK:', resData?.reaction_id);
      return resData?.reaction_id as string | undefined;
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      console.error('[API] addReaction FAILED:', err?.code, err?.msg || (error instanceof Error ? error.message : String(error)));
      return undefined;
    }
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      await this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
    } catch (err) {
      console.warn('[FEISHU] Failed to remove reaction:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Reply to a message with text
   */
  async replyText(messageId: string, text: string): Promise<void> {
    try {
      await this.client.im.message.reply({
        path: {
          message_id: messageId,
        },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (error) {
      console.error('Failed to reply text:', error);
      throw error;
    }
  }

  /**
   * Extract plain text from post message format
   */
  private extractTextFromPost(post: unknown): string {
    const data = post as Record<string, unknown> | undefined;
    if (!data || !data.content) {
      return '';
    }

    const textParts: string[] = [];
    const content = data.content as unknown[];
    for (const paragraph of content) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          const el = element as Record<string, unknown>;
          if (el.text) {
            textParts.push(el.text as string);
          }
        }
      }
    }
    return textParts.join('');
  }

  /**
   * Create Express middleware for webhook verification
   */
  webhookMiddleware(): express.RequestHandler {
    return (req, res, next) => {
      const timestamp = req.headers['x-lark-timestamp'] as string;
      const signature = req.headers['x-lark-signature'] as string;

      if (!timestamp || !signature) {
        res.status(401).json({ error: 'Missing signature headers' });
        return;
      }

      // Get raw body
      const body = JSON.stringify(req.body);

      if (!this.verifySignature(timestamp, body, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      next();
    };
  }
}

// Singleton instance
let _bot: FeishuBot | null = null;

export function getFeishuBot(): FeishuBot {
  if (!_bot) {
    _bot = new FeishuBot();
  }
  return _bot;
}

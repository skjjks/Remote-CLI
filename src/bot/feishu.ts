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
  parseMessage(event: any): FeishuMessage | null {
    try {
      const { message, sender } = event;
      if (!message || !sender) {
        return null;
      }

      const senderId = sender.sender_id?.user_id || sender.sender_id?.open_id;
      if (!senderId) {
        return null;
      }

      let content = '';
      let messageType: FeishuMessage['messageType'] = 'text';

      if (message.content) {
        const parsed = JSON.parse(message.content);
        if (parsed.text) {
          content = parsed.text;
        } else if (parsed.post) {
          // Extract text from post message
          content = this.extractTextFromPost(parsed.post);
          messageType = 'post';
        }
      }

      return {
        messageId: message.message_id,
        conversationId: message.chat_id,
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
  parseCardAction(event: any): { action: FeishuCardAction; conversationId: string; senderId: string } | null {
    try {
      const { action, context } = event;
      if (!action || !context) {
        return null;
      }

      const senderId = context.open_id || context.user_id;
      if (!senderId) {
        return null;
      }

      return {
        action: {
          action: 'click',
          value: action.value,
        },
        conversationId: context.chat_id,
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
      await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: conversationId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (error) {
      console.error('Failed to send text message:', error);
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
      return (response as any)?.data?.message_id;
    } catch (error) {
      console.error('Failed to send card:', error);
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
    } catch (error) {
      console.error('Failed to update card:', error);
      // Don't throw — card update failures are non-critical
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
  private extractTextFromPost(post: any): string {
    if (!post || !post.content) {
      return '';
    }

    const textParts: string[] = [];
    for (const paragraph of post.content) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          if (element.text) {
            textParts.push(element.text);
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

export function resetFeishuBot(): void {
  _bot = null;
}

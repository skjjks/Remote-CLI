import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({
    im: {
      message: { create: vi.fn(), patch: vi.fn(), reply: vi.fn() },
      messageReaction: { create: vi.fn(), delete: vi.fn() },
    },
  })),
  AppType: { SelfBuild: 'SelfBuild' },
  Domain: { Feishu: 'Feishu' },
}));

vi.mock('../src/config', () => ({
  getConfig: () => ({
    feishu: { appId: 'test', appSecret: 'test' },
    security: { allowedUsers: [] },
  }),
}));

import { FeishuBot } from '../src/bot/feishu';

describe('FeishuBot file message parsing', () => {
  let bot: FeishuBot;

  beforeEach(() => {
    bot = new FeishuBot();
  });

  it('should parse file message and extract file_key and file_name', () => {
    const event = {
      sender: { sender_id: { user_id: 'u_123' } },
      message: {
        message_id: 'msg_001',
        chat_id: 'chat_001',
        message_type: 'file',
        content: JSON.stringify({
          file_key: 'file_v2_abc123',
          file_name: 'report.pdf',
        }),
      },
    };

    const result = bot.parseMessage(event);

    expect(result).not.toBeNull();
    expect(result!.messageType).toBe('file');
    expect(result!.fileKey).toBe('file_v2_abc123');
    expect(result!.fileName).toBe('report.pdf');
    expect(result!.content).toBe('');
  });

  it('should parse image message and extract image_key', () => {
    const event = {
      sender: { sender_id: { user_id: 'u_123' } },
      message: {
        message_id: 'msg_002',
        chat_id: 'chat_001',
        message_type: 'image',
        content: JSON.stringify({
          image_key: 'img_v2_xyz789',
        }),
      },
    };

    const result = bot.parseMessage(event);

    expect(result).not.toBeNull();
    expect(result!.messageType).toBe('image');
    expect(result!.fileKey).toBe('img_v2_xyz789');
    expect(result!.fileName).toBe('image.png');
    expect(result!.content).toBe('');
  });

  it('should still parse text messages normally', () => {
    const event = {
      sender: { sender_id: { user_id: 'u_123' } },
      message: {
        message_id: 'msg_003',
        chat_id: 'chat_001',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
    };

    const result = bot.parseMessage(event);

    expect(result).not.toBeNull();
    expect(result!.messageType).toBe('text');
    expect(result!.content).toBe('hello');
    expect(result!.fileKey).toBeUndefined();
  });
});

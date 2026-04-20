import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({
    im: {
      message: {
        create: vi.fn(),
        patch: vi.fn(),
        reply: vi.fn(),
        resources: vi.fn(),
      },
      messageReaction: { create: vi.fn(), delete: vi.fn() },
      file: { create: vi.fn() },
      image: { create: vi.fn() },
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

describe('FeishuBot file operations', () => {
  let bot: FeishuBot;
  let tmpDir: string;

  beforeEach(() => {
    bot = new FeishuBot();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloadResource should call im.message.resources and write file', async () => {
    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    (bot as any).client.im.message.resources = vi.fn().mockResolvedValue({
      writeFile: mockWriteFile,
    });

    const destPath = path.join(tmpDir, 'test.pdf');
    await bot.downloadResource('msg_001', 'file_key_abc', 'file', destPath);

    expect((bot as any).client.im.message.resources).toHaveBeenCalledWith({
      path: { message_id: 'msg_001', file_key: 'file_key_abc' },
      params: { type: 'file' },
    });
    expect(mockWriteFile).toHaveBeenCalledWith(destPath);
  });

  it('uploadFile should call im.file.create and return file_key', async () => {
    (bot as any).client.im.file.create = vi.fn().mockResolvedValue({
      data: { file_key: 'uploaded_file_key' },
    });

    const testFile = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(testFile, 'hello');

    const fileKey = await bot.uploadFile(testFile, 'test.txt');

    expect(fileKey).toBe('uploaded_file_key');
  });

  it('uploadImage should call im.image.create and return image_key', async () => {
    (bot as any).client.im.image.create = vi.fn().mockResolvedValue({
      data: { image_key: 'uploaded_image_key' },
    });

    const testFile = path.join(tmpDir, 'test.png');
    fs.writeFileSync(testFile, 'fake-png-data');

    const imageKey = await bot.uploadImage(testFile);

    expect(imageKey).toBe('uploaded_image_key');
  });

  it('sendFileMessage should send a file type message', async () => {
    (bot as any).client.im.message.create = vi.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'msg_sent' },
    });

    await bot.sendFileMessage('chat_001', 'file_key_abc', 'report.pdf');

    expect((bot as any).client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat_001',
        msg_type: 'file',
        content: JSON.stringify({ file_key: 'file_key_abc' }),
      },
    });
  });

  it('sendImageMessage should send an image type message', async () => {
    (bot as any).client.im.message.create = vi.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'msg_sent' },
    });

    await bot.sendImageMessage('chat_001', 'img_key_abc');

    expect((bot as any).client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat_001',
        msg_type: 'image',
        content: JSON.stringify({ image_key: 'img_key_abc' }),
      },
    });
  });
});

// tests/card-action-file.test.ts
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { pendingFileUploads } from '../src/state';

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({
    updateCard: vi.fn(async () => {}),
    sendText: vi.fn(async () => {}),
    downloadResource: vi.fn(async () => {}),
  }),
}));

// Module import triggers handler registration.
import { handleCardAction } from '../src/handlers/card-action';

beforeEach(() => pendingFileUploads.clear());
afterEach(() => pendingFileUploads.clear());

describe('fileOverwrite card action (registered handler)', () => {
  test('cancel click resolves the pending upload without touching disk', async () => {
    pendingFileUploads.set('conv-1', {
      messageId: 'om_1',
      fileKey: 'fk',
      fileName: 'x.txt',
      resourceType: 'file',
    });

    const result = await handleCardAction({
      action: {
        value: {
          kind: 'fileOverwrite',
          conversationId: 'conv-1',
          choice: 'cancel',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    expect(result.toast?.type).toBe('success');
    expect(pendingFileUploads.has('conv-1')).toBe(false);
  });

  test('non-requester click is rejected with warning and leaves pending entry', async () => {
    pendingFileUploads.set('conv-1', {
      messageId: 'om_1',
      fileKey: 'fk',
      fileName: 'x.txt',
      resourceType: 'file',
    });

    const result = await handleCardAction({
      action: {
        value: {
          kind: 'fileOverwrite',
          conversationId: 'conv-1',
          choice: 'overwrite',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_STRANGER' },
    });

    expect(result.toast?.type).toBe('warning');
    expect(pendingFileUploads.has('conv-1')).toBe(true);
  });

  test('unknown conversationId returns expired warning', async () => {
    const result = await handleCardAction({
      action: {
        value: {
          kind: 'fileOverwrite',
          conversationId: 'conv-MISSING',
          choice: 'overwrite',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    expect(result.toast?.type).toBe('warning');
  });
});

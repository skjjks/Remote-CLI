import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const updateCard = vi.fn(async () => {});

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({ updateCard }),
}));

// Module side-effect registers the handlers.
import { handleCardAction } from '../src/handlers/card-action';

describe('editSave card action', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'edit-save-test-'));
    updateCard.mockClear();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('save writes form_value.content to disk and returns success toast', async () => {
    const p = join(tmpDir, 'f.txt');
    writeFileSync(p, 'old content');

    const result = await handleCardAction({
      action: {
        value: { kind: 'editSave', path: p, requesterOpenId: 'ou_1' },
        form_value: { content: 'new content' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    expect(result.toast?.type).toBe('success');
    expect(readFileSync(p, 'utf-8')).toBe('new content');
    expect(updateCard).toHaveBeenCalledOnce();
  });

  test('non-requester click is rejected with warning; file unchanged', async () => {
    const p = join(tmpDir, 'f.txt');
    writeFileSync(p, 'old');

    const result = await handleCardAction({
      action: {
        value: { kind: 'editSave', path: p, requesterOpenId: 'ou_1' },
        form_value: { content: 'should not be written' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_stranger' },
    });

    expect(result.toast?.type).toBe('warning');
    expect(readFileSync(p, 'utf-8')).toBe('old');
    expect(updateCard).not.toHaveBeenCalled();
  });

  test('cancel does not write and returns info toast', async () => {
    const p = join(tmpDir, 'f.txt');
    writeFileSync(p, 'untouched');

    const result = await handleCardAction({
      action: {
        value: { kind: 'editCancel', path: p, requesterOpenId: 'ou_1' },
        form_value: { content: 'should not be written' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    expect(result.toast?.type).toBe('info');
    expect(readFileSync(p, 'utf-8')).toBe('untouched');
    expect(updateCard).toHaveBeenCalledOnce();
  });
});

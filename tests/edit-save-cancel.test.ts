import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvedEditCards } from '../src/state';

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
    resolvedEditCards.clear();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resolvedEditCards.clear();
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
    expect(result.card).toEqual({
      type: 'raw',
      data: expect.objectContaining({ schema: '2.0' }),
    });
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
    expect(result.card).toBeUndefined();
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
    expect(result.card).toEqual({
      type: 'raw',
      data: expect.objectContaining({ schema: '2.0' }),
    });
  });

  test('save clicked twice: second click is warning; file not rewritten', async () => {
    const p = join(tmpDir, 'f.txt');
    writeFileSync(p, 'old');

    await handleCardAction({
      action: {
        value: { kind: 'editSave', path: p, requesterOpenId: 'ou_1' },
        form_value: { content: 'first save' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_dup' },
      operator: { open_id: 'ou_1' },
    });
    expect(readFileSync(p, 'utf-8')).toBe('first save');

    writeFileSync(p, 'tampered on disk by someone else');

    const secondResult = await handleCardAction({
      action: {
        value: { kind: 'editSave', path: p, requesterOpenId: 'ou_1' },
        form_value: { content: 'second save SHOULD NOT OVERWRITE' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_dup' },
      operator: { open_id: 'ou_1' },
    });

    expect(secondResult.toast?.type).toBe('warning');
    expect(readFileSync(p, 'utf-8')).toBe('tampered on disk by someone else');
    expect(secondResult.card).toBeUndefined();
  });

  test('cancel clicked twice: second click is warning; no replacement card returned', async () => {
    const p = join(tmpDir, 'f.txt');
    writeFileSync(p, 'x');

    await handleCardAction({
      action: {
        value: { kind: 'editCancel', path: p, requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_cancel' },
      operator: { open_id: 'ou_1' },
    });

    const secondResult = await handleCardAction({
      action: {
        value: { kind: 'editCancel', path: p, requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_cancel' },
      operator: { open_id: 'ou_1' },
    });

    expect(secondResult.toast?.type).toBe('warning');
    expect(secondResult.card).toBeUndefined();
  });
});

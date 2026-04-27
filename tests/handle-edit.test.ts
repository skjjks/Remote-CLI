import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lastRequester } from '../src/state';

const sendText = vi.fn(async () => {});
const sendCard = vi.fn(async () => 'om_fake' as string | undefined);

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({ sendText, sendCard }),
}));

import { handleEdit } from '../src/handlers/file';

describe('handleEdit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'handle-edit-test-'));
    sendText.mockClear();
    sendCard.mockClear();
    lastRequester.clear();
    lastRequester.set('conv-1', 'ou_user');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    lastRequester.clear();
  });

  test('no path argument → sends usage text', async () => {
    await handleEdit('conv-1', undefined);
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0][1]).toMatch(/Usage.*!edit/i);
    expect(sendCard).not.toHaveBeenCalled();
  });

  test('nonexistent file → sends "not found" text', async () => {
    await handleEdit('conv-1', join(tmpDir, 'missing.txt'));
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0][1]).toMatch(/not found/i);
    expect(sendCard).not.toHaveBeenCalled();
  });

  test('binary file → sends "cannot edit binary" text', async () => {
    const p = join(tmpDir, 'bin');
    writeFileSync(p, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await handleEdit('conv-1', p);
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0][1]).toMatch(/binary/i);
    expect(sendCard).not.toHaveBeenCalled();
  });

  test('too-large file (> 5000 bytes) → sends size text', async () => {
    const p = join(tmpDir, 'big.txt');
    writeFileSync(p, 'x'.repeat(6000));
    await handleEdit('conv-1', p);
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0][1]).toMatch(/too large|vim/i);
    expect(sendCard).not.toHaveBeenCalled();
  });

  test('happy path → sends edit form card', async () => {
    const p = join(tmpDir, 'ok.yaml');
    writeFileSync(p, 'port: 8080\n');
    await handleEdit('conv-1', p);
    expect(sendCard).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
    const card = sendCard.mock.calls[0][1] as any;
    expect(card.schema).toBe('2.0');
    expect(card.body.elements[0].tag).toBe('form');
  });
});

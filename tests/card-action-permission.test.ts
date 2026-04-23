// tests/card-action-permission.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { pendingRequests, lastRequester } from '../src/state';
import { createPendingRequest } from '../src/ai/shared';

// Mock feishu BEFORE importing the card-action module, because the permission
// handler calls getFeishuBot().updateCard() on a real click.
vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({ updateCard: vi.fn(async () => {}) }),
}));

// Module side-effect — registers the 'permission' handler on load.
import { handleCardAction } from '../src/handlers/card-action';

beforeEach(() => {
  lastRequester.clear();
});

afterEach(() => {
  for (const k of [...pendingRequests.keys()]) {
    const e = pendingRequests.get(k);
    if (e) clearTimeout(e.timer);
    pendingRequests.delete(k);
  }
  lastRequester.clear();
});

describe('permission card action (registered handler)', () => {
  test('allow click resolves the pending request with behavior allow', async () => {
    // Simulate a user sending a message first so lastRequester is populated.
    lastRequester.set('conv-1', 'ou_1');

    let resolved: (v: unknown) => void = () => {};
    const p = new Promise((r) => (resolved = r));
    const id = createPendingRequest('permission', 'conv-1', resolved, 10_000);
    // createPendingRequest auto-reads lastRequester → entry.requesterOpenId = 'ou_1'
    pendingRequests.get(id)!.messageId = 'om_1';

    const result = await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: id, choice: 'allow', requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    await expect(p).resolves.toEqual({ behavior: 'allow' });
    expect(result.toast?.type).toBe('success');
    expect(pendingRequests.has(id)).toBe(false);
  });

  test('deny click resolves with behavior deny', async () => {
    lastRequester.set('conv-1', 'ou_1');
    let resolved: (v: unknown) => void = () => {};
    const p = new Promise((r) => (resolved = r));
    const id = createPendingRequest('permission', 'conv-1', resolved, 10_000);

    await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: id, choice: 'deny', requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    await expect(p).resolves.toMatchObject({ behavior: 'deny' });
  });

  test('allow_always resolves with updatedPermissions attached', async () => {
    lastRequester.set('conv-1', 'ou_1');
    let resolved: (v: unknown) => void = () => {};
    const p = new Promise((r) => (resolved = r));
    const id = createPendingRequest('permission', 'conv-1', resolved, 10_000);

    await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: id, choice: 'allow_always', requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });

    const r = (await p) as { behavior: string; updatedPermissions?: unknown[] };
    expect(r.behavior).toBe('allow');
    expect(r.updatedPermissions?.length).toBeGreaterThan(0);
  });

  test('non-requester click returns warning and leaves pending unresolved', async () => {
    lastRequester.set('conv-1', 'ou_1');
    let resolved: (v: unknown) => void = () => {};
    const p = new Promise((r) => (resolved = r));
    const id = createPendingRequest('permission', 'conv-1', resolved, 10_000);

    const result = await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: id, choice: 'allow', requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_STRANGER' },
    });

    expect(result.toast?.type).toBe('warning');
    expect(pendingRequests.has(id)).toBe(true);
    // Ensure the promise did NOT resolve.
    const race = await Promise.race([p, new Promise((r) => setTimeout(() => r('still-pending'), 10))]);
    expect(race).toBe('still-pending');
  });

  test('expired request id returns warning', async () => {
    const result = await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: 'never-existed', choice: 'allow', requesterOpenId: 'ou_1' },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });
    expect(result.toast?.type).toBe('warning');
    expect(result.toast?.content).toMatch(/expired/i);
  });
});

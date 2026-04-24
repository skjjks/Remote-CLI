// tests/pending-resolve-by-id.test.ts
import { describe, test, expect, afterEach } from 'vitest';
import { pendingRequests } from '../src/state';
import { createPendingRequest, resolvePendingRequestById } from '../src/ai/shared';

afterEach(() => {
  for (const key of [...pendingRequests.keys()]) {
    const entry = pendingRequests.get(key);
    if (entry) clearTimeout(entry.timer);
    pendingRequests.delete(key);
  }
});

describe('resolvePendingRequestById', () => {
  test('resolves a known request and removes it from the map', async () => {
    let resolved: any;
    const p = new Promise(r => (resolved = r));
    const id = createPendingRequest('permission', 'conv-1', resolved, 10000);
    // Optionally set requesterOpenId / messageId on the entry
    const entry = pendingRequests.get(id)!;
    entry.requesterOpenId = 'ou_1';
    entry.messageId = 'om_1';

    const ok = resolvePendingRequestById(id, { behavior: 'allow' });
    expect(ok).toBe(true);
    expect(pendingRequests.has(id)).toBe(false);
    await expect(p).resolves.toEqual({ behavior: 'allow' });
  });

  test('returns false for unknown id', () => {
    expect(resolvePendingRequestById('does-not-exist', {})).toBe(false);
  });
});

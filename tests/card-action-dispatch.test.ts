// tests/card-action-dispatch.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  handleCardAction,
  registerCardActionHandler,
  __resetCardActionRegistry__,
} from '../src/handlers/card-action';

beforeEach(() => __resetCardActionRegistry__());

describe('handleCardAction', () => {
  test('routes by value.kind to the registered handler', async () => {
    const spy = vi.fn(async () => ({ toast: { type: 'success', content: 'ok' } as const }));
    registerCardActionHandler('permission', spy);

    const result = await handleCardAction({
      action: {
        value: { kind: 'permission', requestId: 'r1', choice: 'allow', requesterOpenId: 'ou_1' },
      },
      context: {
        open_chat_id: 'oc_1',
        open_message_id: 'om_1',
      },
      operator: { open_id: 'ou_1' },
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      { kind: 'permission', requestId: 'r1', choice: 'allow', requesterOpenId: 'ou_1' },
      { chatId: 'oc_1', openId: 'ou_1', messageId: 'om_1' },
    );
    expect(result).toEqual({ toast: { type: 'success', content: 'ok' } });
  });

  test('unknown kind returns error toast without throwing', async () => {
    const result = await handleCardAction({
      action: { value: { kind: 'doesNotExist' } },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });
    expect(result).toEqual({
      toast: { type: 'error', content: 'Unknown action' },
    });
  });

  test('handler throw is caught and surfaced as error toast', async () => {
    registerCardActionHandler('permission', async () => {
      throw new Error('boom');
    });
    const result = await handleCardAction({
      action: { value: { kind: 'permission', requestId: 'r1', choice: 'allow', requesterOpenId: 'ou_1' } },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });
    expect(result).toEqual({
      toast: { type: 'error', content: 'Action failed' },
    });
  });

  test('malformed payload (no value) returns error toast', async () => {
    const result = await handleCardAction({ action: {}, context: {}, operator: {} });
    expect(result).toEqual({
      toast: { type: 'error', content: 'Invalid card action payload' },
    });
  });
});

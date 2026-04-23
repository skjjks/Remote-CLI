import type {
  CardActionContext,
  CardActionHandler,
  CardActionResult,
  CardActionValue,
} from '../bot/card-action-types';
import { pendingRequests, smartCard } from '../state';
import { resolvePendingRequestById } from '../ai/shared';
import { getFeishuBot } from '../bot/feishu';

const registry = new Map<string, CardActionHandler>();

export function registerCardActionHandler(kind: CardActionValue['kind'], handler: CardActionHandler): void {
  registry.set(kind, handler);
}

/** Test-only: reset the registry. Not exported from the public package surface. */
export function __resetCardActionRegistry__(): void {
  registry.clear();
}

/**
 * Handle a `card.action.trigger` payload from the Feishu WebSocket.
 *
 * Reads `action.value` (object), `context.open_chat_id`, `context.open_message_id`,
 * and `operator.open_id`. Dispatches to a registered handler by `value.kind`.
 * Never throws — returns a toast-only result on error so the SDK has
 * something to reply with inside the 3-second window.
 */
export async function handleCardAction(data: unknown): Promise<CardActionResult> {
  const d = (data ?? {}) as any;
  const value = d?.action?.value;
  const chatId = d?.context?.open_chat_id ?? d?.context?.chat_id;
  const messageId = d?.context?.open_message_id ?? d?.context?.message_id;
  const openId = d?.operator?.open_id ?? d?.operator?.user_id;

  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    console.warn('[CARD-ACTION] Invalid payload:', JSON.stringify(d).slice(0, 500));
    return { toast: { type: 'error', content: 'Invalid card action payload' } as const };
  }

  const ctx: CardActionContext = {
    chatId: chatId ?? '',
    openId: openId ?? '',
    messageId: messageId ?? '',
  };

  const handler = registry.get(value.kind);
  if (!handler) {
    console.warn('[CARD-ACTION] Unknown kind:', value.kind);
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }

  try {
    console.log('[CARD-ACTION]', { kind: value.kind, requestId: value.requestId, choice: value.choice, chatId: ctx.chatId, openId: ctx.openId });
    return await handler(value as CardActionValue, ctx);
  } catch (err) {
    console.error('[CARD-ACTION] Handler threw:', err);
    return { toast: { type: 'error', content: 'Action failed' } as const };
  }
}

registerCardActionHandler('permission', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'permission') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  const entry = pendingRequests.get(value.requestId);
  if (!entry) {
    return { toast: { type: 'warning', content: 'Request expired' } as const };
  }
  if (entry.requesterOpenId && entry.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the requester can answer this' } as const };
  }

  let resolved: unknown;
  switch (value.choice) {
    case 'allow':
      resolved = { behavior: 'allow' };
      break;
    case 'deny':
      resolved = { behavior: 'deny', message: 'Denied by user' };
      break;
    case 'allow_always':
      resolved = { behavior: 'allow', updatedPermissions: [{ type: 'allow_always' }] };
      break;
  }
  resolvePendingRequestById(value.requestId, resolved);

  const statusText =
    value.choice === 'allow'
      ? '✓ Allowed'
      : value.choice === 'allow_always'
        ? '✓✓ Allowed (Always)'
        : '✗ Denied';
  const statusColor: 'green' | 'red' = value.choice === 'deny' ? 'red' : 'green';

  if (ctx.messageId) {
    const resolvedCard = smartCard.buildResolvedCardV2({
      title: 'Permission request',
      bodyMarkdown: '',
      statusText,
      statusColor,
    });
    await getFeishuBot().updateCard(ctx.messageId, resolvedCard);
  }

  return {
    toast: {
      type: value.choice === 'deny' ? 'info' : 'success',
      content: statusText,
    } as const,
  };
});

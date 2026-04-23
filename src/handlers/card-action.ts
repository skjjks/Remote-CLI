import type {
  CardActionContext,
  CardActionHandler,
  CardActionResult,
  CardActionValue,
} from '../bot/card-action-types';

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

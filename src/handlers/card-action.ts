import * as fs from 'node:fs';
import type {
  CardActionContext,
  CardActionHandler,
  CardActionResult,
  CardActionValue,
} from '../bot/card-action-types';
import { pendingRequests, smartCard, modelOverrides, activeSessions, resolvedEditCards } from '../state';
import { resolvePendingRequestById } from '../ai/shared';
import { getFeishuBot } from '../bot/feishu';
import { handleFileOverwriteResponse } from './file';
import { resolveModel } from '../ai/models';
import { getSessionManager } from '../terminal/session';
import * as tmux from '../terminal/tmux';

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
  const formValue = (d?.action?.form_value ?? undefined) as Record<string, string> | undefined;

  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    console.warn('[CARD-ACTION] Invalid payload:', JSON.stringify(d).slice(0, 500));
    return { toast: { type: 'error', content: 'Invalid card action payload' } as const };
  }

  const ctx: CardActionContext = {
    chatId: chatId ?? '',
    openId: openId ?? '',
    messageId: messageId ?? '',
    formValue,
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

registerCardActionHandler('fileOverwrite', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'fileOverwrite') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  if (value.requesterOpenId && value.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the uploader can answer this' } as const };
  }

  const digit = value.choice === 'overwrite' ? '1' : '0';
  const ok = await handleFileOverwriteResponse(value.conversationId, digit);
  if (!ok) {
    return { toast: { type: 'warning', content: 'Request expired' } as const };
  }

  if (ctx.messageId) {
    const resolvedCard = smartCard.buildResolvedCardV2({
      title: '📁 File already exists',
      bodyMarkdown: '',
      statusText: value.choice === 'overwrite' ? '✓ Overwriting…' : '✗ Upload cancelled',
      statusColor: value.choice === 'overwrite' ? 'green' : 'red',
    });
    await getFeishuBot().updateCard(ctx.messageId, resolvedCard);
  }

  return {
    toast: {
      type: 'success',
      content: value.choice === 'overwrite' ? 'Overwriting' : 'Cancelled',
    } as const,
  };
});

registerCardActionHandler('modelSwitch', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'modelSwitch') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  if (value.requesterOpenId && value.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the requester can use this menu' } as const };
  }

  let statusText: string;
  if (value.choice === 'reset') {
    modelOverrides.delete(ctx.chatId);
    statusText = 'Model reset to default';
  } else {
    const resolved = resolveModel(value.backend, value.choice);
    modelOverrides.set(ctx.chatId, resolved);
    statusText = `Model: ${resolved}`;
  }

  if (ctx.messageId) {
    const resolvedCard = smartCard.buildResolvedCardV2({
      title: '🎯 Model',
      bodyMarkdown: '',
      statusText: `✓ ${statusText}`,
      statusColor: 'green',
    });
    await getFeishuBot().updateCard(ctx.messageId, resolvedCard);
  }

  return {
    toast: { type: 'success', content: statusText } as const,
  };
});

registerCardActionHandler('sessionSwitch', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'sessionSwitch') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  if (value.requesterOpenId && value.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the requester can use this menu' } as const };
  }

  const sessionManager = getSessionManager();
  let statusText: string;
  let statusColor: 'green' | 'red' = 'green';

  if (value.choice.type === 'existing') {
    const sessionId = value.choice.sessionId;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      statusText = `✗ Session #${sessionId} no longer exists`;
      statusColor = 'red';
    } else if (session.conversationId && session.conversationId !== ctx.chatId) {
      statusText = `✗ Session #${sessionId} belongs to another conversation`;
      statusColor = 'red';
    } else if (session.type === 'terminal' && session.tmuxName) {
      const alive = await tmux.sessionExists(session.tmuxName);
      if (!alive) {
        statusText = `✗ Session #${sessionId} no longer exists`;
        statusColor = 'red';
      } else {
        activeSessions.set(ctx.chatId, sessionId);
        statusText = `✓ Switched to #${sessionId} ${session.type}`;
      }
    } else {
      activeSessions.set(ctx.chatId, sessionId);
      statusText = `✓ Switched to #${sessionId} ${session.type}`;
    }
  } else {
    const backend = value.choice.backend;
    let session;
    if (backend === 'claude') {
      session = sessionManager.createClaudeSession(ctx.chatId);
    } else if (backend === 'opencode') {
      session = sessionManager.createOpencodeSession(ctx.chatId);
    } else {
      session = await sessionManager.createSession(ctx.chatId);
    }
    activeSessions.set(ctx.chatId, session.id);
    statusText = `✓ Created #${session.id} ${backend}`;
  }

  if (ctx.messageId) {
    const resolvedCard = smartCard.buildResolvedCardV2({
      title: '💼 Sessions',
      bodyMarkdown: '',
      statusText,
      statusColor,
    });
    await getFeishuBot().updateCard(ctx.messageId, resolvedCard);
  }

  return {
    toast: { type: statusColor === 'red' ? 'warning' : 'success', content: statusText } as const,
  };
});

registerCardActionHandler('editSave', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'editSave') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  if (value.requesterOpenId && value.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the original editor can save' } as const };
  }

  if (ctx.messageId && resolvedEditCards.has(ctx.messageId)) {
    return {
      toast: {
        type: 'warning',
        content: 'Already saved. Run !edit again to make more changes.',
      } as const,
    };
  }

  const content = ctx.formValue?.content;
  if (typeof content !== 'string') {
    return { toast: { type: 'error', content: 'No content received' } as const };
  }

  // Atomic write: write to .tmp, then rename. Protects against partial writes.
  const tmpPath = `${value.path}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, value.path);
  } catch (err) {
    return {
      toast: {
        type: 'error',
        content: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      } as const,
    };
  }

  if (ctx.messageId) resolvedEditCards.add(ctx.messageId);

  // Form submit response: return the replacement card INSIDE the response body.
  // Feishu's form_submit protocol requires { card: { type: 'raw', data: <JSON> } }
  // for in-place card replacement. Using updateCard here instead would race the
  // form_submit response and not reliably hide the form UI on mobile clients.
  const byteSize = Buffer.byteLength(content, 'utf-8');
  const savedCard = smartCard.buildEditSavedCard({ path: value.path, byteSize });

  return {
    toast: { type: 'success', content: 'Saved' } as const,
    card: { type: 'raw', data: savedCard },
  };
});

registerCardActionHandler('editCancel', async (value, ctx): Promise<CardActionResult> => {
  if (value.kind !== 'editCancel') {
    return { toast: { type: 'error', content: 'Unknown action' } as const };
  }
  if (value.requesterOpenId && value.requesterOpenId !== ctx.openId) {
    return { toast: { type: 'warning', content: 'Only the original editor can cancel' } as const };
  }

  if (ctx.messageId && resolvedEditCards.has(ctx.messageId)) {
    return {
      toast: {
        type: 'warning',
        content: 'This edit is already closed. Run !edit again if needed.',
      } as const,
    };
  }

  if (ctx.messageId) resolvedEditCards.add(ctx.messageId);

  const cancelledCard = smartCard.buildEditCancelledCard({ path: value.path });

  return {
    toast: { type: 'info', content: 'Cancelled' } as const,
    card: { type: 'raw', data: cancelledCard },
  };
});

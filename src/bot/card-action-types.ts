// src/bot/card-action-types.ts

/**
 * Discriminated union of all interactive card button payloads.
 * `kind` is the dispatch key; `requestId` (when present) ties the click to a
 * pending request; `requesterOpenId` restricts who may resolve it.
 */
export type CardActionValue =
  | {
      kind: 'permission';
      requestId: string;
      choice: 'allow' | 'deny' | 'allow_always';
      requesterOpenId: string;
    }
  | {
      kind: 'fileOverwrite';
      conversationId: string;
      choice: 'overwrite' | 'cancel';
      requesterOpenId: string;
    }
  | {
      kind: 'modelSwitch';
      choice: string;
      backend: 'claude' | 'opencode';
      requesterOpenId: string;
    }
  | {
      kind: 'sessionSwitch';
      choice:
        | { type: 'existing'; sessionId: number }
        | { type: 'new'; backend: 'claude' | 'opencode' | 'terminal' };
      requesterOpenId: string;
    };

/** Fields extracted from the WebSocket `card.action.trigger` payload. */
export interface CardActionContext {
  chatId: string;
  openId: string;
  messageId: string;
}

/** Shape returned by a handler — forwarded verbatim to Feishu. */
export interface CardActionResult {
  toast?: {
    type: 'success' | 'info' | 'warning' | 'error';
    content: string;
  };
  card?: object;
}

export type CardActionHandler = (
  value: CardActionValue,
  ctx: CardActionContext,
) => Promise<CardActionResult> | CardActionResult;

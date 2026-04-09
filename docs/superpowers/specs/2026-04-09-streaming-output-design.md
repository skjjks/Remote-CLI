# Streaming Output — Card Real-time PATCH

## Overview

Change Claude output delivery from "wait until complete, send one card" to "send card immediately, PATCH update every 1 second as new content arrives." This gives users real-time visibility into what Claude is doing.

## Current Behavior

`pollForResponse` polls `tmux capture-pane` every 500ms. When content is stable for 3 consecutive polls (~1.5s of no change), it extracts the new output, cleans it, and sends **one card**. The user sees nothing until Claude finishes.

## New Behavior

1. **Immediately after sending a message**: create a card with "thinking..." placeholder. Store the `messageId`.
2. **Every 1 second**: capture pane, extract new output, diff against last sent content.
   - If content changed: PATCH the card with updated content.
   - If content unchanged: increment stable counter.
3. **When stable for 3 polls (3 seconds of no change)**: final PATCH with metadata footer (model, cwd, context %). Done.

## Architecture

Only `src/claude/manager.ts` `pollForResponse` changes. The card creation/update methods already exist.

### Modified: `pollForResponse`

```
pollForResponse(conversationId, session, beforeContent):
  1. callbacks.onStreamStart(conversationId) → creates card, returns messageId
  2. lastSentContent = ""
  3. loop every 1000ms:
     a. captured = tmux.capturePane(session.tmuxName)
     b. newOutput = extractNewOutput(beforeContent, captured)
     c. cleaned = cleanClaudeOutput(newOutput)
     d. menu = detectMenu(captured)
     e. if menu → callbacks.onMenu(...); return
     f. if cleaned !== lastSentContent:
        - callbacks.onStreamUpdate(conversationId, messageId, cleaned)
        - lastSentContent = cleaned
        - stableCount = 0
     g. else: stableCount++
     h. if stableCount >= 3:
        - metadata = extractMetadata(captured)
        - callbacks.onStreamEnd(conversationId, messageId, cleaned, metadata)
        - return
     i. if timeout exceeded → callbacks.onError(...)
```

### Callbacks Change

```typescript
// Before
interface ClaudeManagerCallbacks {
  onOutput: (conversationId: string, output: string, metadata: ClaudeMetadata) => void;
  onMenu: (...) => void;
  onError: (...) => void;
}

// After
interface ClaudeManagerCallbacks {
  onStreamStart: (conversationId: string) => Promise<string>;  // returns messageId
  onStreamUpdate: (conversationId: string, messageId: string, content: string) => void;
  onStreamEnd: (conversationId: string, messageId: string, content: string, metadata: ClaudeMetadata) => void;
  onMenu: (...) => void;
  onError: (...) => void;
}
```

### Card States

**Start** (thinking):
```
┌─────────────────────┐
│ Claude              │  template: purple
├─────────────────────┤
│ thinking...         │
└─────────────────────┘
```

**Update** (streaming content):
```
┌─────────────────────┐
│ Claude              │
├─────────────────────┤
│ (current output)    │  ← PATCH updates this
│ ...                 │
└─────────────────────┘
```

**End** (final with footer):
```
┌─────────────────────┐
│ Claude              │
├─────────────────────┤
│ (complete output)   │
├─────────────────────┤
│ Opus 4.6 · ~/ · 5% │  ← metadata footer added
└─────────────────────┘
```

## Files Changed

| File | Change |
|------|--------|
| `src/claude/manager.ts` | Rewrite `pollForResponse` to stream; update `ClaudeManagerCallbacks` |
| `src/index.ts` | Update callback implementations for stream start/update/end |
| `src/bot/card.ts` | No change — `buildTextCard` + `updateCard` already sufficient |

## Constraints

- **PATCH interval**: minimum 1 second between updates (avoid Feishu API rate limits)
- **Timeout**: same as current (`config.claude.timeout`, default 5 min)
- **Stability threshold**: 3 consecutive identical captures (3 seconds) = done
- **Menu detection**: checked every poll; if detected, stop streaming and send menu card instead

## Error Handling

- PATCH fails (API error): log and continue polling, don't abort the stream
- Timeout: send error card, stop polling
- Process dies: tmux session gone → capture-pane throws → send error card

## Testing

- Unit test: mock `capturePane` returning changing content, verify callbacks fire in order (start → update → update → end)
- Manual test: send a complex prompt to Claude, verify card updates in real-time in Feishu

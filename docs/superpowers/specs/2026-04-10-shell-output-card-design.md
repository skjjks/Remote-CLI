# Shell Output Card Visual Hierarchy

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Improve `buildTerminalOutputCard` in `src/bot/card.ts` to add visual hierarchy to shell command output in Feishu

## Problem

All shell output in Feishu is displayed identically: raw text wrapped in a plain code block with no syntax highlighting, no error indication, and no visual differentiation between a 1-line `echo` and a 200-line `docker build`. Users must scan undifferentiated monospace text to find what matters.

## Solution: Structured Card with Visual Layers

Four targeted improvements to the existing `buildTerminalOutputCard`, no architectural changes.

### 1. ANSI Escape Sequence Stripping

**What:** Strip all ANSI CSI sequences from terminal output before rendering.

**Where:** New private method `stripAnsi(text: string): string` in `SmartCardBuilder`, called at the entry of `buildTerminalOutputCard`.

**Regex:** `/\x1b\[[0-9;]*[a-zA-Z]/g` — covers color/style codes, cursor positioning, screen clearing.

**Why first:** Without this, all other formatting improvements are undermined by visible escape characters.

### 2. Syntax Highlight Detection

**What:** Auto-detect output content type and specify the code block language for syntax highlighting.

**Where:** New function `detectOutputLanguage(output: string): string` in `src/bot/card.ts`.

**Detection rules (priority order):**

| Priority | Condition | Language |
|----------|-----------|----------|
| 1 | Trimmed output starts with `{` or `[` | `json` |
| 2 | Multiple lines starting with `+`, `-`, `@@`, or `diff --` | `diff` |
| 3 | Multiple lines matching `key: value` pattern, or starts with `---` | `yaml` |
| 4 | Default fallback | `bash` |

**Trade-off:** Simple heuristic, will occasionally guess wrong. Acceptable because wrong syntax highlighting is strictly better than no highlighting — the output is still fully readable.

### 3. Error Detection and Card Color

**What:** Change the card header color from blue to red when the output contains error indicators.

**Where:** New function `hasErrorIndicators(output: string): boolean` in `src/bot/card.ts`.

**Error patterns (case-insensitive search):**
- `error:`, `Error:`, `ERROR`
- `fatal:`, `FATAL`
- `command not found`
- `Permission denied`
- `No such file or directory`
- Non-zero exit code patterns: `exit code`, `exited with`

**Card color logic:**
- Error detected → header template `red`
- No error → header template `blue` (unchanged)

### 4. Short Output Optimization + Duration Display

**Short output (<=3 lines, no special format):**
- Render as plain markdown text (bold) instead of a code block
- Example: `echo hello` → card body shows **hello** instead of a code block containing "hello"
- Threshold: <=3 lines AND no JSON/diff/yaml detected AND output is not `(no output)`

**Duration display:**
- Record `Date.now()` before sending tmux keys in `handleShellCommand`
- Calculate elapsed time after capture
- Pass `durationMs` to `buildTerminalOutputCard` via opts
- Display in footer as `1.5s` alongside existing Session ID and cwd

**Updated opts interface:**
```typescript
interface TerminalOutputOpts {
  command?: string;
  sessionId?: number;
  cwd?: string;
  durationMs?: number;  // new
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/bot/card.ts` | Add `stripAnsi`, `detectOutputLanguage`, `hasErrorIndicators`; update `buildTerminalOutputCard` |
| `src/handlers/terminal.ts` | Add timing to `handleShellCommand`; pass `durationMs` to card builder |
| `src/index.ts` | Add timing to default terminal message handler (lines 136-178) |

## Out of Scope

- AI output cards (Claude/opencode) — separate effort
- Live streaming of long-running commands
- Interactive program (vim/htop) display
- ANSI-to-rich-text conversion (we strip, not convert)
- Collapsible/expandable card sections (Feishu doesn't support this)

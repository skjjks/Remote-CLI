# Project Instructions

## Project Overview

Remote CLI is a Feishu (Lark) Bot for remote terminal control and AI coding assistant interaction. Key modules:

- `src/bot/card.ts` — Feishu card builder (SmartCardBuilder) with ANSI stripping, syntax highlight detection, error coloring, short output optimization
- `src/bot/feishu.ts` — Feishu API client (WebSocket mode, no card action callbacks)
- `src/handlers/terminal.ts` — Shell command execution via tmux, output extraction
- `src/handlers/ai.ts` — Claude/opencode command routing
- `src/ai/drivers/claude-sdk.ts` — Claude Agent SDK streaming driver
- `src/ai/drivers/opencode-sdk.ts` — opencode SDK event loop driver
- `src/terminal/interactive.ts` — Interactive program detection + shortcut key mapping

## Development

- **Test framework:** vitest (`npm test`)
- **Build:** `tsc` (`npm run build`)
- **Deploy:** `npm run deploy` (PM2 cluster mode)
- **Terminal width:** 200 columns default — wide enough for pm2 tables

## Gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available Skills

- `/office-hours` - YC Office Hours forcing questions for startups
- `/plan-ceo-review` - CEO/founder-mode plan review
- `/plan-eng-review` - Eng manager-mode plan review
- `/plan-design-review` - Designer's eye plan review
- `/design-consultation` - Design system consultation
- `/review` - Pre-landing PR review
- `/ship` - Ship workflow with tests, review, version bump
- `/land-and-deploy` - Merge PR, wait for CI/deploy, verify production
- `/canary` - Post-deploy canary monitoring
- `/benchmark` - Performance regression detection
- `/browse` - Headless browser for QA testing
- `/qa` - Systematic QA testing with bug fixes
- `/qa-only` - Report-only QA testing
- `/design-review` - Designer's eye QA for visual issues
- `/setup-browser-cookies` - Import cookies from Chromium
- `/setup-deploy` - Configure deployment settings
- `/retro` - Weekly engineering retrospective
- `/investigate` - Systematic debugging with root cause analysis
- `/document-release` - Post-ship documentation update
- `/codex` - OpenAI Codex CLI wrapper for code review
- `/cso` - Chief Security Officer infrastructure audit
- `/careful` - Safety guardrails for destructive commands
- `/freeze` - Restrict file edits to a specific directory
- `/guard` - Full safety mode (destructive warnings + scoped edits)
- `/unfreeze` - Clear the freeze boundary
- `/gstack-upgrade` - Upgrade gstack to latest version

### Troubleshooting

If gstack skills aren't working, run:
```bash
cd .claude/skills/gstack && ./setup
```
This rebuilds the binary and registers all skills.

## graphify

A knowledge graph of this codebase lives at `graphify-out/graph.json` (305 nodes, 657 edges, 33 communities).

**Before answering codebase architecture questions**, check the graph first:
```
/graphify query "<question>"
```

**After making code changes**, the graph auto-updates for code-only changes if `--watch` is running. For doc changes, run:
```
/graphify . --update
```

Key outputs:
- `graphify-out/graph.html` — interactive visualization (open in browser)
- `graphify-out/GRAPH_REPORT.md` — audit report with god nodes, surprising connections
- `graphify-out/graph.json` — raw graph data for queries

To uninstall: remove this `## graphify` section from CLAUDE.md.

# Project Instructions

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

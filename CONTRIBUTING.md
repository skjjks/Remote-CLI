# Contributing to Remote CLI

Thanks for your interest in contributing!

## Prerequisites

- Node.js >= 18
- tmux
- A Feishu (Lark) bot with WebSocket enabled

## Getting Started

```bash
# Clone and install
git clone https://github.com/<your-org>/remote-cli.git
cd remote-cli
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Feishu bot credentials

# Run in development
npm run dev
```

## Development Workflow

1. Fork the repo and create a feature branch
2. Make your changes
3. Run tests: `npm test`
4. Run lint: `npm run lint`
5. Run dead code check: `npm run deadcode`
6. Submit a pull request

## Code Style

- TypeScript with `strict: true`
- ESLint enforced (see `.eslintrc.json`)
- Prefix unused variables with `_`
- Use conventional commit messages: `feat:`, `fix:`, `chore:`, `docs:`

## Project Structure

```
src/
  index.ts           # Entry point + message routing
  config.ts          # Configuration management
  state.ts           # Global state
  ai/                # AI backend abstraction (Claude, OpenCode)
  bot/               # Feishu bot integration
  handlers/          # Command handlers
  terminal/          # Tmux session management
  claude/            # Claude output parsing
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Tests live in `tests/` and use [Vitest](https://vitest.dev/).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

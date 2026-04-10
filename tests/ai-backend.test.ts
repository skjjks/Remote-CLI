import { describe, it, expect } from 'vitest';
import { CLAUDE_BACKEND, OPENCODE_BACKEND } from '../src/ai/backend';

describe('AI backend configs', () => {
  it('CLAUDE_BACKEND has correct name and commands', () => {
    expect(CLAUDE_BACKEND.name).toBe('claude');
    expect(CLAUDE_BACKEND.startCommand).toBe('claude');
    expect(CLAUDE_BACKEND.startCommandAuto).toBe('claude --dangerously-skip-permissions');
    expect(CLAUDE_BACKEND.logPrefix).toBe('[CLAUDE]');
  });

  it('OPENCODE_BACKEND has correct name and commands', () => {
    expect(OPENCODE_BACKEND.name).toBe('opencode');
    expect(OPENCODE_BACKEND.startCommand).toBe('opencode');
    expect(OPENCODE_BACKEND.startCommandAuto).toBe('opencode --pure');
    expect(OPENCODE_BACKEND.logPrefix).toBe('[OPENCODE]');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { commandHistory, addToHistory } from '../src/state';

describe('Command History', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  it('addToHistory stores commands for a conversation', () => {
    addToHistory('conv1', 'ls -la');
    addToHistory('conv1', 'pwd');

    const history = commandHistory.get('conv1');
    expect(history).toEqual(['ls -la', 'pwd']);
  });

  it('addToHistory keeps conversations separate', () => {
    addToHistory('conv1', 'ls');
    addToHistory('conv2', 'pwd');

    expect(commandHistory.get('conv1')).toEqual(['ls']);
    expect(commandHistory.get('conv2')).toEqual(['pwd']);
  });

  it('addToHistory enforces MAX_HISTORY_SIZE of 50', () => {
    for (let i = 0; i < 60; i++) {
      addToHistory('conv1', `cmd-${i}`);
    }

    const history = commandHistory.get('conv1')!;
    expect(history.length).toBe(50);
    // First 10 should have been shifted out
    expect(history[0]).toBe('cmd-10');
    expect(history[49]).toBe('cmd-59');
  });

  it('returns empty for unknown conversation', () => {
    expect(commandHistory.get('unknown')).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isInteractiveProgram, getShortcutKey } from '../src/terminal/interactive';

describe('raw mode routing logic', () => {
  describe('shouldUseRawMode', () => {
    it('should use raw mode when rawMode is forced true', () => {
      const rawMode: boolean | undefined = true;
      const currentCommand = 'bash';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });

    it('should not use raw mode when rawMode is undefined and shell is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'bash';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(false);
    });

    it('should auto-detect raw mode when vim is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'vim';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });

    it('should auto-detect raw mode when htop is running', () => {
      const rawMode: boolean | undefined = undefined;
      const currentCommand = 'htop';
      const result = rawMode === true || (rawMode === undefined && isInteractiveProgram(currentCommand));
      expect(result).toBe(true);
    });
  });

  describe('shortcut command resolution', () => {
    it('should resolve !esc to Escape key send', () => {
      const tmuxKey = getShortcutKey('esc');
      expect(tmuxKey).toBe('Escape');
    });

    it('should resolve !enter to Enter key send', () => {
      const tmuxKey = getShortcutKey('enter');
      expect(tmuxKey).toBe('Enter');
    });

    it('should not resolve !sh as a shortcut', () => {
      const tmuxKey = getShortcutKey('sh');
      expect(tmuxKey).toBeUndefined();
    });

    it('should not resolve !help as a shortcut', () => {
      const tmuxKey = getShortcutKey('help');
      expect(tmuxKey).toBeUndefined();
    });

    it('should not resolve !raw as a shortcut (it is a mode command)', () => {
      const tmuxKey = getShortcutKey('raw');
      expect(tmuxKey).toBeUndefined();
    });
  });
});

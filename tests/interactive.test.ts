import { describe, it, expect } from 'vitest';
import {
  isInteractiveProgram,
  SHORTCUT_COMMANDS,
  getShortcutKey,
} from '../src/terminal/interactive';

describe('interactive', () => {
  describe('isInteractiveProgram', () => {
    it('should detect vim as interactive', () => {
      expect(isInteractiveProgram('vim')).toBe(true);
    });

    it('should detect nvim as interactive', () => {
      expect(isInteractiveProgram('nvim')).toBe(true);
    });

    it('should detect nano as interactive', () => {
      expect(isInteractiveProgram('nano')).toBe(true);
    });

    it('should detect htop as interactive', () => {
      expect(isInteractiveProgram('htop')).toBe(true);
    });

    it('should detect less as interactive', () => {
      expect(isInteractiveProgram('less')).toBe(true);
    });

    it('should detect python as interactive', () => {
      expect(isInteractiveProgram('python')).toBe(true);
      expect(isInteractiveProgram('python3')).toBe(true);
    });

    it('should not detect bash as interactive', () => {
      expect(isInteractiveProgram('bash')).toBe(false);
    });

    it('should not detect zsh as interactive', () => {
      expect(isInteractiveProgram('zsh')).toBe(false);
    });

    it('should not detect fish as interactive', () => {
      expect(isInteractiveProgram('fish')).toBe(false);
    });

    it('should not detect empty string as interactive', () => {
      expect(isInteractiveProgram('')).toBe(false);
    });
  });

  describe('getShortcutKey', () => {
    it('should map esc to Escape', () => {
      expect(getShortcutKey('esc')).toBe('Escape');
    });

    it('should map enter to Enter', () => {
      expect(getShortcutKey('enter')).toBe('Enter');
    });

    it('should map tab to Tab', () => {
      expect(getShortcutKey('tab')).toBe('Tab');
    });

    it('should map arrow keys', () => {
      expect(getShortcutKey('up')).toBe('Up');
      expect(getShortcutKey('down')).toBe('Down');
      expect(getShortcutKey('left')).toBe('Left');
      expect(getShortcutKey('right')).toBe('Right');
    });

    it('should map ctrl combinations', () => {
      expect(getShortcutKey('ctrl+c')).toBe('C-c');
      expect(getShortcutKey('ctrl+d')).toBe('C-d');
      expect(getShortcutKey('ctrl+z')).toBe('C-z');
    });

    it('should return undefined for unknown shortcuts', () => {
      expect(getShortcutKey('unknown')).toBeUndefined();
    });

    it('should return undefined for non-shortcut commands', () => {
      expect(getShortcutKey('sh')).toBeUndefined();
      expect(getShortcutKey('help')).toBeUndefined();
    });
  });
});

import { describe, test, expect } from 'vitest';
import { isCJK, isSpecialSymbol, getFontCategory } from '../src/terminal/fonts';

describe('isCJK', () => {
  test('Chinese characters return true', () => {
    expect(isCJK('中'.codePointAt(0)!)).toBe(true);
    expect(isCJK('文'.codePointAt(0)!)).toBe(true);
  });

  test('ASCII returns false', () => {
    expect(isCJK('a'.codePointAt(0)!)).toBe(false);
    expect(isCJK('1'.codePointAt(0)!)).toBe(false);
  });

  test('fullwidth punctuation returns true', () => {
    expect(isCJK('：'.codePointAt(0)!)).toBe(true);
    expect(isCJK('（'.codePointAt(0)!)).toBe(true);
  });

  test('CJK unified ideographs extension B', () => {
    expect(isCJK(0x20000)).toBe(true);
  });
});

describe('isSpecialSymbol', () => {
  test('dingbats return true', () => {
    expect(isSpecialSymbol('✓'.codePointAt(0)!)).toBe(true);
    expect(isSpecialSymbol('✗'.codePointAt(0)!)).toBe(true);
  });

  test('box drawing returns true', () => {
    expect(isSpecialSymbol('─'.codePointAt(0)!)).toBe(true);
    expect(isSpecialSymbol('│'.codePointAt(0)!)).toBe(true);
  });

  test('geometric shapes return true', () => {
    expect(isSpecialSymbol('●'.codePointAt(0)!)).toBe(true);
    expect(isSpecialSymbol('■'.codePointAt(0)!)).toBe(true);
  });

  test('ASCII returns false', () => {
    expect(isSpecialSymbol('x'.codePointAt(0)!)).toBe(false);
  });
});

describe('getFontCategory', () => {
  test('ASCII → mono', () => {
    expect(getFontCategory('a'.codePointAt(0)!)).toBe('mono');
  });
  test('CJK → cjk', () => {
    expect(getFontCategory('中'.codePointAt(0)!)).toBe('cjk');
  });
  test('symbol → symbol', () => {
    expect(getFontCategory('✓'.codePointAt(0)!)).toBe('symbol');
  });
});

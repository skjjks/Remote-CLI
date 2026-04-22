import { describe, test, expect, beforeAll } from 'vitest';
import { renderScreenshot } from '../src/terminal/screenshot';
import { registerFonts } from '../src/terminal/fonts';
import type { StyledSegment } from '../src/terminal/ansi-parser';

beforeAll(() => {
  registerFonts();
});

describe('renderScreenshot', () => {
  test('returns a PNG buffer', async () => {
    const lines: StyledSegment[][] = [
      [{ text: 'hello world', fg: '#d4d4d4', bold: false, italic: false, underline: false }],
    ];
    const buf = await renderScreenshot(lines, 'test: ~/home', { cols: 80 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4E);
    expect(buf[3]).toBe(0x47);
  });

  test('handles multiple lines', async () => {
    const lines: StyledSegment[][] = [
      [{ text: 'line 1', fg: '#d4d4d4', bold: false, italic: false, underline: false }],
      [{ text: 'line 2', fg: '#ff0000', bold: true, italic: false, underline: false }],
    ];
    const buf = await renderScreenshot(lines, 'test', { cols: 80 });
    expect(buf.length).toBeGreaterThan(100);
  });

  test('handles empty input', async () => {
    const buf = await renderScreenshot([], 'test', { cols: 80 });
    expect(buf).toBeInstanceOf(Buffer);
  });

  test('handles CJK text', async () => {
    const lines: StyledSegment[][] = [
      [{ text: '中文测试', fg: '#d4d4d4', bold: false, italic: false, underline: false }],
    ];
    const buf = await renderScreenshot(lines, 'test', { cols: 80 });
    expect(buf.length).toBeGreaterThan(100);
  });

  test('wider cols produces wider image', async () => {
    const lines: StyledSegment[][] = [
      [{ text: 'test', fg: '#d4d4d4', bold: false, italic: false, underline: false }],
    ];
    const narrow = await renderScreenshot(lines, 'test', { cols: 40 });
    const wide = await renderScreenshot(lines, 'test', { cols: 120 });
    expect(wide.length).toBeGreaterThan(narrow.length);
  });
});

import { describe, test, expect } from 'vitest';
import { parseAnsi, type StyledSegment } from '../src/terminal/ansi-parser';

describe('parseAnsi', () => {
  test('plain text returns single segment with defaults', () => {
    const result = parseAnsi('hello world');
    expect(result).toEqual([
      { text: 'hello world', fg: '#d4d4d4', bold: false, italic: false, underline: false },
    ]);
  });

  test('bold text', () => {
    const result = parseAnsi('\x1b[1mhello\x1b[0m world');
    expect(result).toEqual([
      { text: 'hello', fg: '#d4d4d4', bold: true, italic: false, underline: false },
      { text: ' world', fg: '#d4d4d4', bold: false, italic: false, underline: false },
    ]);
  });

  test('standard foreground colors', () => {
    const result = parseAnsi('\x1b[31mred\x1b[32mgreen\x1b[0m');
    expect(result[0]).toMatchObject({ text: 'red', fg: '#cd3131' });
    expect(result[1]).toMatchObject({ text: 'green', fg: '#0dbc79' });
  });

  test('bright foreground colors', () => {
    const result = parseAnsi('\x1b[91mbright red\x1b[0m');
    expect(result[0]).toMatchObject({ text: 'bright red', fg: '#f14c4c' });
  });

  test('256-color foreground', () => {
    const result = parseAnsi('\x1b[38;5;196mred256\x1b[0m');
    expect(result[0].text).toBe('red256');
    expect(result[0].fg).toMatch(/^#/);
  });

  test('truecolor foreground', () => {
    const result = parseAnsi('\x1b[38;2;255;128;0morange\x1b[0m');
    expect(result[0]).toMatchObject({ text: 'orange', fg: '#ff8000' });
  });

  test('background colors produce bg field', () => {
    const result = parseAnsi('\x1b[41mred bg\x1b[0m');
    expect(result[0].bg).toBe('#cd3131');
  });

  test('combined bold + color', () => {
    const result = parseAnsi('\x1b[1;32msuccess\x1b[0m');
    expect(result[0]).toMatchObject({ text: 'success', fg: '#0dbc79', bold: true });
  });

  test('reset mid-stream', () => {
    const result = parseAnsi('\x1b[31mred\x1b[0mnormal');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ text: 'normal', fg: '#d4d4d4', bold: false });
  });

  test('empty input returns empty array', () => {
    expect(parseAnsi('')).toEqual([]);
  });

  test('strips OSC sequences', () => {
    const result = parseAnsi('\x1b]0;title\x07hello');
    expect(result[0].text).toBe('hello');
  });

  test('italic and underline', () => {
    const result = parseAnsi('\x1b[3;4mfancy\x1b[0m');
    expect(result[0]).toMatchObject({ italic: true, underline: true });
  });

  test('default fg reset with 39', () => {
    const result = parseAnsi('\x1b[31mred\x1b[39mdefault');
    expect(result[1]).toMatchObject({ text: 'default', fg: '#d4d4d4' });
  });
});

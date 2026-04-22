export interface StyledSegment {
  text: string;
  fg: string;
  bg?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const DEFAULT_FG = '#d4d4d4';

const STANDARD_COLORS: Record<number, string> = {
  0: '#000000', 1: '#cd3131', 2: '#0dbc79', 3: '#e5e510',
  4: '#2472c8', 5: '#bc3fbc', 6: '#11a8cd', 7: '#e5e5e5',
};

const BRIGHT_COLORS: Record<number, string> = {
  0: '#666666', 1: '#f14c4c', 2: '#23d18b', 3: '#f5f543',
  4: '#3b8eea', 5: '#d670d6', 6: '#29b8db', 7: '#ffffff',
};

function color256ToHex(n: number): string {
  if (n < 8) return STANDARD_COLORS[n];
  if (n < 16) return BRIGHT_COLORS[n - 8];
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36) * 51;
    const g = Math.floor((idx % 36) / 6) * 51;
    const b = (idx % 6) * 51;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  const v = 8 + (n - 232) * 10;
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function parseAnsi(input: string): StyledSegment[] {
  let text = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  text = text.replace(/\x1b[^[\]]/g, '');

  const segments: StyledSegment[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let fg = DEFAULT_FG;
  let bg: string | undefined;
  let bold = false;
  let italic = false;
  let underline = false;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), fg, bg, bold, italic, underline });
    }
    const codes = match[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (isNaN(c) || c === 0) { fg = DEFAULT_FG; bg = undefined; bold = false; italic = false; underline = false; }
      else if (c === 1) bold = true;
      else if (c === 3) italic = true;
      else if (c === 4) underline = true;
      else if (c === 22) bold = false;
      else if (c === 23) italic = false;
      else if (c === 24) underline = false;
      else if (c >= 30 && c <= 37) fg = STANDARD_COLORS[c - 30];
      else if (c === 38) {
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) { fg = color256ToHex(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) { fg = rgbToHex(codes[i + 2], codes[i + 3], codes[i + 4]); i += 4; }
      }
      else if (c === 39) fg = DEFAULT_FG;
      else if (c >= 40 && c <= 47) bg = STANDARD_COLORS[c - 40];
      else if (c === 48) {
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) { bg = color256ToHex(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) { bg = rgbToHex(codes[i + 2], codes[i + 3], codes[i + 4]); i += 4; }
      }
      else if (c === 49) bg = undefined;
      else if (c >= 90 && c <= 97) fg = BRIGHT_COLORS[c - 90];
      else if (c >= 100 && c <= 107) bg = BRIGHT_COLORS[c - 100];
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), fg, bg, bold, italic, underline });
  }
  return segments;
}

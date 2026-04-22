import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'fs';

export type FontCategory = 'mono' | 'symbol' | 'cjk';

interface FontConfig {
  mono: string | null;
  monoBold: string | null;
  symbol: string | null;
  symbolBold: string | null;
  cjk: string | null;
  cjkBold: string | null;
}

const MONO_CANDIDATES = [
  ['/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf', 'UbuntuMono'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'DejaVuMono'],
  ['/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', 'LiberationMono'],
  ['/usr/share/fonts/liberation-mono/LiberationMono-Regular.ttf', 'LiberationMono'],
  ['/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf', 'NotoSansMono'],
  ['/usr/share/fonts/google-noto/NotoSansMono-Regular.ttf', 'NotoSansMono'],
  ['/usr/share/fonts/truetype/freefont/FreeMono.ttf', 'FreeMono'],
] as const;

const MONO_BOLD_CANDIDATES = [
  ['/usr/share/fonts/truetype/ubuntu/UbuntuMono-B.ttf', 'UbuntuMonoBold'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 'DejaVuMonoBold'],
  ['/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf', 'LiberationMonoBold'],
  ['/usr/share/fonts/liberation-mono/LiberationMono-Bold.ttf', 'LiberationMonoBold'],
] as const;

const SYMBOL_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'DejaVuMono'],
  ['/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf', 'NotoSansMono'],
] as const;

const SYMBOL_BOLD_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 'DejaVuMonoBold'],
] as const;

const CJK_CANDIDATES = [
  ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJK'],
  ['/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', 'NotoSansCJK'],
  ['/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', 'NotoSansCJK'],
  ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 'WenQuanYi'],
  ['/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc', 'WenQuanYi'],
  ['/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf', 'DroidSans'],
] as const;

const CJK_BOLD_CANDIDATES = [
  ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'NotoSansCJKBold'],
  ['/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc', 'NotoSansCJKBold'],
] as const;

const registered = new Set<string>();

function findAndRegister(candidates: ReadonlyArray<readonly [string, string]>): string | null {
  for (const [path, name] of candidates) {
    if (existsSync(path)) {
      if (!registered.has(name)) {
        GlobalFonts.registerFromPath(path, name);
        registered.add(name);
      }
      return name;
    }
  }
  return null;
}

let fonts: FontConfig = {
  mono: null, monoBold: null,
  symbol: null, symbolBold: null,
  cjk: null, cjkBold: null,
};
let initialized = false;

export function registerFonts(): FontConfig {
  fonts = {
    mono: findAndRegister(MONO_CANDIDATES),
    monoBold: findAndRegister(MONO_BOLD_CANDIDATES),
    symbol: findAndRegister(SYMBOL_CANDIDATES),
    symbolBold: findAndRegister(SYMBOL_BOLD_CANDIDATES),
    cjk: findAndRegister(CJK_CANDIDATES),
    cjkBold: findAndRegister(CJK_BOLD_CANDIDATES),
  };
  initialized = true;

  if (!fonts.mono) console.warn('[SCREENSHOT] No monospace font found — screenshots may look wrong');
  if (!fonts.cjk) console.warn('[SCREENSHOT] No CJK font found — Chinese characters will render as boxes');

  console.log(`[SCREENSHOT] Fonts: mono=${fonts.mono}, symbol=${fonts.symbol}, cjk=${fonts.cjk}`);
  return fonts;
}

export function getFonts(): FontConfig {
  if (!initialized) registerFonts();
  return fonts;
}

export function isCJK(codePoint: number): boolean {
  return (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
    (codePoint >= 0x2E80 && codePoint <= 0x2FFF) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0xFE30 && codePoint <= 0xFE4F) ||
    (codePoint >= 0x20000 && codePoint <= 0x2FA1F) ||
    (codePoint >= 0x3000 && codePoint <= 0x303F) ||
    (codePoint >= 0xFF00 && codePoint <= 0xFFEF);
}

export function isSpecialSymbol(codePoint: number): boolean {
  return (codePoint >= 0x2500 && codePoint <= 0x257F) ||
    (codePoint >= 0x25A0 && codePoint <= 0x25FF) ||
    (codePoint >= 0x2600 && codePoint <= 0x26FF) ||
    (codePoint >= 0x2700 && codePoint <= 0x27BF) ||
    (codePoint >= 0x2190 && codePoint <= 0x21FF);
}

export function getFontCategory(codePoint: number): FontCategory {
  if (isCJK(codePoint)) return 'cjk';
  if (isSpecialSymbol(codePoint)) return 'symbol';
  return 'mono';
}

export function getFontForChar(codePoint: number, bold: boolean): string {
  const f = getFonts();
  const cat = getFontCategory(codePoint);
  if (cat === 'cjk') return (bold ? f.cjkBold : f.cjk) ?? f.cjk ?? f.mono ?? 'monospace';
  if (cat === 'symbol') return (bold ? f.symbolBold : f.symbol) ?? f.symbol ?? f.mono ?? 'monospace';
  return (bold ? f.monoBold : f.mono) ?? f.mono ?? 'monospace';
}

export interface FontSegment {
  text: string;
  font: string;
}

export function segmentByFont(text: string, bold: boolean): FontSegment[] {
  const result: FontSegment[] = [];
  let current: FontSegment = { text: '', font: '' };
  for (const ch of text) {
    const font = getFontForChar(ch.codePointAt(0)!, bold);
    if (font === current.font) {
      current.text += ch;
    } else {
      if (current.text) result.push({ ...current });
      current = { text: ch, font };
    }
  }
  if (current.text) result.push(current);
  return result;
}

import { createCanvas } from '@napi-rs/canvas';
import { getFonts, segmentByFont } from './fonts';
import type { StyledSegment } from './ansi-parser';

const FONT_SIZE = 15;
const LINE_HEIGHT = FONT_SIZE * 1.5;
const PADDING = 16;
const TITLE_BAR_H = 28;
const SCALE = 2;
const BG_COLOR = '#1e1e1e';
const TITLE_BG = '#252525';
const BORDER_COLOR = '#444444';
const TITLE_FG = '#999999';
const BORDER_RADIUS = 6;

function measureCharWidth(): number {
  const f = getFonts();
  const c = createCanvas(100, 100);
  const ctx = c.getContext('2d');
  const fontName = f.mono ?? 'monospace';
  ctx.font = `${FONT_SIZE}px "${fontName}", monospace`;
  return ctx.measureText('M').width;
}

export async function renderScreenshot(
  lines: StyledSegment[][],
  title: string,
  config: { cols: number },
): Promise<Buffer> {
  const charWidth = measureCharWidth();
  const width = Math.max(config.cols * charWidth + PADDING * 2, 300);
  const contentHeight = Math.max(lines.length, 1) * LINE_HEIGHT;
  const height = contentHeight + PADDING * 2 + TITLE_BAR_H;

  const canvas = createCanvas(width * SCALE, height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, width - 1, height - 1, BORDER_RADIUS);
  ctx.stroke();

  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, BORDER_RADIUS);
  ctx.fill();

  ctx.fillStyle = TITLE_BG;
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, TITLE_BAR_H, [BORDER_RADIUS, BORDER_RADIUS, 0, 0]);
  ctx.fill();

  ctx.strokeStyle = BORDER_COLOR;
  ctx.beginPath();
  ctx.moveTo(1, TITLE_BAR_H);
  ctx.lineTo(width - 1, TITLE_BAR_H);
  ctx.stroke();

  const f = getFonts();
  const titleFont = f.mono ?? 'monospace';
  ctx.fillStyle = TITLE_FG;
  ctx.font = `12px "${titleFont}", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, TITLE_BAR_H / 2 + 4);
  ctx.textAlign = 'left';

  const startY = TITLE_BAR_H + PADDING + FONT_SIZE;
  for (let i = 0; i < lines.length; i++) {
    let x = PADDING;
    const y = startY + i * LINE_HEIGHT;

    for (const seg of lines[i]) {
      if (seg.bg) {
        const fontName = f.mono ?? 'monospace';
        ctx.font = `${FONT_SIZE}px "${fontName}", monospace`;
        const segWidth = ctx.measureText(seg.text).width;
        ctx.fillStyle = seg.bg;
        ctx.fillRect(x, y - FONT_SIZE + 2, segWidth, LINE_HEIGHT);
      }

      const fontSegments = segmentByFont(seg.text, seg.bold);
      for (const fs of fontSegments) {
        const weight = seg.bold ? 'bold ' : '';
        const style = seg.italic ? 'italic ' : '';
        ctx.font = `${style}${weight}${FONT_SIZE}px "${fs.font}", monospace`;
        ctx.fillStyle = seg.fg;
        ctx.fillText(fs.text, x, y);

        if (seg.underline) {
          ctx.strokeStyle = seg.fg;
          ctx.lineWidth = 1;
          const textWidth = ctx.measureText(fs.text).width;
          ctx.beginPath();
          ctx.moveTo(x, y + 3);
          ctx.lineTo(x + textWidth, y + 3);
          ctx.stroke();
        }

        x += ctx.measureText(fs.text).width;
      }
    }
  }

  return canvas.toBuffer('image/png');
}

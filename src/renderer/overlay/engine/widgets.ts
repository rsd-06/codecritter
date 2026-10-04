// Pinned sticky note and pomodoro timer widget.
import { LINE_H, drawText, layoutText, textWidth } from './font';

export function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface PomodoroView {
  /** mm:ss text */
  text: string;
  /** 0..1 elapsed fraction */
  progress: number;
  color: string;
  paused: boolean;
}

/** Small timer panel: pixel mm:ss digits + progress bar. (x,y) = top-left. Size 29x15. */
export function drawPomodoro(ctx: CanvasRenderingContext2D, v: PomodoroView, x: number, y: number): void {
  const w = 29;
  const h = 15;
  ctx.fillStyle = '#1c1830';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = v.color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  const tw = textWidth(v.text);
  drawText(ctx, v.text, x + Math.round((w - tw) / 2), y + 3, v.paused ? '#8a84a8' : '#ffffff');
  const bw = w - 6;
  ctx.fillStyle = '#3a3560';
  ctx.fillRect(x + 3, y + h - 5, bw, 2);
  ctx.fillStyle = v.color;
  ctx.fillRect(x + 3, y + h - 5, Math.round(bw * Math.max(0, Math.min(1, v.progress))), 2);
}

export const NOTE_W = 38;
export const NOTE_H = 36;

/** Sticky note, top-left at (x,y). Text wraps to the note and is cut with "..." if too long. */
export function drawNote(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#d8b13a';
  ctx.fillRect(x + 1, y + 2, NOTE_W, NOTE_H); // shadow edge
  ctx.fillStyle = '#f7d95c';
  ctx.fillRect(x, y, NOTE_W, NOTE_H - 1);
  ctx.fillStyle = '#fbe98f';
  ctx.fillRect(x, y, NOTE_W, 5);
  // tape / pin
  ctx.fillStyle = '#e0485c';
  ctx.fillRect(x + NOTE_W / 2 - 2, y - 1, 4, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + NOTE_W / 2 - 1, y, 1, 1);
  const maxLines = Math.floor((NOTE_H - 9) / LINE_H);
  const block = layoutText(text, NOTE_W - 6);
  let lines = block.lines;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1]!;
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 2))}…`;
  }
  lines.forEach((l, i) => drawText(ctx, l, x + 3, y + 7 + i * LINE_H, '#4a3a10'));
  ctx.globalAlpha = 1;
}

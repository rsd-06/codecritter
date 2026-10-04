// Speech / thought bubbles drawn with the pixel font.
import { LINE_H, drawText, layoutText, type TextBlock } from './font';

const INK = '#2a2540';
const PAPER = '#fffdf4';
const MAX_TEXT_W = 100;
const MAX_LINES = 2;
const CPS = 36; // typewriter chars per second

export type BubbleKind = 'speech' | 'thought';

export class BubbleView {
  kind: BubbleKind = 'speech';
  private block: TextBlock = { lines: [], w: 0, h: 0 };
  private text = '';
  private age = 0;
  private ttl = 0;
  active = false;

  show(kind: BubbleKind, text: string, ttlMs: number): void {
    this.kind = kind;
    this.block = layoutText(text, MAX_TEXT_W, MAX_LINES);
    this.text = this.block.lines.join(' ');
    this.age = 0;
    this.ttl = ttlMs / 1000;
    this.active = true;
  }

  hide(): void {
    this.active = false;
  }

  /** true while typing / popping / fading (needs frames), false while static. */
  get animating(): boolean {
    if (!this.active) return false;
    const typing = this.age * CPS < this.text.length + 2;
    return typing || this.age < 0.25 || this.ttl - this.age < 0.35;
  }

  /** seconds until something changes without events (expiry) */
  get timeToChange(): number {
    return this.active ? Math.max(0.02, this.ttl - this.age - 0.35) : Infinity;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    if (this.age >= this.ttl) this.active = false;
  }

  /** Draw with bottom-centre tail point at (ax, ay). */
  draw(ctx: CanvasRenderingContext2D, ax: number, ay: number, stageW: number, minX = 1): void {
    if (!this.active) return;
    const { lines, w, h } = this.block;
    const padX = 4;
    const padY = 3;
    const bw = w + padX * 2;
    const bh = h + padY * 2;
    // pop in / out (stepped for pixel feel)
    const left = this.ttl - this.age;
    let k = 1;
    if (this.age < 0.25) k = [0.5, 0.75, 0.9, 1.1, 1][Math.min(4, Math.floor(this.age / 0.05))]!;
    else if (left < 0.35) k = left < 0.12 ? 0.5 : left < 0.24 ? 0.75 : 0.9;
    const tail = this.kind === 'speech' ? 2 : 8;
    // keep the whole bubble inside the stage even when scaled up (pop-in / 1.4x stretch)
    const topWorld = ay - (tail + bh) * k;
    if (topWorld < 1) ay += Math.ceil(1 - topWorld);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(k, k);
    let x = -Math.round(bw / 2);
    const worldX = ax + x * k;
    if (worldX < minX) x += Math.ceil((minX - worldX) / k);
    if (ax + (x + bw) * k > stageW - 1) x -= Math.ceil((ax + (x + bw) * k - (stageW - 1)) / k);
    const y = -tail - bh;
    const c = this.kind === 'speech' ? 1 : 2; // corner cut
    // outline + fill
    ctx.fillStyle = INK;
    ctx.fillRect(x + c, y, bw - c * 2, 1);
    ctx.fillRect(x + c, y + bh - 1, bw - c * 2, 1);
    ctx.fillRect(x, y + c, 1, bh - c * 2);
    ctx.fillRect(x + bw - 1, y + c, 1, bh - c * 2);
    if (c === 2) {
      ctx.fillRect(x + 1, y + 1, 1, 1);
      ctx.fillRect(x + bw - 2, y + 1, 1, 1);
      ctx.fillRect(x + 1, y + bh - 2, 1, 1);
      ctx.fillRect(x + bw - 2, y + bh - 2, 1, 1);
    }
    ctx.fillStyle = PAPER;
    ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    // tail
    if (this.kind === 'speech') {
      const tx = Math.max(x + 3, Math.min(x + bw - 7, -2));
      ctx.fillStyle = PAPER;
      ctx.fillRect(tx + 1, y + bh - 1, 2, 1);
      ctx.fillStyle = INK;
      ctx.fillRect(tx, y + bh, 1, 1);
      ctx.fillRect(tx + 3, y + bh, 1, 1);
      ctx.fillRect(tx + 1, y + bh + 1, 2, 1);
      ctx.fillStyle = PAPER;
      ctx.fillRect(tx + 1, y + bh, 2, 1);
    } else {
      // thought dots trailing toward the head
      const dots: [number, number, number][] = [
        [-1, 1, 3],
        [-3, 4, 2],
      ];
      for (const [dx, dy, r] of dots) {
        ctx.fillStyle = INK;
        ctx.fillRect(dx - 1, y + bh + dy - 1, r + 2, r + 2);
        ctx.fillStyle = PAPER;
        ctx.fillRect(dx, y + bh + dy, r, r);
      }
    }
    // text (typewriter)
    let remaining = Math.floor(this.age * CPS);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const n = Math.min(line.length, remaining);
      drawText(ctx, line, x + padX, y + padY + i * LINE_H, INK, n);
      remaining -= line.length + 1;
      if (remaining <= 0) break;
    }
    ctx.restore();
  }
}

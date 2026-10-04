// Pooled pixel particles (no per-frame allocation): steam, hearts, Zzz, sparkles, "!", "?", sweat.
import { drawText } from './font';
import { FIXED_COLORS, compileRows } from './rig';

export type ParticleKind = 'steam' | 'heart' | 'zzz' | 'sparkle' | 'exclaim' | 'question' | 'sweat';

const SPRITES: Partial<Record<ParticleKind, string[]>> = {
  heart: ['.RR.RR.', 'RRTRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'],
  sparkle: ['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'],
  exclaim: ['RR', 'RR', 'RR', 'RR', 'RR', '..', 'RR', 'RR'],
  question: ['.RRR.', 'RR.RR', '...RR', '..RR.', '..R..', '.....', '..R..'],
  sweat: ['.c.', 'ccc', 'cWc', 'ccc', '.c.'],
};

const cache = new Map<string, HTMLCanvasElement>();

function spriteCanvas(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
}

function fromRows(rows: string[]): HTMLCanvasElement {
  const img = compileRows(rows, FIXED_COLORS);
  const c = document.createElement('canvas');
  c.width = img.w;
  c.height = img.h;
  c.getContext('2d')!.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return c;
}

function textCanvas(ch: string, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 5;
  c.height = 7;
  drawText(c.getContext('2d')!, ch, 0, 1, color);
  return c;
}

export function sprite(kind: ParticleKind, variant = 0): HTMLCanvasElement | null {
  if (kind === 'zzz') return spriteCanvas(`zzz${variant}`, () => textCanvas('Z', variant ? '#bfe6ff' : '#ffffff'));
  const rows = SPRITES[kind];
  return rows ? spriteCanvas(kind, () => fromRows(rows)) : null;
}

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  variant: number;
}

const POOL = 48;

export class ParticleSystem {
  readonly pool: Particle[] = Array.from({ length: POOL }, () => ({
    active: false,
    kind: 'sparkle' as ParticleKind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    variant: 0,
  }));
  private cursor = 0;

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  emit(kind: ParticleKind, x: number, y: number, opts: Partial<Pick<Particle, 'vx' | 'vy' | 'life' | 'variant'>> = {}): void {
    // reuse the next free slot, else overwrite round-robin
    let p: Particle | undefined;
    for (let i = 0; i < POOL; i++) {
      const c = this.pool[(this.cursor + i) % POOL]!;
      if (!c.active) {
        p = c;
        this.cursor = (this.cursor + i + 1) % POOL;
        break;
      }
    }
    if (!p) {
      p = this.pool[this.cursor]!;
      this.cursor = (this.cursor + 1) % POOL;
    }
    const d = DEFAULTS[kind];
    p.active = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = opts.vx ?? d.vx;
    p.vy = opts.vy ?? d.vy;
    p.life = opts.life ?? d.life;
    p.variant = opts.variant ?? 0;
    p.age = 0;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'sweat') p.vy += 40 * dt;
    }
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const k = p.age / p.life;
      // pixel-style fade: blink out during the last quarter
      if (k > 0.75 && Math.floor(p.age * 12) % 2 === 0) continue;
      if (p.kind === 'steam') {
        const r = k < 0.4 ? 2 : k < 0.75 ? 3 : 4;
        ctx.globalAlpha = k < 0.75 ? 0.85 : 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), r, r - 1);
        ctx.fillStyle = '#dfe9f5';
        ctx.fillRect(Math.round(p.x - r / 2), Math.round(p.y + r / 2 - 1), r, 1);
        ctx.globalAlpha = 1;
        continue;
      }
      const s = sprite(p.kind, p.variant);
      if (!s) continue;
      const sway = p.kind === 'heart' || p.kind === 'zzz' ? Math.round(Math.sin(p.age * 6 + p.variant) * 1.5) : 0;
      let scale = 1;
      if (p.kind === 'zzz') scale = p.variant === 0 ? 1 : 2;
      if (p.kind === 'sparkle') scale = k < 0.5 ? 1 : 1;
      ctx.drawImage(s, Math.round(p.x - (s.width * scale) / 2 + sway), Math.round(p.y), s.width * scale, s.height * scale);
    }
  }
}

const DEFAULTS: Record<ParticleKind, { vx: number; vy: number; life: number }> = {
  steam: { vx: 0, vy: -14, life: 1.1 },
  heart: { vx: 0, vy: -12, life: 1.6 },
  zzz: { vx: 5, vy: -7, life: 2.2 },
  sparkle: { vx: 0, vy: 0, life: 0.8 },
  exclaim: { vx: 0, vy: -3, life: 1.2 },
  question: { vx: 0, vy: -3, life: 1.2 },
  sweat: { vx: 0, vy: 6, life: 0.9 },
};

// Pure rig helpers: grid parsing, procedural grid builder, outlining, palette mapping, RGBA compile.
// No DOM here so everything is unit-testable under node.
import type { Palette } from '@shared/types';

/** Single-character colour keys that map to Palette fields. */
export const PALETTE_KEYS = {
  o: 'outline',
  b: 'body',
  s: 'bodyShade',
  w: 'belly',
  p: 'earInner',
  e: 'eye',
  k: 'pupil',
  a: 'accent',
} as const;

/** Fixed (palette independent) colours. */
export const FIXED_COLORS: Record<string, string> = {
  W: '#ffffff', // white highlight
  V: '#f4f1df', // sclera / off-white
  R: '#e0485c', // red
  r: '#8e2236', // dark red
  T: '#f58aa5', // tongue / pink
  N: '#171726', // near black
  C: '#cfeaf7', // glass
  c: '#4aa8e8', // water
  B: '#a9743f', // wood
  D: '#5f3d1d', // wood dark
  Y: '#f7d95c', // yellow (sticky note)
  y: '#d8b13a', // yellow dark
  P: '#f3ead0', // paper
  Q: '#cdbd8c', // paper shade
  G: '#8f98a8', // grey
  g: '#59606e', // dark grey
  H: '#f2efe6', // hair white
  L: '#7fe3a8', // laptop glow
};

export type ColorMap = Record<string, string>;

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad colour: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 255,
  };
}

export function toHex(c: RGBA): string {
  const f = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: 255,
  });
}

/** Palette -> colour map for every key (palette keys + derived shades + fixed colours). */
export function paletteColors(p: Palette): ColorMap {
  return {
    ...FIXED_COLORS,
    o: p.outline,
    b: p.body,
    s: p.bodyShade,
    w: p.belly,
    p: p.earInner,
    e: p.eye,
    k: p.pupil,
    a: p.accent,
    // derived
    u: mix(p.body, '#ffffff', 0.28), // body light
    d: mix(p.bodyShade, p.outline, 0.45), // body deep (eye patches)
    l: mix(p.belly, p.bodyShade, 0.45), // belly shade
    q: mix(p.earInner, '#000000', 0.3), // ear inner shade
    A: mix(p.accent, '#ffffff', 0.3), // accent light
    z: mix(p.accent, '#000000', 0.35), // accent dark
  };
}

export const ALL_KEYS = (() => {
  const set = new Set<string>(Object.keys(paletteColors(fakePalette())));
  return set;
})();

function fakePalette(): Palette {
  return {
    outline: '#000000',
    body: '#000000',
    bodyShade: '#000000',
    belly: '#000000',
    earInner: '#000000',
    eye: '#000000',
    pupil: '#000000',
    accent: '#000000',
  };
}

export interface ParsedGrid {
  w: number;
  h: number;
  rows: string[];
}

export const isTransparent = (ch: string): boolean => ch === '.' || ch === ' ';

/** Validate a string-array grid (rectangular, known keys). */
export function parseGrid(rows: readonly string[], allowed: ReadonlySet<string> = ALL_KEYS): ParsedGrid {
  if (rows.length === 0) throw new Error('empty grid');
  const w = rows[0]!.length;
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`ragged grid: row ${y} has ${r.length} cols, expected ${w}`);
    for (let x = 0; x < r.length; x++) {
      const ch = r[x]!;
      if (!isTransparent(ch) && !allowed.has(ch)) {
        throw new Error(`unknown colour key '${ch}' at ${x},${y}`);
      }
    }
  });
  return { w, h: rows.length, rows: [...rows] };
}

export interface RGBAImage {
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Map a grid to RGBA pixels using a colour map. */
export function compileRows(rows: readonly string[], colors: ColorMap): RGBAImage {
  const { w, h } = parseGrid(rows, new Set(Object.keys(colors)));
  const data = new Uint8ClampedArray(w * h * 4);
  const cache = new Map<string, RGBA>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x]!;
      if (isTransparent(ch)) continue;
      let c = cache.get(ch);
      if (!c) {
        c = parseHex(colors[ch]!);
        cache.set(ch, c);
      }
      const i = (y * w + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 255;
    }
  }
  return { w, h, data };
}

export function mirrorRows(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}

/** Trim transparent margins; returns offset of the trimmed grid in the original. */
export function trimRows(rows: readonly string[]): { rows: string[]; ox: number; oy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      if (!isTransparent(r[x]!)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  });
  if (maxX < 0) return { rows: ['.'], ox: 0, oy: 0 };
  return {
    rows: rows.slice(minY, maxY + 1).map((r) => r.slice(minX, maxX + 1)),
    ox: minX,
    oy: minY,
  };
}

/** Add a 1px 4-neighbour outline around opaque pixels. Grid grows by 1px on every side. */
export function outlineRows(rows: readonly string[], ch = 'o'): string[] {
  const h = rows.length;
  const w = rows[0]!.length;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? '.' : rows[y]![x]!;
  const out: string[] = [];
  for (let y = -1; y <= h; y++) {
    let line = '';
    for (let x = -1; x <= w; x++) {
      const c = at(x, y);
      if (!isTransparent(c)) line += c;
      else if (
        !isTransparent(at(x - 1, y)) ||
        !isTransparent(at(x + 1, y)) ||
        !isTransparent(at(x, y - 1)) ||
        !isTransparent(at(x, y + 1))
      )
        line += ch;
      else line += '.';
    }
    out.push(line);
  }
  return out;
}

export interface Part {
  rows: string[];
  /** offset of the top-left pixel in the character box */
  ox: number;
  oy: number;
}

/** Trim (and optionally outline) a box-sized grid into a positioned part. */
export function makePart(rows: readonly string[], opts: { outline?: boolean; outlineCh?: string } = {}): Part {
  const t = trimRows(rows);
  if (opts.outline === false) return t;
  return { rows: outlineRows(t.rows, opts.outlineCh ?? 'o'), ox: t.ox - 1, oy: t.oy - 1 };
}

type Pt = readonly [number, number];

interface PaintOpts {
  /** only paint over cells currently containing one of these chars */
  over?: string;
}

/** Procedural grid builder used to author part shapes (continuous coords, pixel-centre sampling). */
export class GridBuilder {
  private cells: string[][];
  private flip = false;
  constructor(
    readonly w = 64,
    readonly h = 64,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  }

  private fx(x: number): number {
    return this.flip ? this.w - x : x;
  }

  get(x: number, y: number): string {
    return this.cells[y]?.[x] ?? '.';
  }

  private paint(x: number, y: number, ch: string, o?: PaintOpts): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (o?.over !== undefined && !o.over.includes(this.cells[y]![x]!)) return;
    this.cells[y]![x] = ch;
  }

  /** Run `cb` twice: normally and mirrored about the vertical centre line. */
  both(cb: () => void): this {
    this.flip = false;
    cb();
    this.flip = true;
    cb();
    this.flip = false;
    return this;
  }

  set(x: number, y: number, ch: string, o?: PaintOpts): this {
    this.paint(this.flip ? this.w - 1 - x : x, y, ch, o);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, ch: string, o?: PaintOpts): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch, o);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, ch: string, o?: PaintOpts): this {
    return this.rotEllipse(cx, cy, rx, ry, 0, ch, o);
  }

  /** Ellipse with its (initially vertical-semi-axis=ry) frame rotated clockwise by `deg`. */
  rotEllipse(cx: number, cy: number, rx: number, ry: number, deg: number, ch: string, o?: PaintOpts): this {
    const ccx = this.fx(cx);
    const d = this.flip ? -deg : deg;
    const a = (d * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const r = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(ccx - r); x <= Math.ceil(ccx + r); x++) {
        const dx = x + 0.5 - ccx;
        const dy = y + 0.5 - cy;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) this.paint(x, y, ch, o);
      }
    }
    return this;
  }

  poly(pts: readonly Pt[], ch: string, o?: PaintOpts): this {
    const p = pts.map(([x, y]) => [this.fx(x), y] as const);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xi, yi] = p[i]!;
          const [xj, yj] = p[j]!;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.paint(x, y, ch, o);
      }
    }
    return this;
  }

  /** Thick segment (capsule) from (x1,y1) to (x2,y2) with radius r. */
  capsule(x1: number, y1: number, x2: number, y2: number, r: number, ch: string, o?: PaintOpts): this {
    const ax = this.fx(x1);
    const bx = this.fx(x2);
    const minX = Math.min(ax, bx) - r - 1;
    const maxX = Math.max(ax, bx) + r + 1;
    const minY = Math.min(y1, y2) - r - 1;
    const maxY = Math.max(y1, y2) + r + 1;
    const vx = bx - ax;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - y1;
        const t = Math.max(0, Math.min(1, (px * vx + py * vy) / len2));
        const dx = px - t * vx;
        const dy = py - t * vy;
        if (dx * dx + dy * dy <= r * r) this.paint(x, y, ch, o);
      }
    }
    return this;
  }

  /** Overlay literal rows with the top-left at (ox,oy); '.' / ' ' are skipped. */
  stamp(rows: readonly string[], ox: number, oy: number, o?: PaintOpts): this {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) {
        const ch = r[i]!;
        if (isTransparent(ch)) continue;
        this.set(ox + i, oy + j, ch, o);
      }
    });
    return this;
  }

  erase(x: number, y: number): this {
    return this.set(x, y, '.');
  }

  /** Replace `from` with `to` where the cell below is not `from` (bottom rim shading). */
  underShade(from: string, to: string): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.cells[y]![x] === from && this.get(x, y + 1) !== from) this.cells[y]![x] = to;
      }
    }
    return this;
  }

  /** Replace `from` with `to` where the cell above is not `from` (top rim highlight). */
  topLight(from: string, to: string): this {
    for (let y = this.h - 1; y >= 0; y--) {
      for (let x = 0; x < this.w; x++) {
        if (this.cells[y]![x] === from && this.get(x, y - 1) !== from) this.cells[y]![x] = to;
      }
    }
    return this;
  }

  count(ch?: string): number {
    let n = 0;
    for (const r of this.cells) for (const c of r) if (ch === undefined ? !isTransparent(c) : c === ch) n++;
    return n;
  }

  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }

  mirrored(): string[] {
    return mirrorRows(this.rows());
  }
}

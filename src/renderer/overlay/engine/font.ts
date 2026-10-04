// Tiny built-in proportional pixel font. Cap height 5, x-height 3, descenders 2. Pure data + layout.
export const LINE_H = 8;
const GAP = 1;

const caps: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
};

/** lowercase: x-height rows (3), optional ascender rows (2) and descender rows (2) */
interface Lower {
  x: string[];
  asc?: string[];
  desc?: string[];
}
const lower: Record<string, Lower> = {
  a: { x: ['.##', '#.#', '.##'] },
  b: { asc: ['#..', '#..'], x: ['##.', '#.#', '##.'] },
  c: { x: ['.##', '#..', '.##'] },
  d: { asc: ['..#', '..#'], x: ['.##', '#.#', '.##'] },
  e: { x: ['.##', '###', '#..'] },
  f: { asc: ['.#', '#.'], x: ['##', '#.', '#.'] },
  g: { x: ['.##', '#.#', '.##'], desc: ['..#', '##.'] },
  h: { asc: ['#..', '#..'], x: ['##.', '#.#', '#.#'] },
  i: { asc: ['#', '.'], x: ['#', '#', '#'] },
  j: { asc: ['.#', '..'], x: ['.#', '.#', '.#'], desc: ['.#', '#.'] },
  k: { asc: ['#..', '#..'], x: ['#.#', '##.', '#.#'] },
  l: { asc: ['#', '#'], x: ['#', '#', '#'] },
  m: { x: ['##.#.', '#.#.#', '#.#.#'] },
  n: { x: ['##.', '#.#', '#.#'] },
  o: { x: ['.#.', '#.#', '.#.'] },
  p: { x: ['##.', '#.#', '##.'], desc: ['#..', '#..'] },
  q: { x: ['.##', '#.#', '.##'], desc: ['..#', '..#'] },
  r: { x: ['.##', '#..', '#..'] },
  s: { x: ['.##', '.#.', '##.'] },
  t: { asc: ['..', '#.'], x: ['##', '#.', '.#'] },
  u: { x: ['#.#', '#.#', '.##'] },
  v: { x: ['#.#', '#.#', '.#.'] },
  w: { x: ['#...#', '#.#.#', '.#.#.'] },
  x: { x: ['#.#', '.#.', '#.#'] },
  y: { x: ['#.#', '#.#', '.##'], desc: ['..#', '##.'] },
  z: { x: ['##.', '.#.', '.##'] },
};

const other: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['..', '..', '..', '..', '..'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '.', '#', '#'],
  ':': ['.', '#', '.', '#', '.'],
  ';': ['.', '#', '.', '#', '#', '#'],
  '!': ['#', '#', '#', '.', '#'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  _: ['...', '...', '...', '...', '...', '###'],
  "'": ['#', '#', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '=': ['...', '###', '...', '###', '...'],
  '*': ['#.#', '.#.', '###', '.#.', '#.#'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '@': ['.##.', '#..#', '#.##', '#...', '.##.'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '&': ['.#.', '#.#', '.##', '#.#', '.##'],
  '~': ['...', '.#.', '#.#', '...', '...'],
  '[': ['##', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '##'],
  '|': ['#', '#', '#', '#', '#'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '^': ['.#.', '#.#', '...', '...', '...'],
  '\\': ['#..', '#..', '.#.', '..#', '..#'],
  '{': ['.#', '#.', '#.', '#.', '.#'],
  '}': ['#.', '.#', '.#', '.#', '#.'],
  '`': ['#.', '.#', '..', '..', '..'],
  '…': ['...', '...', '...', '...', '#.#'],
};

function pad(rows: string[], w: number): string[] {
  return rows.map((r) => r.padEnd(w, '.'));
}

function build(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [k, v] of Object.entries(caps)) m.set(k, v);
  for (const [k, v] of Object.entries(other)) m.set(k, pad(v, v[0]!.length));
  for (const [k, v] of Object.entries(lower)) {
    const w = v.x[0]!.length;
    const blank = '.'.repeat(w);
    const rows = [...(v.asc ?? [blank, blank]), ...v.x, ...(v.desc ?? [])];
    m.set(k, pad(rows, w));
  }
  return m;
}

const GLYPHS = build();
const FALLBACK = GLYPHS.get('?')!;

export function glyph(ch: string): string[] {
  return GLYPHS.get(ch) ?? FALLBACK;
}

export function glyphWidth(ch: string): number {
  return glyph(ch)[0]!.length;
}

/** Pixel width of a single line of text. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphWidth(ch) + GAP;
  return Math.max(0, w - GAP);
}

/** Greedy word wrap into lines no wider than maxW px (long words are hard-broken). */
export function wrapText(text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w) > maxW) {
        let n = w.length - 1;
        while (n > 1 && textWidth(w.slice(0, n)) > maxW) n--;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const cand = line ? `${line} ${w}` : w;
      if (textWidth(cand) <= maxW) line = cand;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export interface TextBlock {
  lines: string[];
  w: number;
  h: number;
}

export function layoutText(text: string, maxW: number): TextBlock {
  const lines = wrapText(text, maxW);
  const w = Math.max(...lines.map(textWidth), 0);
  return { lines, w, h: lines.length * LINE_H - (LINE_H - 7) };
}

/** Draw text with fillRect per lit pixel. `count` limits revealed characters (typewriter). */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  count = Infinity,
): void {
  ctx.fillStyle = color;
  let cx = x;
  let n = 0;
  for (const ch of text) {
    if (n++ >= count) break;
    const g = glyph(ch);
    for (let j = 0; j < g.length; j++) {
      const row = g[j]!;
      for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(cx + i, y + j, 1, 1);
    }
    cx += g[0]!.length + GAP;
  }
}

// Headless sprite export. Bundled with esbuild and run in Node (see `npm run sprites:export`).
// The overlay engine draws with a canvas 2D context; here we install a tiny software canvas so the REAL
// character code (rigs, expressions, poses) renders to RGBA, then write PNG frames + manifest.json to
// tools/out/. tools/make_icons.py turns those into icons, tray images, README gallery sheets and GIFs.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createCharacter } from '../src/renderer/overlay/characters';
import { EXPRESSION_NAMES } from '../src/renderer/overlay/engine/expression';
import {
  defaultPoseState,
  type PawPose,
  type PoseName,
  type PoseState,
  type PropName,
} from '../src/renderer/overlay/engine/types';
import { DEFAULT_PALETTES } from '../src/shared/defaults';
import type { CharacterId } from '../src/shared/types';

/* ------------------------------------------------------------------ software canvas ---- */

interface State {
  fill: [number, number, number];
  alpha: number;
  op: string;
  tx: number;
  ty: number;
}

class SoftCanvas {
  width: number;
  height: number;
  private store: Uint8ClampedArray | null = null;
  constructor(width = 300, height = 150) {
    this.width = width;
    this.height = height;
  }
  /** Lazily (re)allocated so setting width/height before drawing works like the DOM. */
  get data(): Uint8ClampedArray {
    if (!this.store || this.store.length !== this.width * this.height * 4) {
      this.store = new Uint8ClampedArray(this.width * this.height * 4);
    }
    return this.store;
  }
  getContext(): SoftCtx {
    return new SoftCtx(this);
  }
}

function parseColor(c: string): [number, number, number] {
  let h = c.trim().replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (x) => x + x);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`unsupported colour: ${c}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

class SoftCtx {
  imageSmoothingEnabled = false;
  private s: State = { fill: [0, 0, 0], alpha: 1, op: 'source-over', tx: 0, ty: 0 };
  private stack: State[] = [];
  constructor(public canvas: SoftCanvas) {}
  set fillStyle(c: string) {
    this.s.fill = parseColor(c);
  }
  set globalAlpha(a: number) {
    this.s.alpha = a;
  }
  set globalCompositeOperation(o: string) {
    this.s.op = o;
  }
  save(): void {
    this.stack.push({ ...this.s });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.s = s;
  }
  translate(x: number, y: number): void {
    this.s.tx += x;
    this.s.ty += y;
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    const c = this.canvas;
    for (let j = Math.max(0, y + this.s.ty); j < Math.min(c.height, y + this.s.ty + h); j++)
      for (let i = Math.max(0, x + this.s.tx); i < Math.min(c.width, x + this.s.tx + w); i++)
        c.data.fill(0, (j * c.width + i) * 4, (j * c.width + i) * 4 + 4);
  }
  private plot(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const c = this.canvas;
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    const i = (y * c.width + x) * 4;
    const d = c.data;
    const sa = (a / 255) * this.s.alpha;
    const da = d[i + 3]! / 255;
    // source-atop keeps destination alpha; source-over unions it
    const oa = this.s.op === 'source-atop' ? da : sa + da * (1 - sa);
    if (this.s.op === 'source-atop' ? da === 0 : oa === 0) return;
    const w = this.s.op === 'source-atop' ? sa : sa / oa;
    d[i] = d[i]! + (r - d[i]!) * w;
    d[i + 1] = d[i + 1]! + (g - d[i + 1]!) * w;
    d[i + 2] = d[i + 2]! + (b - d[i + 2]!) * w;
    d[i + 3] = Math.round(oa * 255);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b] = this.s.fill;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.plot(x + i + this.s.tx, y + j + this.s.ty, r, g, b, 255);
  }
  putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void {
    const c = this.canvas;
    for (let j = 0; j < img.height; j++)
      for (let i = 0; i < img.width; i++) {
        const p = (j * img.width + i) * 4;
        const q = ((y + j) * c.width + x + i) * 4;
        for (let k = 0; k < 4; k++) c.data[q + k] = img.data[p + k]!;
      }
  }
  drawImage(src: SoftCanvas, x: number, y: number, w = src.width, h = src.height): void {
    for (let j = 0; j < h; j++) {
      const sy = Math.floor(((j + 0.5) * src.height) / h);
      for (let i = 0; i < w; i++) {
        const sx = Math.floor(((i + 0.5) * src.width) / w);
        const p = (sy * src.width + sx) * 4;
        const a = src.data[p + 3]!;
        if (a) this.plot(x + i + this.s.tx, y + j + this.s.ty, src.data[p]!, src.data[p + 1]!, src.data[p + 2]!, a);
      }
    }
  }
}

class SoftImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

const g = globalThis as unknown as Record<string, unknown>;
g['document'] = { createElement: () => new SoftCanvas() };
g['ImageData'] = SoftImageData;

/* ------------------------------------------------------------------ PNG writer ---- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ rendering ---- */

/** Frames are 64 wide and 72 tall: the 64x64 character box sits at y=8 so hops are not clipped. */
const FW = 64;
const FH = 72;
const TOP = 8;
const OUT = join(process.cwd(), 'tools', 'out');

interface Entry {
  character: CharacterId;
  group: string;
  name: string;
  file: string;
  ms?: number;
}

const manifest: { frame: { w: number; h: number }; entries: Entry[] } = {
  frame: { w: FW, h: FH },
  entries: [],
};

function render(id: CharacterId, st: PoseState, t = 0): Buffer {
  const ch = createCharacter(id, DEFAULT_PALETTES[id]);
  const c = new SoftCanvas(FW, FH);
  const ctx = c.getContext();
  ctx.translate(0, TOP);
  ch.draw(ctx as unknown as CanvasRenderingContext2D, st, t);
  return png(FW, FH, c.data);
}

function emit(id: CharacterId, group: string, name: string, st: PoseState, t = 0, ms?: number): void {
  const dir = join(OUT, id, group);
  mkdirSync(dir, { recursive: true });
  const file = `${id}/${group}/${name}.png`;
  writeFileSync(join(OUT, file), render(id, st, t));
  manifest.entries.push({ character: id, group, name, file, ...(ms ? { ms } : {}) });
}

function pose(over: Partial<PoseState>): PoseState {
  return { ...defaultPoseState(), ...over };
}

function exportCharacter(id: CharacterId): void {
  for (const e of EXPRESSION_NAMES) emit(id, 'expr', e, pose({ expression: e }));

  const poses: PoseName[] = ['sit', 'crouch', 'pounce', 'sleep', 'stretch', 'alert'];
  for (const p of poses) {
    emit(id, 'pose', p, pose({ pose: p, expression: p === 'sleep' ? 'sleepy' : 'neutral', paws: p === 'stretch' ? 'up' : 'down' }));
  }
  const paws: PawPose[] = ['knead-L', 'knead-R', 'up', 'hold-cup', 'hold-paper', 'chin', 'wave'];
  for (const w of paws) emit(id, 'paw', w, pose({ paws: w, expression: 'happy' }));
  const props: PropName[] = ['cup', 'paper', 'laptop', 'cane', 'note'];
  for (const p of props) emit(id, 'prop', p, pose({ prop: p, propProgress: 0.6, expression: 'focused' }));

  // eye tracking: pupils at the travel extremes + convergence, for every open-eye kind (QA sheet)
  const looks: Array<[string, number, number, number]> = [
    ['c', 0, 0, 0],
    ['l', -1, 0, 0],
    ['r', 1, 0, 0],
    ['u', 0, -1, 0],
    ['d', 0, 1, 0],
    ['ul', -0.75, -0.75, 0],
    ['dr', 0.75, 0.75, 0],
    ['x', 0, 0, 1],
  ];
  for (const ex of ['neutral', 'surprised', 'focused', 'sleepy', 'sneaky', 'excited'] as const)
    for (const [n, x, y, conv] of looks)
      emit(id, 'look', `${ex}_${n}`, pose({ expression: ex, eyes: { open: 1, lookX: x, lookY: y, conv } }));

  // idle: breathing, a blink and a glance (ms per frame)
  const idle: Array<[Partial<PoseState>, number, number]> = [
    [{}, 0, 900],
    [{}, 1, 900],
    [{ eyes: { open: 0.15, lookX: 0, lookY: 0 } }, 1, 110],
    [{}, 1, 700],
    [{ eyes: { open: 1, lookX: 0.8, lookY: 0.1 } }, 2, 800],
    [{}, 3, 900],
  ];
  idle.forEach(([o, t, ms], i) => emit(id, 'anim', `idle_${i}`, pose({ expression: 'neutral', ...o }), t, ms));

  // typing / knead: alternating paws, focused face
  const knead: PawPose[] = ['knead-L', 'knead-R', 'knead-L', 'knead-R'];
  knead.forEach((w, i) =>
    emit(id, 'anim', `knead_${i}`, pose({ pose: 'crouch', paws: w, expression: i % 2 ? 'determined' : 'focused', squashY: i % 2 ? 0.97 : 1 }), 0, 170),
  );

  // done hop: crouch, launch, apex, land, happy
  const hop: Array<[number, number, number, PoseName, PawPose]> = [
    [0, 0.94, 1.08, 'crouch', 'down'],
    [-5, 1.04, 0.94, 'pounce', 'up'],
    [-9, 0.96, 1.06, 'pounce', 'up'],
    [-5, 1, 1, 'pounce', 'up'],
    [0, 1.1, 0.88, 'crouch', 'down'],
    [0, 1, 1, 'sit', 'wave'],
    [0, 1, 1, 'sit', 'down'],
  ];
  hop.forEach(([oy, sx, sy, p, w], i) =>
    emit(id, 'anim', `hop_${i}`, pose({ pose: p, paws: w, offsetY: oy, squashX: sx, squashY: sy, expression: i < 2 ? 'determined' : 'excited' }), 0, i === 2 ? 140 : i >= 5 ? 400 : 110),
  );

  // sleep: slow breathing
  for (let i = 0; i < 6; i++) emit(id, 'anim', `sleep_${i}`, pose({ pose: 'sleep', expression: 'sleepy' }), (i * 4.8) / 6 + 0.01, 500);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const id of ['stitch', 'yoda'] as const) exportCharacter(id);
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`sprite-export: ${manifest.entries.length} frames -> tools/out/`);

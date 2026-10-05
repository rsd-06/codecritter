// Shared character machinery: compiles rig parts per palette (cached), draws a posed, expressive
// character into a 64x64 scratch box and blits it with squash/scale/tint. Character files only
// provide data (parts, geometry) via RigDef.
import type { CharacterId, Palette } from '@shared/types';
import { breathFrame } from '../engine/breath';
import { resolveExpression } from '../engine/expression';
import {
  GridBuilder,
  compileRows,
  makePart,
  mirrorRows,
  paletteColors,
  type ColorMap,
  type Part,
} from '../engine/rig';
import type {
  BrowKind,
  CharAnchors,
  CharMetrics,
  Character,
  Pt2,
  EarPose,
  EyeKind,
  MouthName,
  PoseName,
  PoseState,
  PropName,
} from '../engine/types';

export type Pt = readonly [number, number];

export interface EyeSpec {
  style: 'solid' | 'sclera';
  /** eye centres (continuous coords, pixel-centre convention), mirrored pair */
  lx: number;
  rx: number;
  cy: number;
  /** half sizes */
  hw: number;
  hh: number;
  /** rows of lid that are always shown for an 'open' eye (Yoda: half-lidded) */
  baseLid: number;
  browDy: number;
  /** colour key for the brows (default outline 'o'); Stitch uses a light body tone to read on his dark patches */
  browKey?: string;
  /** brow length in px (default 4) */
  browW?: number;
  /** solid eyes: tilt in degrees (left eye clockwise = top leans inward; mirrored on the right) */
  tilt?: number;
  /** sclera eyes: iris radius (default 2) */
  irisR?: number;
  /** max pupil travel in px [x, y] for |look| = 1 (defaults depend on style) */
  travel?: readonly [number, number];
}

export interface PoseParams {
  bodyDy: number;
  headDy: number;
  headDx: number;
  sx: number;
  sy: number;
  feetSpread: number;
  /** pose has no breathing even if spec says so */
  still?: boolean;
}

export interface ArmSpec {
  sleeve?: string; // colour key for the upper arm (Yoda robe)
  hand: string; // colour key for the hand
  r: number; // arm radius
  hr: number; // hand radius
  claw: string | null; // claw colour key (null = none)
  /** claw distance from the hand centre relative to hr (default 0.6 = just outside) */
  clawAt?: number;
  /** perpendicular spacing of the 3 claws/fingers (default 1.7) */
  clawSpread?: number;
  poses: Record<string, { L: [Pt, Pt]; R: [Pt, Pt] }>; // [shoulder, hand]
}

export interface RigDef {
  id: CharacterId;
  head: Part;
  hair?: Part;
  body: Part;
  feet?: Part;
  ears: Record<EarPose, { L: Part; R: Part }>;
  mouths: Record<MouthName, Part>;
  eye: EyeSpec;
  arms: ArmSpec;
  poses: Record<PoseName, PoseParams>;
  /** held prop sprites (box coords) */
  props: { cup: Part; laptop: Part; note: Part; cane?: Part; roll: Part };
  /** where the paper sheet hangs from the roll (top-left x/y, width), box coords */
  sheet: { x: number; y: number; w: number };
  /** auto-show cane when paws are down (Yoda) */
  autoProp?: PropName;
  /** blush cheek centres, sweat pos, vein pos, tear start y, steam [x offset from centre, y] */
  face: { blushY: number; blushDx: number; sweat: Pt; vein: Pt; tearY: number; steam: Pt };
  /** head centre y (box coords, sit pose): particles and petting are relative to it */
  headCy: number;
  /** half width of the ground shadow */
  shadowW: number;
}

export const FEET_Y = 62;

/* ---------------------------------------------------------------- small sprites ---- */

const HEART = ['.RR.RR.', 'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'];
const DROP = ['.c.', 'ccc', 'cWc', 'ccc', '.c.'];
const VEIN = ['RR.RR', 'R...R', '.....', 'R...R', 'RR.RR'];

/* ---------------------------------------------------------------- arm builder ---- */

function mx(p: Pt): Pt {
  return [64 - p[0], p[1]];
}

/** Build an arm sprite part from a shoulder and hand point. */
export function buildArm(spec: ArmSpec, s: Pt, h: Pt, clawVariant = 0): Part {
  const b = new GridBuilder();
  const dx = h[0] - s[0];
  const dy = h[1] - s[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  if (spec.sleeve) {
    // sleeve covers the upper 60% of the arm, bare arm below
    const mid: Pt = [s[0] + dx * 0.62, s[1] + dy * 0.62];
    b.capsule(s[0], s[1], mid[0], mid[1], spec.r + 0.8, spec.sleeve);
    b.capsule(mid[0], mid[1], h[0], h[1], spec.r - 0.4, spec.hand);
  } else {
    b.capsule(s[0], s[1], h[0], h[1], spec.r, spec.hand);
  }
  b.ellipse(h[0], h[1], spec.hr, spec.hr, spec.hand);
  if (spec.claw) {
    const px = -uy;
    const py = ux;
    const at = spec.clawAt ?? 0.6;
    const spread = spec.clawSpread ?? 1.7;
    void clawVariant;
    for (const k of [-1, 0, 1]) {
      const reach = spec.hr + at + (k === 0 ? 0.6 : 0);
      const cx = Math.floor(h[0] + ux * reach + px * k * spread);
      const cy = Math.floor(h[1] + uy * reach + py * k * spread);
      b.set(cx, cy, spec.claw);
    }
  }
  return makePart(b.rows());
}

export interface ArmSet {
  front: Map<string, Part>;
}

export function buildArms(spec: ArmSpec): Map<string, Part> {
  const out = new Map<string, Part>();
  for (const [name, p] of Object.entries(spec.poses)) {
    out.set(`${name}:L`, buildArm(spec, p.L[0], p.L[1]));
    out.set(`${name}:R`, buildArm(spec, p.R[0], p.R[1]));
  }
  return out;
}

/** Convenience: mirror a left-arm [shoulder, hand] to the right side. */
export function mirrorArm(a: [Pt, Pt]): [Pt, Pt] {
  return [mx(a[0]), mx(a[1])];
}

/* ---------------------------------------------------------------- ears helper ---- */

/** Split a both()-drawn grid into left (x<32) and right (x>=32) parts. */
export function splitLR(b: GridBuilder, outline = true, outlineCh = 'o'): { L: Part; R: Part } {
  const rows = b.rows();
  const left = rows.map((r) => r.slice(0, 32).padEnd(64, '.'));
  const right = rows.map((r) => '.'.repeat(32) + r.slice(32));
  return {
    L: makePart(left, { outline, outlineCh }),
    R: makePart(right, { outline, outlineCh }),
  };
}

export { mirrorRows };

/* ---------------------------------------------------------------- paper sheet ---- */

const sheetCache = new Map<string, Part>();
/** Paper hanging from the roll; `len` rows long, top-left at (x, y), `w` wide. */
export function paperSheet(len: number, x = 25, y = 50, w = 14): Part {
  const key = `${len}:${x}:${y}:${w}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const b = new GridBuilder();
  b.rect(x, y, w, len, 'P');
  for (let k = 3; k < len - 1; k += 3) b.rect(x + 2, y + k, k % 2 ? w - 6 : w - 4, 1, 'Q');
  b.rect(x, y + len - 1, w, 1, 'Q');
  const part = makePart(b.rows(), { outlineCh: 'o' });
  sheetCache.set(key, part);
  return part;
}

/* ---------------------------------------------------------------- compile cache ---- */

interface Compiled {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
}

class SpriteCache {
  private map = new WeakMap<Part, Compiled>();
  constructor(public colors: ColorMap) {}
  setColors(c: ColorMap): void {
    this.colors = c;
    this.map = new WeakMap();
  }
  get(part: Part): Compiled {
    let c = this.map.get(part);
    if (c) return c;
    const img = compileRows(part.rows, this.colors);
    const canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    canvas.getContext('2d')!.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    c = { canvas, ox: part.ox, oy: part.oy };
    this.map.set(part, c);
    return c;
  }
}

/* ---------------------------------------------------------------- pixel drawing ---- */

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  clipTop = -Infinity,
  clipBot = Infinity,
): void {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (y + 0.5 < clipTop || y + 0.5 > clipBot) continue;
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.ceil(cx - hw - 0.5);
    const x1 = Math.floor(cx + hw - 0.5);
    if (x1 >= x0) ctx.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, colors: ColorMap): void {
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j]!;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i]!;
      if (ch === '.') continue;
      ctx.fillStyle = colors[ch]!;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** Rotating pixel spiral (dizzy eyes). Radius grows with angle; the whole thing turns with time. */
function drawSpiral(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, t: number): void {
  ctx.fillStyle = color;
  const phase = (Math.floor(t * 8) % 8) * (Math.PI / 4);
  for (let a = 0; a < Math.PI * 4.2; a += 0.28) {
    const r = 0.9 + a * 0.3;
    ctx.fillRect(Math.round(cx + Math.cos(a + phase) * r - 0.5), Math.round(cy + Math.sin(a + phase) * r - 0.5), 1, 1);
  }
}

const KIND_LID: Partial<Record<EyeKind, number>> = { half: 0.42, sleepy: 0.62, squint: 0.38 };

/** Symmetric rounding (Math.round(-0.5) is -0 but Math.round(0.5) is 1: that made left looks lag right looks). */
export function sround(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** Max pupil travel in px for |look| = 1. */
export function eyeTravel(spec: EyeSpec): readonly [number, number] {
  if (spec.travel) return spec.travel;
  if (spec.style === 'solid') return [1.2, 1];
  const ir = spec.irisR ?? 2;
  return [Math.max(1, spec.hw - ir + 0.4), Math.max(0.6, spec.hh - ir + 0.4)];
}

/** Per-eye horizontal look: the left eye adds the convergence, the right eye subtracts it. */
function eyeLookX(kind: EyeKind, lookX: number, conv: number, side: number): number {
  if (kind === 'side-eye') return lookX >= 0 ? 1 : -1;
  return Math.max(-1, Math.min(1, lookX + (side < 0 ? conv : -conv)));
}

/** Filled ellipse rotated by `deg` (clockwise), pixel-centre sampling, optional row clip / mask. */
function fillRotEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  deg: number,
  color: string,
  clipTop = -Infinity,
  clipBot = Infinity,
  inside?: (x: number, y: number) => boolean,
): void {
  ctx.fillStyle = color;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r = Math.max(rx, ry) + 1;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const pyc = y + 0.5;
    if (pyc < clipTop || pyc > clipBot) continue;
    let run = -1;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r) + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = pyc - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const hit = (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1 && (!inside || inside(x + 0.5, pyc));
      if (hit && run < 0) run = x;
      if (!hit && run >= 0) {
        ctx.fillRect(run, y, x - run, 1);
        run = -1;
      }
    }
  }
}

/** Draw both eyes. All procedural; pupils follow look (+ convergence). */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  spec: EyeSpec,
  kind: EyeKind,
  open: number,
  lookX: number,
  lookY: number,
  conv: number,
  colors: ColorMap,
  dx: number,
  dy: number,
  t: number,
): void {
  const cy = spec.cy + dy;
  for (const side of [-1, 1] as const) {
    const cx = (side < 0 ? spec.lx : spec.rx) + dx;
    const lx = eyeLookX(kind, lookX, conv, side);
    if (spec.style === 'solid') drawSolidEye(ctx, spec, kind, open, lx, lookY, colors, cx, cy, side, t);
    else drawScleraEye(ctx, spec, kind, open, lx, lookY, colors, cx, cy, t);
  }
}

function arc(ctx: CanvasRenderingContext2D, cx: number, hw: number, cy: number, color: string, up: boolean): void {
  ctx.fillStyle = color;
  const half = Math.round(hw);
  for (let x = Math.round(cx) - half; x < Math.round(cx) + half; x++) {
    const a = Math.abs(x + 0.5 - cx);
    const level = a > half - 1 ? 2 : a > half - 2 ? 1 : 0;
    const y = up ? cy - 1 + level : cy + 1 - level;
    ctx.fillRect(x, Math.round(y), 1, 2);
  }
}

/** Closed eye: a flat lid line with lash ticks at both ends, sized to the eye. */
function closedLid(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, color: string): void {
  const half = Math.max(2, Math.round(hw) - 1);
  px(ctx, cx - half, cy + 1, half * 2 + 1, 1, color);
  px(ctx, cx - half - 1, cy, 1, 1, color);
  px(ctx, cx + half + 1, cy, 1, 1, color);
}

function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = -2; i <= 2; i++) {
    ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy + i - 0.5), 1, 1);
    ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy - i - 0.5), 1, 1);
  }
}

function drawSolidEye(
  ctx: CanvasRenderingContext2D,
  spec: EyeSpec,
  kind: EyeKind,
  open: number,
  lookX: number,
  lookY: number,
  C: ColorMap,
  cx: number,
  cy: number,
  side: number,
  t: number,
): void {
  if (kind === 'closed' || kind === 'happy') {
    if (kind === 'happy') arc(ctx, cx, spec.hw, cy, C['e']!, true);
    else closedLid(ctx, cx, cy, spec.hw, C['e']!);
    return;
  }
  if (kind === 'hearts') {
    drawSprite(ctx, HEART, Math.round(cx - 3.5), Math.round(cy - 3), C);
    px(ctx, cx - 2, cy - 2, 1, 1, C['W']!);
    return;
  }
  if (kind === 'spiral') {
    drawSpiral(ctx, cx, cy, C['W']!, t);
    return;
  }
  if (kind === 'dizzy') {
    drawCross(ctx, cx, cy, C['W']!);
    return;
  }
  const [tx, ty] = eyeTravel(spec);
  const wide = kind === 'wide';
  const rx = spec.hw + (wide ? 0.5 : 0);
  const ry = (spec.hh + (wide ? 1 : 0)) * Math.max(0.12, open);
  const ox = sround(lookX * tx);
  const oy = sround(lookY * ty);
  const ecx = cx + ox;
  const ecy = cy + oy + (kind === 'sleepy' ? 1 : 0);
  const lid = KIND_LID[kind] ?? 0;
  const top = ecy - ry;
  const clipTop = top + lid * 2 * ry;
  const clipBot = kind === 'squint' ? ecy + ry - lid * 2 * ry : Infinity;
  const tilt = (spec.tilt ?? 0) * (side < 0 ? 1 : -1);
  fillRotEllipse(ctx, ecx, ecy, rx, ry, tilt, C['e']!, clipTop, clipBot);
  const visible = (clipBot === Infinity ? ecy + ry : clipBot) - clipTop;
  if (visible >= 4 && open > 0.6 && kind !== 'sparkle') {
    // one glossy highlight, upper-left on both eyes (single light source)
    const hx = Math.round(ecx - rx * 0.42 - 0.5);
    const hy = Math.round(Math.max(clipTop + 0.6, ecy - ry * 0.62) - 0.5);
    px(ctx, hx, hy, 2, 2, C['k']!);
  }
  if (kind === 'sparkle') {
    const sx = Math.round(ecx - 0.5);
    const sy = Math.round(ecy - 0.5);
    px(ctx, sx, sy - 2, 1, 5, C['W']!);
    px(ctx, sx - 2, sy, 5, 1, C['W']!);
  }
  // eyelid line for sleepy/half/squint (solid eyes read as a flat top edge)
  if (lid > 0 && visible >= 2)
    px(ctx, Math.round(ecx - rx + 0.5), Math.round(clipTop - 1), Math.round(rx * 2 - 1), 1, C['d']!);
}

function drawScleraEye(
  ctx: CanvasRenderingContext2D,
  spec: EyeSpec,
  kind: EyeKind,
  open: number,
  lookX: number,
  lookY: number,
  C: ColorMap,
  cx: number,
  cy: number,
  t: number,
): void {
  if (kind === 'hearts') {
    drawSprite(ctx, HEART, Math.round(cx - 3.5), Math.round(cy - 3), C);
    px(ctx, cx - 2, cy - 2, 1, 1, C['W']!);
    return;
  }
  if (kind === 'happy') {
    arc(ctx, cx, spec.hw, cy, C['o']!, true);
    return;
  }
  if (kind === 'closed') {
    closedLid(ctx, cx, cy, spec.hw, C['o']!);
    return;
  }
  const wide = kind === 'wide';
  const bigRx = spec.hw + (wide ? 0.6 : 0);
  const bigRy = spec.hh + (wide ? 0.8 : 0);
  // dark ring then sclera
  fillEllipse(ctx, cx, cy, bigRx + 1, bigRy + 1, C['o']!);
  fillEllipse(ctx, cx, cy, bigRx, bigRy, C['V']!);
  if (kind === 'spiral') {
    drawSpiral(ctx, cx, cy, C['h']!, t);
    return;
  }
  if (kind === 'dizzy') {
    drawCross(ctx, cx, cy, C['h']!);
    return;
  }
  const [tx, ty] = eyeTravel(spec);
  const ix = cx + sround(lookX * tx);
  const iy = cy + sround(lookY * ty) + (kind === 'half' || kind === 'sleepy' ? 1 : 0);
  const irisR = (spec.irisR ?? 2) - (wide ? 0.3 : 0);
  // iris clipped to the sclera so the pupil can never leave the eye white
  const inSclera = (x: number, y: number): boolean =>
    ((x - cx) * (x - cx)) / (bigRx * bigRx) + ((y - cy) * (y - cy)) / (bigRy * bigRy) <= 1;
  fillRotEllipse(ctx, ix, iy, irisR, irisR + (kind === 'sparkle' ? 0.3 : 0), 0, C['h']!, -Infinity, Infinity, inSclera);
  // dark pupil (1px, 2x2 for big irises) + glint
  const pr = irisR >= 2.4 ? 2 : 1;
  const ppx = Math.round(ix - pr / 2);
  const ppy = Math.round(iy - pr / 2);
  for (let j = 0; j < pr; j++)
    for (let i = 0; i < pr; i++) if (inSclera(ppx + i + 0.5, ppy + j + 0.5)) px(ctx, ppx + i, ppy + j, 1, 1, C['N']!);
  if (inSclera(ppx - 0.5, ppy - 0.5)) px(ctx, ppx - 1, ppy - 1, 1, 1, C['k']!);
  if (kind === 'sparkle' && inSclera(ix + 1, iy - 0.5)) px(ctx, Math.round(ix), Math.round(iy - 1), 1, 1, C['W']!);
  // eyelids (body-coloured) from the top; blink adds more
  const top = cy - bigRy - 1;
  const total = bigRy * 2 + 2;
  let lidFrac = 0;
  if (kind === 'open' || kind === 'side-eye') lidFrac = spec.baseLid / total;
  else if (kind === 'half') lidFrac = 0.5;
  else if (kind === 'sleepy') lidFrac = 0.66;
  else if (kind === 'squint') lidFrac = 0.4;
  else if (kind === 'sparkle' || kind === 'wide') lidFrac = spec.baseLid / total / 2;
  lidFrac = Math.min(1, lidFrac + (1 - open) * (1 - lidFrac));
  const lidRows = Math.round(lidFrac * total);
  const lx0 = Math.round(cx - bigRx - 1);
  const lw = Math.ceil(bigRx * 2 + 2);
  if (lidRows > 0) {
    const yTop = Math.round(top);
    ctx.fillStyle = C['b']!;
    ctx.fillRect(lx0, yTop, lw, lidRows);
    px(ctx, lx0, yTop + lidRows, lw, 1, C['o']!); // lid edge
  }
  if (kind === 'squint') {
    const bl = Math.round(total * 0.28);
    ctx.fillStyle = C['b']!;
    ctx.fillRect(lx0, Math.round(top + total - bl), lw, bl);
    px(ctx, lx0, top + total - bl - 1, lw, 1, C['o']!);
  }
}

function drawBrows(
  ctx: CanvasRenderingContext2D,
  spec: EyeSpec,
  kind: BrowKind,
  colors: ColorMap,
  dx: number,
  dy: number,
): void {
  if (kind === 'none') return;
  const y0 = Math.round(spec.cy + dy - spec.hh - spec.browDy);
  const n = spec.browW ?? 4;
  ctx.fillStyle = colors[spec.browKey ?? 'o']!;
  for (const side of [-1, 1] as const) {
    const cx = Math.round((side < 0 ? spec.lx : spec.rx) + dx);
    for (let k = 0; k < n; k++) {
      const i = side < 0 ? k : n - 1 - k; // 0 outer .. n-1 inner
      const f = i / (n - 1); // 0 outer .. 1 inner
      let y = y0;
      if (kind === 'raised') y = y0 - 1 + (i === 0 || i === n - 1 ? 1 : 0);
      else if (kind === 'furrowed') y = y0 + Math.floor(f * 1.9);
      else if (kind === 'angry') y = y0 - 1 + Math.round(f * 3);
      else if (kind === 'worried') y = y0 + 2 - Math.round(f * 3);
      ctx.fillRect(cx - Math.floor(n / 2) + k, y, 1, kind === 'angry' ? 2 : 1);
    }
  }
}

function drawExtras(
  ctx: CanvasRenderingContext2D,
  def: RigDef,
  extras: readonly string[],
  C: ColorMap,
  t: number,
  dx: number,
  dy: number,
): void {
  const f = def.face;
  for (const ex of extras) {
    if (ex === 'blush') {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = C['T']!;
      for (const side of [-1, 1] as const) {
        const cx = (side < 0 ? def.eye.lx : def.eye.rx) + side * f.blushDx + dx;
        ctx.fillRect(Math.round(cx - 2), Math.round(f.blushY + dy), 4, 2);
        ctx.fillRect(Math.round(cx - 1), Math.round(f.blushY + dy - 1), 2, 1);
      }
      ctx.globalAlpha = 1;
    } else if (ex === 'sweat') {
      const bob = Math.floor(t * 3) % 2;
      drawSprite(ctx, DROP, f.sweat[0] + dx, f.sweat[1] + dy + bob, C);
    } else if (ex === 'tear') {
      const fall = Math.floor(t * 4) % 4;
      drawSprite(ctx, DROP, def.eye.lx - 1 + dx, f.tearY + dy + fall, C);
    } else if (ex === 'vein') {
      const pulse = Math.floor(t * 3) % 2;
      drawSprite(ctx, VEIN, f.vein[0] + dx + pulse, f.vein[1] + dy - pulse, C);
    } else if (ex === 'steam') {
      const k = Math.floor(t * 4) % 3;
      ctx.fillStyle = C['W']!;
      ctx.globalAlpha = 0.85;
      for (const side of [-1, 1] as const) {
        const x = 32 + side * f.steam[0] + (side > 0 ? -1 : -2) + dx;
        const y = f.steam[1] + dy - k * 2;
        ctx.fillRect(x, y, 3, 2);
        ctx.fillRect(x + 1, y - 4, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------------------------------------------------------------- the character ---- */

export function createRigCharacter(def: RigDef, initial: Palette): Character {
  let palette = initial;
  const cache = new SpriteCache(paletteColors(initial));
  const arms = buildArms(def.arms);
  const scratch = document.createElement('canvas');
  scratch.width = 64;
  scratch.height = 64;
  const sctx = scratch.getContext('2d', { willReadFrequently: false })!;
  sctx.imageSmoothingEnabled = false;

  const blit = (part: Part, dx = 0, dy = 0): void => {
    const c = cache.get(part);
    sctx.drawImage(c.canvas, c.ox + dx, c.oy + dy);
  };

  const metrics = computeMetrics(def);

  /** Destination rect of the 64x64 scratch box (squash/scale about the feet anchor, whole pixels). */
  const blitRect = (st: PoseState): { dx0: number; dy0: number; dw: number; dh: number } => {
    const pp = def.poses[st.pose];
    const sxx = st.squashX * pp.sx * st.scale;
    const syy = st.squashY * pp.sy * st.scale;
    const dw = Math.max(1, Math.round(64 * sxx));
    const dh = Math.max(1, Math.round(64 * syy));
    const dx0 = Math.round(32 + st.offsetX - dw / 2);
    const dy0 = Math.round(FEET_Y + st.offsetY - (FEET_Y / 64) * dh);
    return { dx0, dy0, dw, dh };
  };

  return {
    id: def.id,
    metrics,
    anchors(st: PoseState): CharAnchors {
      const pp = def.poses[st.pose];
      // offsets are applied by the stage, so anchors are computed without them
      const r = blitRect({ ...st, offsetX: 0, offsetY: 0 });
      const kx = r.dw / 64;
      const ky = r.dh / 64;
      const P = (x: number, y: number): Pt2 => ({ x: r.dx0 + x * kx, y: r.dy0 + y * ky });
      const hdx = pp.headDx;
      const hdy = pp.headDy;
      return {
        headTop: P(32, metrics.top + hdy).y,
        head: P(32 + hdx, def.headCy + hdy),
        eyes: [P(def.eye.lx + hdx, def.eye.cy + hdy), P(def.eye.rx + hdx, def.eye.cy + hdy)],
        eyeR: Math.min(def.eye.hw, def.eye.hh) * Math.min(kx, ky),
      };
    },
    get palette() {
      return palette;
    },
    setPalette(p: Palette) {
      palette = p;
      cache.setColors(paletteColors(p));
    },
    draw(ctx, st: PoseState, t: number) {
      const C = cache.colors;
      const ex = resolveExpression(def.id, st.expression);
      const mouth = st.mouth ?? ex.mouth;
      const pp = def.poses[st.pose];
      const br = breathFrame(st.pose, t);
      const bodyDy = pp.bodyDy + (st.pose === 'sleep' ? Math.min(br, 1) : 0);
      const headDy = pp.headDy + (br > 0 ? 1 : 0) + (st.pose === 'sleep' && br > 1 ? 0 : 0);
      const hdx = pp.headDx;

      sctx.clearRect(0, 0, 64, 64);

      // ears (behind head), follow the head
      // raised arms need clear space: fold the ears back while stretching
      const earPose = st.paws === 'up' && (ex.ears === 'neutral' || ex.ears === 'perk') ? 'back' : ex.ears;
      const ear = def.ears[earPose];
      blit(ear.L, hdx, headDy);
      blit(ear.R, hdx, headDy);

      // cane stands behind the hand
      const autoCane =
        def.props.cane && !st.prop && def.autoProp === 'cane' && st.paws === 'down' && (st.pose === 'sit' || st.pose === 'alert');
      if (def.props.cane && (st.prop === 'cane' || autoCane)) blit(def.props.cane, 0, bodyDy);

      blit(def.body, 0, bodyDy);
      if (def.feet) blit(def.feet, 0, 0);

      const armKey = (side: 'L' | 'R'): string => {
        const name = st.paws === 'wave' ? `wave${Math.floor(t * 4) % 2}` : st.paws;
        return `${name}:${side}`;
      };
      const armDy = st.paws === 'chin' ? headDy : bodyDy;
      const armsBehind = st.paws === 'up';
      const drawArms = (): void => {
        for (const side of ['L', 'R'] as const) {
          const part = arms.get(armKey(side)) ?? arms.get(`down:${side}`)!;
          blit(part, 0, armDy);
        }
      };
      if (armsBehind) drawArms();

      blit(def.head, hdx, headDy);
      if (def.hair) blit(def.hair, hdx, headDy);

      // face
      const eyeOpen = st.pose === 'sleep' ? 0 : st.eyes.open;
      const kind: EyeKind = st.pose === 'sleep' && ex.eyes !== 'dizzy' && ex.eyes !== 'spiral' ? 'closed' : ex.eyes;
      drawEyes(sctx, def.eye, kind, eyeOpen, st.eyes.lookX, st.eyes.lookY, st.eyes.conv ?? 0, C, hdx, headDy, t);
      drawBrows(sctx, def.eye, ex.brows, C, hdx, headDy);
      blit(def.mouths[mouth], hdx, headDy);
      drawExtras(sctx, def, ex.extras, C, t, hdx, headDy);

      // props (before paws so hands wrap them)
      if (st.prop === 'cup' || (!st.prop && st.paws === 'hold-cup')) blit(def.props.cup, 0, bodyDy);
      if (st.prop === 'laptop') blit(def.props.laptop, 0, bodyDy);
      if (st.prop === 'note') blit(def.props.note, 0, bodyDy);
      if (st.prop === 'paper' || (!st.prop && st.paws === 'hold-paper')) {
        const p = st.propProgress ?? 0.5;
        const sh = def.sheet;
        const maxLen = Math.max(2, FEET_Y - 2 - sh.y); // ends above the ground line
        const len = 2 + Math.round((Math.min(1, Math.max(0, p)) * (maxLen - 2)) / 2) * 2;
        blit(paperSheet(len, sh.x, sh.y, sh.w), 0, bodyDy);
        blit(def.props.roll, 0, bodyDy);
      }

      if (!armsBehind) drawArms();

      if (st.tint && st.tint.amount > 0) {
        sctx.globalCompositeOperation = 'source-atop';
        sctx.globalAlpha = Math.min(1, st.tint.amount);
        sctx.fillStyle = st.tint.color;
        sctx.fillRect(0, 0, 64, 64);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
      }

      // blit with squash/scale about the feet anchor. Destination size and position snap to whole
      // pixels so every sprite pixel stays a uniform block after the stage's integer upscale.
      const { dx0, dy0, dw, dh } = blitRect(st);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, dx0, dy0, dw, dh);
      ctx.restore();
    },
  };
}

/** Static metrics from the parts: top-most pixel (head, hair, neutral ears) and peek depth. */
export function computeMetrics(def: RigDef): CharMetrics {
  const tops = [def.head.oy, def.ears.neutral.L.oy, def.ears.neutral.R.oy];
  if (def.hair) tops.push(def.hair.oy);
  const top = Math.min(...tops);
  return {
    top,
    peekDepth: Math.round(def.eye.cy + def.eye.hh + 5 - top),
    shadowW: def.shadowW,
  };
}

export const defaultPoses = (): Record<PoseName, PoseParams> => ({
  sit: { bodyDy: 0, headDy: 0, headDx: 0, sx: 1, sy: 1, feetSpread: 0 },
  crouch: { bodyDy: 3, headDy: 5, headDx: 0, sx: 1.06, sy: 0.92, feetSpread: 0 },
  pounce: { bodyDy: -2, headDy: -3, headDx: 0, sx: 0.92, sy: 1.12, feetSpread: 2, still: true },
  sleep: { bodyDy: 3, headDy: 10, headDx: 0, sx: 1.1, sy: 0.9, feetSpread: 0 },
  stretch: { bodyDy: -1, headDy: -2, headDx: 0, sx: 0.96, sy: 1.08, feetSpread: 1 },
  alert: { bodyDy: -1, headDy: -1, headDx: 0, sx: 0.97, sy: 1.04, feetSpread: 0, still: true },
});

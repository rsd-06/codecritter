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
  Character,
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
  /** auto-show cane when paws are down (Yoda) */
  autoProp?: PropName;
  /** blush cheek centres, sweat pos, vein pos, steam x offsets */
  face: { blushY: number; blushDx: number; sweat: Pt; vein: Pt; tearY: number };
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
    for (const k of [-1, 0, 1]) {
      const cx = Math.round(h[0] + ux * (spec.hr + 0.6 + (k === 0 ? 0.6 : 0)) + px * k * 1.7 + clawVariant * 0);
      const cy = Math.round(h[1] + uy * (spec.hr + 0.6 + (k === 0 ? 0.6 : 0)) + py * k * 1.7);
      b.set(cx - 0, cy - 0, spec.claw);
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

const sheetCache = new Map<number, Part>();
/** Paper hanging from the roll; `len` rows long. */
export function paperSheet(len: number): Part {
  const hit = sheetCache.get(len);
  if (hit) return hit;
  const b = new GridBuilder();
  b.rect(25, 50, 14, len, 'P');
  for (let y = 3; y < len - 1; y += 3) b.rect(27, 50 + y, y % 2 ? 8 : 10, 1, 'Q');
  b.rect(25, 50 + len - 1, 14, 1, 'Q');
  const part = makePart(b.rows(), { outlineCh: 'o' });
  sheetCache.set(len, part);
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

const KIND_LID: Partial<Record<EyeKind, number>> = { half: 0.42, sleepy: 0.62, squint: 0.38 };

/** Draw both eyes. Returns nothing; all procedural, pupils follow look. */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  spec: EyeSpec,
  kind: EyeKind,
  open: number,
  lookX: number,
  lookY: number,
  colors: ColorMap,
  dx: number,
  dy: number,
  mood: MouthName,
): void {
  const cy = spec.cy + dy;
  for (const side of [-1, 1] as const) {
    const cx = (side < 0 ? spec.lx : spec.rx) + dx;
    if (spec.style === 'solid') drawSolidEye(ctx, spec, kind, open, lookX, lookY, colors, cx, cy, side, mood);
    else drawScleraEye(ctx, spec, kind, open, lookX, lookY, colors, cx, cy, side, mood);
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
  _mood: MouthName,
): void {
  void side;
  const fullRx = spec.hw;
  const fullRy = spec.hh;
  if (kind === 'closed' || kind === 'happy') {
    arc(ctx, cx, spec.hw, cy, C['e']!, kind === 'happy');
    if (kind === 'closed') {
      // flat sleepy lid with a lash tick
      px(ctx, cx - 3, cy + 1, 7, 1, C['e']!);
      px(ctx, cx - 4, cy, 1, 1, C['e']!);
      px(ctx, cx + 3, cy, 1, 1, C['e']!);
    }
    return;
  }
  if (kind === 'hearts') {
    drawSprite(ctx, HEART, Math.round(cx - 3.5), Math.round(cy - 3), C);
    px(ctx, cx - 2, cy - 2, 1, 1, C['W']!);
    return;
  }
  if (kind === 'dizzy') {
    ctx.fillStyle = C['W']!;
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy + i - 0.5), 1, 1);
      ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy - i - 0.5), 1, 1);
    }
    return;
  }
  const wide = kind === 'wide';
  const rx = fullRx + (wide ? 0.6 : 0);
  const ry = (fullRy + (wide ? 1.2 : 0)) * Math.max(0.12, open);
  let lookXe = lookX;
  if (kind === 'side-eye') lookXe = side * 0 + (lookX >= 0 ? 1 : -1);
  const ox = Math.round(lookXe * 2);
  const oy = Math.round(lookY * 1.5);
  const lid = KIND_LID[kind] ?? 0;
  const top = cy + oy - ry;
  const clipTop = top + lid * 2 * ry;
  const clipBot = kind === 'squint' ? cy + oy + ry - lid * 2 * ry : Infinity;
  const ecy = cy + oy + (kind === 'sleepy' ? 1 : 0);
  fillEllipse(ctx, cx + ox, ecy, rx, ry, C['e']!, clipTop, clipBot);
  const visible = (clipBot === Infinity ? cy + oy + ry : clipBot) - clipTop;
  if (visible >= 5 && open > 0.6) {
    px(ctx, cx + ox - 2.5, Math.max(clipTop + 1, top + 1.5), 2, 2, C['k']!);
    px(ctx, cx + ox + 1, Math.min(cy + oy + ry - 2, ecy + 2), 1, 1, C['k']!);
  }
  if (kind === 'sparkle') {
    const sx = Math.round(cx + ox - 1);
    const sy = Math.round(cy + oy - 2);
    px(ctx, sx, sy - 1, 1, 5, C['W']!);
    px(ctx, sx - 1, sy + 1, 3, 1, C['W']!);
  }
  // eyelid line for sleepy/half (solid eyes read as a flat top edge)
  if (lid > 0 && visible >= 2) px(ctx, cx + ox - rx + 0.5, clipTop - 1, rx * 2 - 1, 1, C['d']!);
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
  side: number,
  mood: MouthName,
): void {
  const rx = spec.hw;
  const ry = spec.hh;
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
    px(ctx, cx - 3, cy + 1, 7, 1, C['o']!);
    px(ctx, cx - 4, cy, 1, 1, C['o']!);
    px(ctx, cx + 3, cy, 1, 1, C['o']!);
    return;
  }
  const wide = kind === 'wide';
  const bigRx = rx + (wide ? 0.8 : 0);
  const bigRy = ry + (wide ? 1 : 0);
  // dark ring then sclera
  fillEllipse(ctx, cx, cy, bigRx + 1, bigRy + 1, C['o']!);
  fillEllipse(ctx, cx, cy, bigRx, bigRy, C['V']!);
  if (kind === 'dizzy') {
    ctx.fillStyle = C['e']!;
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy + i - 0.5), 1, 1);
      ctx.fillRect(Math.round(cx + i - 0.5), Math.round(cy - i - 0.5), 1, 1);
    }
    return;
  }
  let lx = lookX;
  if (kind === 'side-eye') lx = lookX >= 0 ? 1 : -1;
  const ix = Math.round(lx * (bigRx - 1.4));
  const iy = Math.round(lookY * 1.2);
  const irisR = wide ? 1.6 : 2;
  fillEllipse(ctx, cx + ix, cy + iy, irisR, irisR + (kind === 'sparkle' ? 0.4 : 0), C['e']!);
  px(ctx, cx + ix - 1, cy + iy - 1, 1, 1, C['k']!);
  if (kind === 'sparkle') {
    const sx = Math.round(cx + ix);
    px(ctx, sx - 1, cy + iy - 2, 1, 4, C['W']!);
    px(ctx, sx - 2, cy + iy - 1, 3, 1, C['W']!);
  }
  // eyelids (body-coloured) from the top; blink adds more
  const top = cy - bigRy - 1;
  const total = bigRy * 2 + 2;
  let lidFrac = 0;
  if (kind === 'open' || kind === 'side-eye') lidFrac = spec.baseLid / total;
  else if (kind === 'half') lidFrac = 0.5;
  else if (kind === 'sleepy') lidFrac = 0.72;
  else if (kind === 'squint') lidFrac = 0.4;
  else if (kind === 'sparkle') lidFrac = spec.baseLid / total / 2;
  lidFrac = Math.min(1, lidFrac + (1 - open) * (1 - lidFrac));
  const lidRows = Math.round(lidFrac * total);
  if (lidRows > 0) {
    const bottom = top + lidRows;
    ctx.fillStyle = C['b']!;
    ctx.fillRect(Math.round(cx - bigRx - 1), Math.round(top), Math.ceil(bigRx * 2 + 2), lidRows);
    px(ctx, cx - bigRx - 1, bottom, Math.ceil(bigRx * 2 + 2), 1, C['o']!); // crease
  }
  if (kind === 'squint') {
    const bl = Math.round(total * 0.28);
    ctx.fillStyle = C['b']!;
    ctx.fillRect(Math.round(cx - bigRx - 1), Math.round(top + total - bl), Math.ceil(bigRx * 2 + 2), bl);
    px(ctx, cx - bigRx - 1, top + total - bl - 1, Math.ceil(bigRx * 2 + 2), 1, C['o']!);
  }
  void side;
  void mood;
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
  ctx.fillStyle = colors['o']!;
  for (const side of [-1, 1] as const) {
    const cx = Math.round((side < 0 ? spec.lx : spec.rx) + dx);
    for (let k = 0; k < 4; k++) {
      const i = side < 0 ? k : 3 - k; // 0 outer .. 3 inner
      let y = y0;
      if (kind === 'raised') y = y0 - 1 + (i === 0 || i === 3 ? 1 : 0);
      else if (kind === 'furrowed') y = y0 + Math.floor(i * 0.6);
      else if (kind === 'angry') y = y0 - 1 + i;
      else if (kind === 'worried') y = y0 + 2 - i;
      ctx.fillRect(cx - 2 + k, y, 1, kind === 'angry' ? 2 : 1);
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
        const x = 32 + side * 16 + (side > 0 ? -1 : -2) + dx;
        ctx.fillRect(x, 12 + dy - k * 2, 3, 2);
        ctx.fillRect(x + 1, 8 + dy - k * 2, 2, 2);
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

  return {
    id: def.id,
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
      const kind: EyeKind = st.pose === 'sleep' && ex.eyes !== 'dizzy' ? 'closed' : ex.eyes;
      drawEyes(sctx, def.eye, kind, eyeOpen, st.eyes.lookX, st.eyes.lookY, C, hdx, headDy, mouth);
      drawBrows(sctx, def.eye, ex.brows, C, hdx, headDy);
      blit(def.mouths[mouth], hdx, headDy);
      drawExtras(sctx, def, ex.extras, C, t, hdx, headDy);

      // props (before paws so hands wrap them)
      if (st.prop === 'cup' || (!st.prop && st.paws === 'hold-cup')) blit(def.props.cup, 0, bodyDy);
      if (st.prop === 'laptop') blit(def.props.laptop, 0, bodyDy);
      if (st.prop === 'note') blit(def.props.note, 0, bodyDy);
      if (st.prop === 'paper' || (!st.prop && st.paws === 'hold-paper')) {
        const p = st.propProgress ?? 0.5;
        const len = 2 + Math.round(p * 6) * 2;
        blit(paperSheet(len), 0, bodyDy);
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

      // blit with squash/scale about the feet anchor
      const sxx = st.squashX * pp.sx * st.scale;
      const syy = st.squashY * pp.sy * st.scale;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(32 + st.offsetX, FEET_Y + st.offsetY);
      ctx.scale(sxx, syy);
      ctx.drawImage(scratch, -32, -FEET_Y);
      ctx.restore();
    },
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

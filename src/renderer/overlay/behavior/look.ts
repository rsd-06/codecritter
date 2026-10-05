// Pure cursor -> pupil mapping (no DOM). Unit-tested in look.test.ts.
//
// Units: CursorSample carries the cursor and the overlay window bounds in the SAME screen unit
// (Electron: DIP; any unit works as long as both agree, e.g. physical px = DIP x DPR). The window
// shows the 128x112 logical stage stretched over its bounds, so screen units per logical px are
// winW / STAGE_W horizontally and winH / STAGE_H vertically. Eye positions come from the stage
// (logical coords, already including pose, squash/scale, hop offsets and peek placement).
import type { CursorSample } from '@shared/types';
import { STAGE_H, STAGE_W } from '../engine/types';

export interface LookGeom {
  /** eye centres in stage logical coords */
  l: { x: number; y: number };
  r: { x: number; y: number };
  /** eye radius in logical px */
  radius: number;
  /** rotation of the character layer (peek left/right), radians */
  rot: number;
}

export interface LookResult {
  /** mean horizontal look -1..1 (character-local frame) */
  x: number;
  /** mean vertical look -1..1 */
  y: number;
  /** convergence -1..1 (left eye = x + conv, right eye = x - conv) */
  conv: number;
}

/**
 * One eye: unit direction towards the target scaled by d / sqrt(d^2 + D^2) - like an eyeball that
 * looks at a point hovering D px in front of the screen. Proportional to distance close to the eye
 * (so the pupil points right at a cursor over the face) and saturating smoothly far away.
 */
export function eyeVector(dx: number, dy: number, depth: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const m = d / Math.sqrt(d * d + depth * depth);
  return { x: (dx / d) * m, y: (dy / d) * m };
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/** Per-eye look for a cursor sample. */
export function computeLook(c: CursorSample, g: LookGeom, stageW = STAGE_W, stageH = STAGE_H): LookResult {
  const ppx = c.winW > 0 ? c.winW / stageW : 2;
  const ppy = c.winH > 0 ? c.winH / stageH : ppx;
  const depth = Math.max(1, 1.5 * g.radius);
  const cos = Math.cos(-g.rot);
  const sin = Math.sin(-g.rot);
  const local = (sx: number, sy: number): { x: number; y: number } => {
    // screen delta -> logical delta -> character-local frame (undo the peek rotation)
    const lx = sx / ppx;
    const ly = sy / ppy;
    return { x: lx * cos - ly * sin, y: lx * sin + ly * cos };
  };
  const toEye = (e: { x: number; y: number }) => local(c.x - (c.winX + e.x * ppx), c.y - (c.winY + e.y * ppy));
  const dl = toEye(g.l);
  const dr = toEye(g.r);
  const L = eyeVector(dl.x, dl.y, depth);
  const R = eyeVector(dr.x, dr.y, depth);
  let conv = (L.x - R.x) / 2;
  // a little extra cross-eye when the cursor is right in front of the face, between the eyes
  const mid = local(c.x - (c.winX + ((g.l.x + g.r.x) / 2) * ppx), c.y - (c.winY + ((g.l.y + g.r.y) / 2) * ppy));
  const span = Math.max(1, Math.hypot(g.r.x - g.l.x, g.r.y - g.l.y));
  const near = 1 - Math.hypot(mid.x, mid.y) / span;
  if (near > 0) conv += 0.25 * near;
  return { x: clamp1((L.x + R.x) / 2), y: clamp1((L.y + R.y) / 2), conv: clamp1(conv) };
}

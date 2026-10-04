// Peek placement: where/how the character is drawn so its head peeks in from a screen edge.
// main slides the overlay window so only PEEK_VISIBLE_FRACTION of the stage stays on screen
// (src/main/peek/geometry.ts); everything beyond that band is off-screen, so the body can
// simply be drawn past the band edge.
import { PEEK_VISIBLE_FRACTION } from '@shared/constants';
import { BOX_Y, STAGE_H, STAGE_W } from './types';

export type PeekEdgeName = 'left' | 'right' | 'bottom';

/** Head pixels (along the peek axis) that show beyond the screen edge. */
export const PEEK_HEAD_PX = 28;
/** Extra travel (logical px) from "fully hidden" to the peeking position. */
export const PEEK_TRAVEL = 48;
/** Character box centre (local 32,32) height in the stage; head top is local y=4. */
const BOX_CY = BOX_Y + 32;

export interface PeekPlacement {
  /** Rotation of the character layer around the box centre, radians. */
  rot: number;
  /** Stage position of the box centre (rot != 0) or translation of the box origin (rot == 0). */
  x: number;
  y: number;
  /** Stage point just above/beside the head tip, where bubbles point (bubble clamps itself). */
  headX: number;
  headY: number;
  /** Horizontal range of the on-screen band, for bubble clamping. */
  minX: number;
  maxX: number;
}

/** p: 0 = hidden past the edge, 1 = fully peeking. */
export function peekPlacement(edge: PeekEdgeName, p: number): PeekPlacement {
  const f = PEEK_VISIBLE_FRACTION;
  const hide = Math.round((1 - Math.min(1, Math.max(0, p))) * PEEK_TRAVEL);
  if (edge === 'bottom') {
    const lineY = Math.round(STAGE_H * f);
    const y = lineY - PEEK_HEAD_PX - (BOX_Y + 4) + hide; // box-origin dy
    const headTop = BOX_Y + 4 + y;
    return {
      rot: 0,
      x: 0,
      y,
      headX: STAGE_W / 2,
      headY: Math.max(2, headTop - 1),
      minX: 1,
      maxX: STAGE_W - 1,
    };
  }
  if (edge === 'right') {
    // head points left (CCW 90deg); screen edge is the band's right side
    const lineX = Math.round(STAGE_W * f);
    const cx = lineX - PEEK_HEAD_PX + 28 + hide;
    return {
      rot: -Math.PI / 2,
      x: cx,
      y: BOX_CY,
      headX: cx - 28 + 10,
      headY: BOX_CY - 28,
      minX: 1,
      maxX: lineX - 1,
    };
  }
  const lineX = Math.round(STAGE_W * (1 - f));
  const cx = lineX + PEEK_HEAD_PX - 28 - hide;
  return {
    rot: Math.PI / 2,
    x: cx,
    y: BOX_CY,
    headX: cx + 28 - 10,
    headY: BOX_CY - 28,
    minX: lineX + 1,
    maxX: STAGE_W - 1,
  };
}

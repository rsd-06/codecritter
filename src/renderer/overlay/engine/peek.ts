// Peek placement: where/how the character is drawn so its head peeks in from a screen edge.
// main slides the overlay window so only PEEK_VISIBLE_FRACTION of the stage stays on screen
// (src-tauri/src/peek.rs); everything beyond that band is off-screen, so the body can
// simply be drawn past the band edge.
import { PEEK_VISIBLE_FRACTION } from '@shared/constants';
import { BOX_Y, STAGE_H, STAGE_W } from './types';

export type PeekEdgeName = 'left' | 'right' | 'bottom';

/** Default head pixels (along the peek axis) that show beyond the screen edge. */
export const PEEK_HEAD_PX = 28;
/** Extra travel (logical px) from "fully hidden" to the peeking position. */
export const PEEK_TRAVEL = 48;
/** Character box centre (local 32,32) height in the stage. */
const BOX_CY = BOX_Y + 32;

/** Per-character peek geometry: head top (box y) and how many px from it must show. */
export interface PeekMetrics {
  top: number;
  depth: number;
}
const DEFAULT_METRICS: PeekMetrics = { top: 4, depth: PEEK_HEAD_PX };

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
export function peekPlacement(edge: PeekEdgeName, p: number, m: PeekMetrics = DEFAULT_METRICS): PeekPlacement {
  const f = PEEK_VISIBLE_FRACTION;
  const travel = Math.max(PEEK_TRAVEL, m.depth + 20);
  const hide = Math.round((1 - Math.min(1, Math.max(0, p))) * travel);
  const reach = 32 - m.top; // box centre -> head top
  if (edge === 'bottom') {
    const lineY = Math.round(STAGE_H * f);
    const y = lineY - m.depth - (BOX_Y + m.top) + hide; // box-origin dy
    const headTop = BOX_Y + m.top + y;
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
    const cx = lineX - m.depth + reach + hide;
    return {
      rot: -Math.PI / 2,
      x: cx,
      y: BOX_CY,
      headX: cx - reach + 10,
      headY: BOX_CY - 28,
      minX: 1,
      maxX: lineX - 1,
    };
  }
  const lineX = Math.round(STAGE_W * (1 - f));
  const cx = lineX + m.depth - reach - hide;
  return {
    rot: Math.PI / 2,
    x: cx,
    y: BOX_CY,
    headX: cx + reach - 10,
    headY: BOX_CY - 28,
    minX: lineX + 1,
    maxX: STAGE_W - 1,
  };
}

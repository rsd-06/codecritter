// Idle breathing cadence (pure). Frames change at most ~1/s so a sleeping/idle critter needs ~1 redraw/s.
import type { PoseName } from './types';

interface BreathSpec {
  period: number;
  /** frame sequence over the period (equal-length slots) */
  frames: number[];
}

const SPECS: Partial<Record<PoseName, BreathSpec>> = {
  sit: { period: 3.2, frames: [0, 1, 1, 0] },
  sleep: { period: 4.8, frames: [0, 1, 2, 2, 1, 0] },
  stretch: { period: 3.2, frames: [0, 1, 1, 0] },
  crouch: { period: 2.4, frames: [0, 1, 1, 0] },
};

export function breathFrame(pose: PoseName, t: number): number {
  const s = SPECS[pose];
  if (!s) return 0;
  const slot = s.period / s.frames.length;
  const i = Math.floor((((t % s.period) + s.period) % s.period) / slot);
  return s.frames[Math.min(i, s.frames.length - 1)]!;
}

/** Seconds until breathFrame changes (Infinity for poses that do not breathe). */
export function timeToBreathChange(pose: PoseName, t: number): number {
  const s = SPECS[pose];
  if (!s) return Infinity;
  const slot = s.period / s.frames.length;
  const within = ((t % slot) + slot) % slot;
  return Math.max(0.02, slot - within);
}

import { screen } from 'electron';
import { IPC } from '../../shared/ipc';
import { isPeeking, isReactionsPaused } from '../hooks';
import { broadcast, getOverlayWindow, overlayVisible } from '../windows/overlay';

const FAST_MS = 33; // 30 Hz
const SLOW_MS = 250; // 4 Hz
const NEAR_PX = 400;
const FAST_SPEED = 600; // px/s

let timer: NodeJS.Timeout | null = null;
let last = { x: NaN, y: NaN, wx: NaN, wy: NaN, ww: NaN, wh: NaN };
let lastTs = 0;
let lastMoveTs = 0;

/** Pure: distance from point to rect (0 if inside). */
export function distToRect(
  x: number,
  y: number,
  r: { x: number; y: number; width: number; height: number },
): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

function loop(): void {
  let next: number;
  const w = getOverlayWindow();
  // Stop polling entirely while hidden / peeking / paused: re-check slowly.
  if (w && overlayVisible() && !isPeeking() && !isReactionsPaused()) {
    const p = screen.getCursorScreenPoint();
    const b = w.getBounds();
    const now = Date.now();
    const moved = p.x !== last.x || p.y !== last.y;
    const speed =
      moved && lastTs
        ? (Math.hypot(p.x - last.x, p.y - last.y) * 1000) / Math.max(1, now - lastTs)
        : 0;
    const winChanged =
      b.x !== last.wx || b.y !== last.wy || b.width !== last.ww || b.height !== last.wh;
    if (moved || winChanged) {
      last = { x: p.x, y: p.y, wx: b.x, wy: b.y, ww: b.width, wh: b.height };
      broadcast(IPC.cursor, {
        x: p.x,
        y: p.y,
        winX: b.x,
        winY: b.y,
        winW: b.width,
        winH: b.height,
      });
    }
    lastTs = now;
    if (moved) lastMoveTs = now;
    const still = now - lastMoveTs > 3000; // idle cursor: 4 Hz
    next = !still && (speed > FAST_SPEED || distToRect(p.x, p.y, b) <= NEAR_PX) ? FAST_MS : SLOW_MS;
  } else {
    lastTs = 0;
    next = 500;
  }
  timer = setTimeout(loop, next);
}

export function startCursorPoller(): void {
  if (timer) return;
  timer = setTimeout(loop, FAST_MS);
}

export function stopCursorPoller(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

import { screen } from 'electron';
import { IPC } from '../../shared/ipc';
import { isReactionsPaused } from '../hooks';
import { broadcast, overlayVisible } from '../windows/overlay';
import { InputAggregator } from './aggregator';

interface Hook {
  on(ev: string, cb: (e: never) => void): void;
  removeAllListeners(): void;
  start(): void;
  stop(): void;
}

let timer: NodeJS.Timeout | null = null;
let hook: Hook | null = null;
let fallback = false;

export function isFallbackMode(): boolean {
  return fallback;
}

/**
 * Starts global input aggregation. Key codes are never read: handlers ignore the event
 * argument for keydown, and only timestamps are stored.
 */
export function startInputMonitor(): void {
  if (timer) return;
  const a = new InputAggregator(Date.now());
  try {
    // Lazy require so a missing/blocked native module can't crash startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('uiohook-napi') as { uIOhook: Hook };
    hook = mod.uIOhook;
    hook.on('keydown', () => a.keyDown(Date.now()));
    hook.on('mousemove', ((e: { x: number; y: number }) =>
      a.mouseMove(e.x, e.y, Date.now())) as never);
    hook.on('wheel', ((e: { rotation: number }) => a.wheelEvent(e.rotation, Date.now())) as never);
    hook.start();
  } catch (err) {
    fallback = true;
    hook = null;
    console.warn('[input] uiohook-napi unavailable; mouse-only fallback:', (err as Error).message);
  }
  timer = setInterval(() => {
    const now = Date.now();
    if (fallback) {
      const p = screen.getCursorScreenPoint();
      a.mouseMove(p.x, p.y, now);
    }
    const s = a.tick(now);
    if (s && !isReactionsPaused() && overlayVisible()) broadcast(IPC.input, s);
  }, 100);
}

export function stopInputMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    hook?.removeAllListeners();
    hook?.stop();
  } catch {
    /* ignore */
  }
  hook = null;
}

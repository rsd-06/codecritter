import { PEEK_VISIBLE_FRACTION } from '../../shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullscreenDetector, peekForQuns, QUNS, type ActiveWin } from './detector';
import { isFullscreenOn, isShellOwner, peekRect } from './geometry';

const display = { x: 0, y: 0, width: 1920, height: 1080 };
const win = { x: 1500, y: 800, width: 256, height: 224 };

describe('geometry', () => {
  it('bottom peek shows top 35% at the bottom edge', () => {
    const r = peekRect(win, display, 'bottom');
    expect(r.y).toBe(1080 - Math.round(224 * PEEK_VISIBLE_FRACTION));
    expect(r.x).toBe(1500);
    expect(r.width).toBe(256);
  });
  it('left/right slide to the screen edge', () => {
    expect(peekRect(win, display, 'right').x).toBe(1920 - Math.round(256 * PEEK_VISIBLE_FRACTION));
    expect(peekRect(win, display, 'left').x).toBe(-Math.round(256 * (1 - PEEK_VISIBLE_FRACTION)));
  });
  it('respects display offset (second monitor)', () => {
    const d2 = { x: 1920, y: 0, width: 1280, height: 720 };
    const r = peekRect({ x: 2000, y: 400, width: 128, height: 112 }, d2, 'bottom');
    expect(r.y).toBe(720 - Math.round(112 * PEEK_VISIBLE_FRACTION));
  });
  it('fullscreen detection tolerates 2px and rejects maximized-with-taskbar', () => {
    expect(isFullscreenOn({ x: -1, y: 0, width: 1922, height: 1080 }, display)).toBe(true);
    expect(isFullscreenOn({ x: 0, y: 0, width: 1920, height: 1040 }, display)).toBe(false);
    expect(isShellOwner('explorer.exe')).toBe(true);
    expect(isShellOwner('chrome.exe')).toBe(false);
  });
});

describe('FullscreenDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports flips only, polls every 2 s, and clears on stop', async () => {
    let active: ActiveWin | undefined = { bounds: display, owner: { name: 'game.exe' } };
    const changes: boolean[] = [];
    const getActive = vi.fn(async () => active);
    const d = new FullscreenDetector({
      getActive,
      getDisplayBounds: () => display,
      onChange: (v) => changes.push(v),
    });
    d.start();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(changes).toEqual([true]);
    expect(getActive).toHaveBeenCalledTimes(2);
    active = { bounds: { ...display, height: 900 } };
    await vi.advanceTimersByTimeAsync(2000);
    expect(changes).toEqual([true, false]);
    active = { bounds: display };
    await vi.advanceTimersByTimeAsync(2000);
    d.stop();
    expect(changes).toEqual([true, false, true, false]);
  });

  it('is a no-op when the active window is unavailable', async () => {
    const changes: boolean[] = [];
    const d = new FullscreenDetector({
      getActive: async () => undefined,
      getDisplayBounds: () => display,
      onChange: (v) => changes.push(v),
    });
    d.start();
    await vi.advanceTimersByTimeAsync(6000);
    d.stop();
    expect(changes).toEqual([]);
  });
});

describe('Windows user-notification state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('maps QUNS values to peek', () => {
    expect([2, 3, 4].map(peekForQuns)).toEqual([true, true, true]);
    expect([1, 5, 6, 7, undefined].map(peekForQuns)).toEqual([false, false, false, false, false]);
    expect(QUNS.ACCEPTS_NOTIFICATIONS).toBe(5);
  });

  it('ignores a maximized window whose bounds equal the display (auto-hide taskbar)', async () => {
    let state: number | undefined = QUNS.ACCEPTS_NOTIFICATIONS;
    const changes: boolean[] = [];
    const d = new FullscreenDetector({
      getActive: async () => ({ bounds: display, owner: { name: 'chrome.exe' } }),
      getDisplayBounds: () => display,
      queryState: () => state,
      onChange: (v) => changes.push(v),
    });
    d.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(changes).toEqual([]);
    state = QUNS.RUNNING_D3D_FULL_SCREEN;
    await vi.advanceTimersByTimeAsync(2000);
    state = QUNS.QUIET_TIME;
    await vi.advanceTimersByTimeAsync(2000);
    d.stop();
    expect(changes).toEqual([true, false]);
  });
});

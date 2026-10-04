import { isFullscreenOn, isShellOwner, type Rect } from './geometry';

export interface ActiveWin {
  bounds: Rect;
  title?: string;
  owner?: { name?: string };
}

/** SHQueryUserNotificationState values (Windows). */
export const QUNS = {
  NOT_PRESENT: 1,
  BUSY: 2,
  RUNNING_D3D_FULL_SCREEN: 3,
  PRESENTATION_MODE: 4,
  ACCEPTS_NOTIFICATIONS: 5,
  QUIET_TIME: 6,
  APP: 7,
} as const;

/** True only for states where the shell reports a real full-screen / presenting app. */
export function peekForQuns(state: number | undefined): boolean {
  return (
    state === QUNS.BUSY ||
    state === QUNS.RUNNING_D3D_FULL_SCREEN ||
    state === QUNS.PRESENTATION_MODE
  );
}

export interface DetectorDeps {
  /** Foreground window, or undefined when unknown/unavailable. */
  getActive(): Promise<ActiveWin | undefined>;
  /**
   * Windows only: returns the SHQueryUserNotificationState value (undefined when unavailable).
   * When it returns a number it is authoritative and the window-bounds heuristic is skipped:
   * a maximized window on an auto-hide taskbar has bounds == display bounds but is NOT fullscreen.
   */
  queryState?(): number | undefined;
  /** Display the overlay lives on, in the same coordinate space as `getActive` bounds. */
  getDisplayBounds(): Rect | null;
  /** Platform the heuristic assumes (injected for tests); defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Called only when the fullscreen state flips. */
  onChange(fullscreen: boolean): void;
}

export const POLL_MS = 2000;

/** Polls the foreground window every 2 s; reports flips of "fullscreen on overlay display". */
export class FullscreenDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state = false;
  private busy = false;

  constructor(
    private deps: DetectorDeps,
    private timers = { setInterval, clearInterval },
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const q = this.deps.queryState?.();
      let fs: boolean;
      if (typeof q === 'number') {
        fs = peekForQuns(q);
      } else {
        // mac/linux heuristic (limits: exclusive-fullscreen vs. maximized-on-hidden-dock cannot be
        // told apart by geometry alone, so we require covering the full display *bounds*, a
        // non-shell owner and (mac) a non-empty title; the desktop/Finder has none).
        const w = await this.deps.getActive();
        const d = this.deps.getDisplayBounds();
        const macDesktop = (this.deps.platform ?? process.platform) === 'darwin' && !w?.title?.trim();
        fs =
          !!w && !!d && !macDesktop && !isShellOwner(w.owner?.name) && isFullscreenOn(w.bounds, d);
      }
      if (fs !== this.state) {
        this.state = fs;
        this.deps.onChange(fs);
      }
    } catch {
      /* detection is best-effort */
    } finally {
      this.busy = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.timers.setInterval(() => void this.poll(), POLL_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
    if (this.state) {
      this.state = false;
      this.deps.onChange(false);
    }
  }
}

type GetWindows = { activeWindow(opts?: Record<string, unknown>): Promise<ActiveWin | undefined> };
let gw: GetWindows | null | undefined;

/** Lazy, optional `get-windows` (ESM, native helper). Returns undefined when unavailable. */
export async function activeWindowOrUndefined(): Promise<ActiveWin | undefined> {
  if (gw === null) return undefined;
  try {
    gw ??= (await import('get-windows')) as unknown as GetWindows;
    return await gw.activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
  } catch {
    gw = null;
    return undefined;
  }
}

type QueryFn = (out: number[]) => number;
let qfn: QueryFn | null | undefined;

/** Lazy koffi binding to shell32!SHQueryUserNotificationState. undefined off-Windows/on failure. */
export function queryUserNotificationState(): number | undefined {
  if (process.platform !== 'win32' || qfn === null) return undefined;
  try {
    if (!qfn) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi') as {
        load(n: string): { func(sig: string): QueryFn };
      };
      qfn = koffi
        .load('shell32.dll')
        .func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
    }
    const out = [0];
    return qfn(out) === 0 ? out[0] : undefined;
  } catch {
    qfn = null;
    return undefined;
  }
}

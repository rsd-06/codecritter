import { isFullscreenOn, isShellOwner, type Rect } from './geometry';

export interface ActiveWin {
  bounds: Rect;
  owner?: { name?: string };
}

export interface DetectorDeps {
  /** Foreground window, or undefined when unknown/unavailable. */
  getActive(): Promise<ActiveWin | undefined>;
  /** Display the overlay lives on, in the same coordinate space as `getActive` bounds. */
  getDisplayBounds(): Rect | null;
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
      const w = await this.deps.getActive();
      const d = this.deps.getDisplayBounds();
      const fs = !!w && !!d && !isShellOwner(w.owner?.name) && isFullscreenOn(w.bounds, d);
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

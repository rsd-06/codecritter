// Dirty-flag frame scheduler. No rAF loop: ticks are scheduled with setTimeout only when something
// is animating (~12 fps) or when the next autonomous change (breath step, blink) is due.
import { FixedStepper } from './spring';

export interface Tickable {
  /** advance simulation by a fixed step (seconds) */
  update(dt: number): void;
  /** draw the current state */
  render(): void;
  /** seconds until the next tick is needed (1/12 while animating; Infinity if nothing is pending) */
  nextDelay(): number;
}

export const FPS = 12;
const MAX_IDLE = 5; // safety wake (s)

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTick = 0;
  private readonly stepper = new FixedStepper(1 / FPS, FPS * 6);
  /** diagnostics */
  ticks = 0;

  constructor(
    private readonly target: Tickable,
    private readonly now: () => number = () => performance.now() / 1000,
    private readonly hidden: () => boolean = () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden',
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stepper.reset(this.now());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
    this.wake();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVis);
  }

  private onVis = (): void => {
    if (this.hidden()) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    } else {
      this.stepper.reset(this.now());
      this.wake();
    }
  };

  /** Something changed (event, pointer): tick soon, but never faster than FPS. */
  wake(): void {
    if (!this.running || this.hidden()) return;
    const sinceLast = this.now() - this.lastTick;
    this.schedule(Math.max(0, 1 / FPS - sinceLast));
  }

  private schedule(delaySec: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, Math.max(0, delaySec) * 1000);
  }

  private tick = (): void => {
    this.timer = null;
    if (!this.running || this.hidden()) return;
    const now = this.now();
    const steps = this.stepper.advance(now);
    for (let i = 0; i < steps; i++) this.target.update(this.stepper.step);
    this.target.render();
    this.lastTick = now;
    this.ticks++;
    const d = this.target.nextDelay();
    if (Number.isFinite(d)) this.schedule(Math.min(MAX_IDLE, Math.max(d, 1 / FPS - 0.001)));
    else this.schedule(MAX_IDLE);
  };
}

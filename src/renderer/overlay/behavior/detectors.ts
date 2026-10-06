// Allocation-free gesture detectors (pure): direction reversals for petting / drag shaking.

/**
 * Counts direction reversals of a 1-D position stream. A reversal needs a movement of at least
 * `minSeg` against the current direction. Reversal times live in a small ring buffer.
 */
export class ReversalCounter {
  private readonly times = new Float64Array(10);
  private head = 0;
  private dir = 0;
  private ext = 0;
  private started = false;

  constructor(
    private readonly minSeg: number,
    private readonly windowS: number,
  ) {}

  reset(): void {
    this.times.fill(-1e9);
    this.head = 0;
    this.dir = 0;
    this.started = false;
  }

  push(pos: number, t: number): void {
    if (!this.started) {
      this.times.fill(-1e9);
      this.started = true;
      this.ext = pos;
      this.dir = 0;
      return;
    }
    if (this.dir === 0) {
      if (Math.abs(pos - this.ext) >= this.minSeg) {
        this.dir = pos > this.ext ? 1 : -1;
        this.ext = pos;
      }
      return;
    }
    if (this.dir > 0) {
      if (pos > this.ext) this.ext = pos;
      else if (this.ext - pos >= this.minSeg) this.reverse(pos, t, -1);
    } else if (pos < this.ext) this.ext = pos;
    else if (pos - this.ext >= this.minSeg) this.reverse(pos, t, 1);
  }

  private reverse(pos: number, t: number, dir: number): void {
    this.dir = dir;
    this.ext = pos;
    this.times[this.head] = t;
    this.head = (this.head + 1) % this.times.length;
  }

  /** Reversals inside the window ending at `t`. */
  count(t: number): number {
    if (!this.started) return 0;
    let n = 0;
    for (let i = 0; i < this.times.length; i++) if (t - this.times[i]! <= this.windowS && t >= this.times[i]!) n++;
    return n;
  }

  /** Time of the newest reversal (or -Infinity). */
  get last(): number {
    if (!this.started) return -Infinity;
    const v = this.times[(this.head + this.times.length - 1) % this.times.length]!;
    return v < -1e8 ? -Infinity : v;
  }
}

/** Petting = >= 3 reversals in 1.5 s while the cursor is over the head region. */
export const PET_REVERSALS = 3;
export const PET_WINDOW_S = 1.5;
export const PET_MIN_SEG = 4; // logical px

export class PettingDetector {
  private readonly x = new ReversalCounter(PET_MIN_SEG, PET_WINDOW_S);
  private readonly y = new ReversalCounter(PET_MIN_SEG, PET_WINDOW_S);
  private inside = false;

  /** (lx, ly) = cursor offset from the head centre in logical stage px. */
  push(lx: number, ly: number, t: number): boolean {
    const over = lx >= -HEAD_HALF_W && lx <= HEAD_HALF_W && ly >= -HEAD_UP && ly <= HEAD_DOWN;
    if (!over) {
      if (this.inside) {
        this.x.reset();
        this.y.reset();
      }
      this.inside = false;
      return false;
    }
    this.inside = true;
    this.x.push(lx, t);
    this.y.push(ly, t);
    return this.x.count(t) >= PET_REVERSALS || this.y.count(t) >= PET_REVERSALS;
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.inside = false;
  }
}

/** Click frenzy: this many mouse clicks inside one second. */
export const FRENZY_CPS = 6;
/** The reaction stays this long after the last qualifying sample. */
export const FRENZY_HOLD_S = 1.6;

/** Latching "clicking way too fast" detector over the aggregator's clicks-per-second count (pure). */
export class ClickFrenzyDetector {
  private until = -1e9;

  /** Feed a sample; true when this sample STARTS a new frenzy. */
  push(clicksPerSec: number, t: number): boolean {
    if (clicksPerSec < FRENZY_CPS) return false;
    const fresh = t >= this.until;
    this.until = t + FRENZY_HOLD_S;
    return fresh;
  }

  active(t: number): boolean {
    return t < this.until;
  }

  /** Seconds the reaction still has to run. */
  remaining(t: number): number {
    return Math.max(0, this.until - t);
  }

  reset(): void {
    this.until = -1e9;
  }
}

/** Head hit region around Stage.head (logical px). */
export const HEAD_HALF_W = 22;
export const HEAD_UP = 22;
export const HEAD_DOWN = 14;

/** Drag shake: reversals of the dragged window's x/y deltas. */
export const SHAKE_REVERSALS = 3;
export const SHAKE_WINDOW_S = 1.2;
export const SHAKE_MIN_SEG = 10; // screen px
export const DIZZY_AFTER_S = 2;

export class ShakeDetector {
  private readonly x = new ReversalCounter(SHAKE_MIN_SEG, SHAKE_WINDOW_S);
  private readonly y = new ReversalCounter(SHAKE_MIN_SEG, SHAKE_WINDOW_S);
  private px = 0;
  private py = 0;
  private shakingSince = -1;
  private lastShaking = -1;

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.px = this.py = 0;
    this.shakingSince = this.lastShaking = -1;
  }

  move(dx: number, dy: number, t: number): void {
    this.px += dx;
    this.py += dy;
    this.x.push(this.px, t);
    this.y.push(this.py, t);
    if (this.count(t) >= SHAKE_REVERSALS) {
      if (this.shakingSince < 0) this.shakingSince = t;
      this.lastShaking = t;
    }
  }

  count(t: number): number {
    return Math.max(this.x.count(t), this.y.count(t));
  }

  /** Called every tick: forget a lapsed shake. */
  tick(t: number): void {
    if (this.shakingSince >= 0 && t - this.lastShaking > 0.7) this.shakingSince = -1;
  }

  shaking(t: number): boolean {
    return this.count(t) >= SHAKE_REVERSALS;
  }

  /** shaken continuously for > DIZZY_AFTER_S */
  dizzy(t: number): boolean {
    return this.shakingSince >= 0 && t - this.shakingSince >= DIZZY_AFTER_S && t - this.lastShaking <= 0.7;
  }
}

import type { InputSample } from '../../shared/types';

const KEY_WINDOW_MS = 1000;
const BURST_MS = 150;
const MOUSE_WINDOW_MS = 200;
const RING = 512;

/**
 * Pure input aggregator. Stores only timestamps/counts - never key identities.
 * No allocation on the event hot path (fixed ring buffers).
 */
export class InputAggregator {
  private keys = new Float64Array(RING);
  private keyHead = 0; // next write index
  private keyCount = 0;
  private wheel = 0;
  private lastInput: number;
  private lastX = NaN;
  private lastY = NaN;
  // mouse distance buckets: 20 buckets x 10 ms
  private mt = new Float64Array(RING);
  private md = new Float64Array(RING);
  private mHead = 0;
  private mCount = 0;
  private lastEmit: InputSample | null = null;
  private lastEmitAt = -Infinity;

  constructor(
    now: number,
    private heartbeatMs = 1000,
    private idleHeartbeatMs = 10000,
  ) {
    this.lastInput = now;
  }

  keyDown(now: number): void {
    this.keys[this.keyHead] = now;
    this.keyHead = (this.keyHead + 1) % RING;
    if (this.keyCount < RING) this.keyCount++;
    this.lastInput = now;
  }

  wheelEvent(rotation: number, now: number): void {
    this.wheel += rotation;
    this.lastInput = now;
  }

  mouseMove(x: number, y: number, now: number): void {
    if (!Number.isNaN(this.lastX)) {
      const d = Math.hypot(x - this.lastX, y - this.lastY);
      if (d > 0) {
        this.mt[this.mHead] = now;
        this.md[this.mHead] = d;
        this.mHead = (this.mHead + 1) % RING;
        if (this.mCount < RING) this.mCount++;
        this.lastInput = now;
      }
    }
    this.lastX = x;
    this.lastY = y;
  }

  /** Current aggregate view. Consumes the wheel accumulator. */
  sample(now: number): InputSample {
    let kps = 0;
    let burst = false;
    for (let i = 0; i < this.keyCount; i++) {
      const age = now - this.keys[(this.keyHead - 1 - i + RING) % RING]!;
      if (age > KEY_WINDOW_MS) break;
      kps++;
      if (age <= BURST_MS) burst = true;
    }
    let dist = 0;
    for (let i = 0; i < this.mCount; i++) {
      const idx = (this.mHead - 1 - i + RING) % RING;
      if (now - this.mt[idx]! > MOUSE_WINDOW_MS) break;
      dist += this.md[idx]!;
    }
    const scrollDelta = this.wheel;
    this.wheel = 0;
    return {
      keysPerSec: kps,
      keyBurst: burst,
      scrollDelta,
      mouseSpeed: Math.round((dist * 1000) / MOUSE_WINDOW_MS),
      idleMs: Math.max(0, now - this.lastInput),
    };
  }

  /**
   * Returns a sample to send, or null when nothing to say.
   * Sends on change (idleMs excluded), then at most a slow heartbeat so the renderer can
   * extrapolate idleMs: `heartbeatMs` while recently active, `idleHeartbeatMs` once quiet.
   */
  tick(now: number): InputSample | null {
    const s = this.sample(now);
    const p = this.lastEmit;
    const quiet = s.keysPerSec === 0 && s.scrollDelta === 0 && s.mouseSpeed === 0 && !s.keyBurst;
    const changed =
      !p ||
      p.keysPerSec !== s.keysPerSec ||
      p.keyBurst !== s.keyBurst ||
      s.scrollDelta !== 0 ||
      p.scrollDelta !== 0 ||
      p.mouseSpeed !== s.mouseSpeed;
    const hb = quiet && s.idleMs > 5000 ? this.idleHeartbeatMs : this.heartbeatMs;
    if (changed || now - this.lastEmitAt >= hb) {
      this.lastEmit = s;
      this.lastEmitAt = now;
      return s;
    }
    return null;
  }
}

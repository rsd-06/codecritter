// Tiny damped spring + fixed-step accumulator (both pure).
export class Spring {
  value: number;
  vel = 0;
  constructor(
    public target: number,
    public stiffness = 220,
    public damping = 14,
  ) {
    this.value = target;
  }
  /** Semi-implicit Euler, sub-stepped for stability at low frame rates. */
  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (this.stiffness * (this.target - this.value) - this.damping * this.vel) * h;
      this.value += this.vel * h;
    }
  }
  get settled(): boolean {
    return Math.abs(this.value - this.target) < 0.004 && Math.abs(this.vel) < 0.02;
  }
  snap(v = this.target): void {
    this.value = this.target = v;
    this.vel = 0;
  }
}

/** Accumulates real time into fixed steps. */
export class FixedStepper {
  private acc = 0;
  private last = -1;
  constructor(
    readonly step = 1 / 12,
    private maxSteps = 4,
  ) {}
  /** Returns how many fixed steps to run for the timestamp `now` (seconds). */
  advance(now: number): number {
    if (this.last < 0) this.last = now;
    this.acc += Math.min(now - this.last, this.step * this.maxSteps);
    this.last = now;
    let n = 0;
    while (this.acc >= this.step - 1e-9 && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    return n;
  }
  /** Forget elapsed time (after pause / long sleep). */
  reset(now: number): void {
    this.last = now;
    this.acc = 0;
  }
}

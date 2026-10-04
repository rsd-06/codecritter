import { describe, expect, it } from 'vitest';
import { FixedStepper, Spring } from './spring';

describe('Spring', () => {
  it('converges to target', () => {
    const s = new Spring(0);
    s.value = 1;
    for (let i = 0; i < 120; i++) s.step(1 / 12);
    expect(s.settled).toBe(true);
    expect(s.value).toBeCloseTo(0, 2);
  });
  it('overshoots when underdamped', () => {
    const s = new Spring(0, 300, 6);
    s.value = 1;
    let min = 1;
    for (let i = 0; i < 60; i++) {
      s.step(1 / 60);
      min = Math.min(min, s.value);
    }
    expect(min).toBeLessThan(-0.05);
  });
});

describe('FixedStepper', () => {
  it('produces fixed steps', () => {
    const f = new FixedStepper(0.1);
    expect(f.advance(0)).toBe(0);
    expect(f.advance(0.05)).toBe(0);
    expect(f.advance(0.1)).toBe(1);
    expect(f.advance(0.35)).toBe(2);
  });
  it('caps catch-up after a long pause', () => {
    const f = new FixedStepper(0.1, 3);
    f.advance(0);
    expect(f.advance(100)).toBe(3);
  });
});

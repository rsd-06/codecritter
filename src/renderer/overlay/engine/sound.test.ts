import { describe, expect, it } from 'vitest';
import { planGibberish } from './sound';

describe('planGibberish', () => {
  it('scales with text length and stays in range', () => {
    let s = 7;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const short = planGibberish(2, rand);
    const long = planGibberish(80, rand);
    expect(short.length).toBeGreaterThanOrEqual(3);
    expect(long.length).toBe(10);
    for (const b of long) {
      expect(b.freq).toBeGreaterThanOrEqual(380);
      expect(b.freq).toBeLessThanOrEqual(1900);
      expect(b.dur).toBeGreaterThan(0.04);
    }
  });
});

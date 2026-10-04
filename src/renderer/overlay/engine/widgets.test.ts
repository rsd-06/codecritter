import { describe, expect, it } from 'vitest';
import { formatMMSS } from './widgets';
import { breathFrame, timeToBreathChange } from './breath';

describe('formatMMSS', () => {
  it('formats and clamps', () => {
    expect(formatMMSS(25 * 60 * 1000)).toBe('25:00');
    expect(formatMMSS(61_000)).toBe('01:01');
    expect(formatMMSS(-5)).toBe('00:00');
    expect(formatMMSS(59_100)).toBe('01:00');
  });
});

describe('breath', () => {
  it('cycles frames and reports time to next change', () => {
    expect(breathFrame('sit', 0)).toBe(0);
    expect(breathFrame('sit', 1)).toBe(1);
    expect(breathFrame('alert', 5)).toBe(0);
    expect(timeToBreathChange('alert', 0)).toBe(Infinity);
    expect(timeToBreathChange('sit', 0.1)).toBeCloseTo(0.9, 5);
  });
});

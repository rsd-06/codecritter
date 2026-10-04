import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler, type Tickable } from './scheduler';

describe('Scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (delay: () => number) => {
    let now = 0;
    const t = { updates: 0, renders: 0 };
    const target: Tickable = {
      update: () => t.updates++,
      render: () => t.renders++,
      nextDelay: delay,
    };
    const s = new Scheduler(target, () => now / 1000, () => false);
    vi.spyOn(globalThis, 'setTimeout');
    const advance = (ms: number) => {
      for (let i = 0; i < ms; i += 5) {
        now += 5;
        vi.advanceTimersByTime(5);
      }
    };
    return { s, t, advance };
  };

  it('runs at ~12 fps while animating', () => {
    const { s, t, advance } = make(() => 1 / 12);
    s.start();
    advance(2000);
    expect(t.renders).toBeGreaterThan(18);
    expect(t.renders).toBeLessThan(30);
    s.stop();
  });

  it('idles with very few redraws and still advances sim time', () => {
    const { s, t, advance } = make(() => 1.0);
    s.start();
    advance(5000);
    expect(t.renders).toBeLessThanOrEqual(7);
    expect(t.updates).toBeGreaterThan(40); // fixed steps keep timers honest
    s.stop();
  });

  it('wake() redraws promptly but not faster than fps cap', () => {
    const { s, t, advance } = make(() => Infinity);
    s.start();
    advance(100);
    const before = t.renders;
    for (let i = 0; i < 30; i++) {
      s.wake();
      advance(10);
    }
    expect(t.renders - before).toBeLessThanOrEqual(5);
    expect(t.renders - before).toBeGreaterThanOrEqual(2);
    s.stop();
  });
});

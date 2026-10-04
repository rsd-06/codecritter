import { describe, expect, it } from 'vitest';
import { InputAggregator } from './aggregator';

describe('InputAggregator', () => {
  it('counts keys per second in a 1s window and flags burst', () => {
    const a = new InputAggregator(0);
    for (let t = 0; t < 1000; t += 100) a.keyDown(t);
    let s = a.sample(1100);
    expect(s.keysPerSec).toBe(9);
    expect(s.keyBurst).toBe(false);
    a.keyDown(1050);
    s = a.sample(1100);
    expect(s.keyBurst).toBe(true);
    expect(a.sample(2500).keysPerSec).toBe(0);
  });
  it('sums wheel since last sample', () => {
    const a = new InputAggregator(0);
    a.wheelEvent(3, 10);
    a.wheelEvent(-1, 20);
    expect(a.sample(30).scrollDelta).toBe(2);
    expect(a.sample(40).scrollDelta).toBe(0);
  });
  it('computes mouse speed over 200ms and decays', () => {
    const a = new InputAggregator(0);
    a.mouseMove(0, 0, 0);
    a.mouseMove(30, 40, 100); // 50px
    expect(a.sample(150).mouseSpeed).toBe(250);
    expect(a.sample(500).mouseSpeed).toBe(0);
  });
  it('tracks idleMs', () => {
    const a = new InputAggregator(0);
    a.keyDown(100);
    expect(a.sample(600).idleMs).toBe(500);
  });
  it('emits on change, stays silent when quiet, slow heartbeat when idle', () => {
    const a = new InputAggregator(0, 1000, 10000);
    expect(a.tick(0)).not.toBeNull(); // first
    expect(a.tick(100)).toBeNull();
    a.keyDown(150);
    expect(a.tick(200)).not.toBeNull();
    expect(a.tick(300)).toBeNull(); // same kps / burst...
    expect(a.tick(1300)).not.toBeNull(); // key left window -> change
    expect(a.tick(2000)).toBeNull();
    expect(a.tick(6500)).toBeNull(); // idle > 5s: 10s heartbeat
    expect(a.tick(11400)).not.toBeNull();
  });
});

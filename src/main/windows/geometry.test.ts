import { describe, expect, it } from 'vitest';
import { clampRect, defaultRectFor } from './geometry';

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 256, height: 224 };

describe('defaultRectFor', () => {
  it('sits left of the tray on win32', () => {
    expect(defaultRectFor(wa, size, 'win32')).toEqual({ x: 1920 - 256 - 260, y: 1040 - 224, ...size });
  });
  it('uses a 24px margin on mac/linux', () => {
    expect(defaultRectFor(wa, size, 'darwin').x).toBe(1920 - 256 - 24);
    expect(defaultRectFor(wa, size, 'linux').y).toBe(816);
  });
  it('clamps on tiny work areas', () => {
    const r = defaultRectFor({ x: 100, y: 50, width: 300, height: 300 }, size, 'win32');
    expect(r.x).toBe(100);
    expect(r.y).toBe(126);
  });
});

describe('clampRect', () => {
  it('keeps rects inside', () => {
    expect(clampRect({ x: -50, y: 5000, ...size }, wa)).toEqual({ x: 0, y: 816, ...size });
  });
});

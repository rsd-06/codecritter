import type { CursorSample } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { STAGE_H, STAGE_W } from '../engine/types';
import { computeLook, eyeVector, type LookGeom } from './look';

// Stitch-like face in stage coords: eyes 11 px apart, radius 3.5
const G: LookGeom = { l: { x: 58.3, y: 83.6 }, r: { x: 69.7, y: 83.6 }, radius: 3.5, rot: 0 };

/** Cursor at a logical stage point, window at (wx, wy) with integer scale and optional DPR units. */
function at(lx: number, ly: number, scale = 2, dpr = 1, wx = 1000, wy = 600): CursorSample {
  const k = scale * dpr;
  return {
    x: (wx + lx * scale) * dpr,
    y: (wy + ly * scale) * dpr,
    winX: wx * dpr,
    winY: wy * dpr,
    winW: STAGE_W * k,
    winH: STAGE_H * k,
  };
}

const eyeL = (r: { x: number; conv: number }) => r.x + r.conv;
const eyeR = (r: { x: number; conv: number }) => r.x - r.conv;

describe('eyeVector', () => {
  it('is zero at the eye centre and proportional close by', () => {
    expect(eyeVector(0, 0, 5)).toEqual({ x: 0, y: 0 });
    const a = eyeVector(1, 0, 5).x;
    const b = eyeVector(2, 0, 5).x;
    expect(b / a).toBeGreaterThan(1.8);
  });
  it('saturates far away without exceeding 1', () => {
    expect(eyeVector(500, 0, 5).x).toBeGreaterThan(0.99);
    expect(eyeVector(500, 0, 5).x).toBeLessThanOrEqual(1);
  });
});

describe('computeLook', () => {
  it('cursor directly over the left eye: left pupil centred, right eye looks left (converges)', () => {
    const r = computeLook(at(G.l.x, G.l.y), G);
    expect(Math.abs(eyeL(r))).toBeLessThan(0.2);
    expect(eyeR(r)).toBeLessThan(-0.8);
    expect(Math.abs(r.y)).toBeLessThan(0.01);
  });
  it('cursor directly over the right eye: mirror image', () => {
    const r = computeLook(at(G.r.x, G.r.y), G);
    expect(Math.abs(eyeR(r))).toBeLessThan(0.2);
    expect(eyeL(r)).toBeGreaterThan(0.8);
  });
  it('cursor between the eyes: both look inward (cross-eyed), mean centred', () => {
    const r = computeLook(at((G.l.x + G.r.x) / 2, G.l.y), G);
    expect(Math.abs(r.x)).toBeLessThan(1e-9);
    expect(r.conv).toBeGreaterThan(0.6);
    expect(eyeL(r)).toBeGreaterThan(0.6);
    expect(eyeR(r)).toBeLessThan(-0.6);
  });
  it('slightly off an eye still moves the pupil (no dead zone)', () => {
    // 1.5 px either side of the left eye centre: the left pupil follows (vs. old tanh/quantise dead zone)
    const right = computeLook(at(G.l.x + 1.5, G.l.y), G);
    const left = computeLook(at(G.l.x - 1.5, G.l.y), G);
    expect(eyeL(right)).toBeGreaterThan(0.25);
    expect(eyeL(left)).toBeLessThan(-0.1);
    // mirror-symmetric about the face centre
    const cx = (G.l.x + G.r.x) / 2;
    const a = computeLook(at(cx + 20, G.l.y - 30), G);
    const b = computeLook(at(cx - 20, G.l.y - 30), G);
    expect(a.x + b.x).toBeCloseTo(0, 9);
    expect(a.conv).toBeCloseTo(b.conv, 9);
  });
  const dirs: Array<[string, number, number]> = [
    ['E', 1, 0],
    ['NE', 1, -1],
    ['N', 0, -1],
    ['NW', -1, -1],
    ['W', -1, 0],
    ['SW', -1, 1],
    ['S', 0, 1],
    ['SE', 1, 1],
  ];
  for (const [name, ux, uy] of dirs) {
    it(`far ${name}: saturates in the right direction with little convergence`, () => {
      const cx = (G.l.x + G.r.x) / 2;
      const r = computeLook(at(cx + ux * 400, G.l.y + uy * 400), G);
      const n = Math.hypot(ux, uy);
      expect(r.x).toBeCloseTo(ux / n, 1);
      expect(r.y).toBeCloseTo(uy / n, 1);
      expect(Math.hypot(r.x, r.y)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(r.conv)).toBeLessThan(0.05);
    });
  }
  it('works inside and outside the window bounds with no discontinuity', () => {
    // walk the cursor from inside the stage to well outside, to the right of the face
    let prev = -1;
    for (let lx = 70; lx <= 400; lx += 5) {
      const r = computeLook(at(lx, G.l.y - 10), G);
      expect(r.x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r.x;
    }
    expect(prev).toBeGreaterThan(0.95);
  });
  it('is independent of overlay scale and of DIP vs physical units (DPR)', () => {
    const base = computeLook(at(90, 50), G);
    for (const scale of [1, 2, 3, 4]) {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        const r = computeLook(at(90, 50, scale, dpr, 37, 1200), G);
        expect(r.x).toBeCloseTo(base.x, 9);
        expect(r.y).toBeCloseTo(base.y, 9);
        expect(r.conv).toBeCloseTo(base.conv, 9);
      }
    }
  });
  it('uses the eye position, not the window centre', () => {
    // cursor at the window centre is above-right of the eyes, so they look up and to the right
    const r = computeLook(at(STAGE_W / 2 + 20, STAGE_H / 2), G);
    expect(r.y).toBeLessThan(-0.5);
    expect(r.x).toBeGreaterThan(0.2);
  });
  it('undoes the peek rotation (character rotated -90deg at the right edge)', () => {
    // rotated -90deg: character-local "up" points to screen left
    const g: LookGeom = { ...G, rot: -Math.PI / 2 };
    const r = computeLook(at(G.l.x - 300, (G.l.y + G.r.y) / 2), g);
    expect(r.y).toBeLessThan(-0.95);
    expect(Math.abs(r.x)).toBeLessThan(0.1);
  });
});

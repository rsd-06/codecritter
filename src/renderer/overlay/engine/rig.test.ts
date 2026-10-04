import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@shared/defaults';
import {
  GridBuilder,
  compileRows,
  makePart,
  mirrorRows,
  mix,
  outlineRows,
  paletteColors,
  parseGrid,
  trimRows,
} from './rig';

describe('parseGrid', () => {
  it('returns dimensions', () => {
    const g = parseGrid(['.ob', 'bbb']);
    expect([g.w, g.h]).toEqual([3, 2]);
  });
  it('rejects ragged grids', () => {
    expect(() => parseGrid(['..', '.'])).toThrow(/ragged/);
  });
  it('rejects unknown keys', () => {
    expect(() => parseGrid(['.!'])).toThrow(/unknown colour key/);
  });
});

describe('compileRows', () => {
  const colors = paletteColors(DEFAULT_PALETTES.stitch);
  it('maps palette keys to RGBA', () => {
    const img = compileRows(['o.', '.b'], colors);
    expect(img.w).toBe(2);
    expect([...img.data.slice(0, 4)]).toEqual([0x1b, 0x2a, 0x5c, 255]);
    expect(img.data[7]).toBe(0); // transparent
    expect([...img.data.slice(12, 16)]).toEqual([0x3f, 0x7f, 0xd9, 255]);
  });
  it('maps fixed colours', () => {
    const img = compileRows(['W'], colors);
    expect([...img.data]).toEqual([255, 255, 255, 255]);
  });
  it('changes with the palette', () => {
    const a = compileRows(['b'], paletteColors(DEFAULT_PALETTES.stitch));
    const b = compileRows(['b'], paletteColors(DEFAULT_PALETTES.yoda));
    expect([...a.data]).not.toEqual([...b.data]);
  });
});

describe('helpers', () => {
  it('mirrors rows', () => expect(mirrorRows(['ob.'])).toEqual(['.bo']));
  it('trims margins', () => {
    const t = trimRows(['....', '.bb.', '....']);
    expect(t).toEqual({ rows: ['bb'], ox: 1, oy: 1 });
  });
  it('outlines with 1px padding', () => {
    expect(outlineRows(['b'])).toEqual(['.o.', 'obo', '.o.']);
  });
  it('makePart accounts for the outline offset', () => {
    const p = makePart(['....', '.b..', '....']);
    expect([p.ox, p.oy]).toEqual([0, 0]);
    expect(p.rows.length).toBe(3);
  });
  it('mixes colours', () => expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080'));
});

describe('GridBuilder', () => {
  it('draws symmetric shapes with both()', () => {
    const b = new GridBuilder(16, 16);
    b.both(() => b.ellipse(4, 8, 2.5, 3, 'b'));
    const rows = b.rows();
    expect(rows.map((r) => [...r].reverse().join(''))).toEqual(rows);
    expect(b.count('b')).toBeGreaterThan(10);
  });
  it('respects the over filter', () => {
    const b = new GridBuilder(8, 8);
    b.rect(0, 0, 4, 4, 'b');
    b.rect(2, 2, 6, 6, 'w', { over: 'b' });
    expect(b.count('w')).toBe(4);
  });
  it('underShade marks bottom rims', () => {
    const b = new GridBuilder(4, 4);
    b.rect(0, 0, 4, 3, 'b').underShade('b', 's');
    expect(b.rows()[2]).toBe('ssss');
    expect(b.rows()[1]).toBe('bbbb');
  });
  it('capsule and poly fill pixels', () => {
    const b = new GridBuilder(16, 16);
    b.capsule(2, 2, 12, 12, 1.5, 'b').poly([[0, 0], [4, 0], [0, 4]], 'w');
    expect(b.count()).toBeGreaterThan(20);
  });
});

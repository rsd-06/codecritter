import { describe, expect, it } from 'vitest';
import { glyph, glyphWidth, layoutText, textWidth, wrapText } from './font';

describe('font', () => {
  it('has glyphs for printable ASCII', () => {
    for (let c = 32; c < 127; c++) {
      const g = glyph(String.fromCharCode(c));
      expect(g.length).toBeGreaterThanOrEqual(5);
      for (const r of g) expect(r.length).toBe(g[0]!.length);
    }
  });
  it('lowercase differs from uppercase', () => {
    expect(glyph('a')).not.toEqual(glyph('A'));
    expect(glyphWidth('m')).toBe(5);
  });
  it('measures text', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('I')).toBe(3);
    expect(textWidth('II')).toBe(7);
  });
  it('wraps to width', () => {
    const lines = wrapText('Stretch you must, young one', 50);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(50);
    expect(lines.join(' ')).toBe('Stretch you must, young one');
  });
  it('hard-breaks long words and honours newlines', () => {
    for (const l of wrapText('Supercalifragilisticexpialidocious', 30)) {
      expect(textWidth(l)).toBeLessThanOrEqual(30);
    }
    expect(wrapText('a\nb', 50)).toEqual(['a', 'b']);
  });
  it('layout reports a block size', () => {
    const b = layoutText('hello world', 100);
    expect(b.h).toBe(7);
    expect(b.w).toBeGreaterThan(20);
  });
});

describe('layoutText maxLines', () => {
  it('caps at 2 lines with an ellipsis that still fits', () => {
    const long = 'Claude Code, Codex, Cursor, Gemini and Copilot are all thinking about something quite long';
    const b = layoutText(long, 100, 2);
    expect(b.lines.length).toBe(2);
    expect(b.lines[1]!.endsWith('...')).toBe(true);
    expect(textWidth(b.lines[1]!)).toBeLessThanOrEqual(100);
    expect(layoutText('short', 100, 2).lines).toEqual(['short']);
  });
});

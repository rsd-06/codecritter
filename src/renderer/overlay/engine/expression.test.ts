import { describe, expect, it } from 'vitest';
import { EXPRESSION_NAMES, EXPRESSIONS, ExpressionBlender, resolveExpression } from './expression';

describe('expression presets', () => {
  it('exports all 18 presets', () => {
    expect(EXPRESSION_NAMES.length).toBe(18);
    for (const n of EXPRESSION_NAMES) expect(EXPRESSIONS[n]).toBeDefined();
  });
  it('resolves per-character styles', () => {
    expect(resolveExpression('stitch', 'worried').ears).toBe('back');
    expect(resolveExpression('yoda', 'worried').ears).toBe('droop');
    expect(resolveExpression('yoda', 'surprised').ears).toBe('perk');
    expect(resolveExpression('stitch', 'excited').ears).toBe('flare');
  });
});

describe('ExpressionBlender', () => {
  it('blinks and swaps expression while eyes are shut', () => {
    const b = new ExpressionBlender(() => 0.5);
    b.set('happy');
    expect(b.current).toBe('neutral');
    b.update(0.06);
    expect(b.current).toBe('neutral');
    b.update(0.06); // past midpoint
    expect(b.current).toBe('happy');
    expect(b.eyeOpen).toBeLessThan(0.3);
    b.update(0.2);
    expect(b.blinking).toBe(false);
    expect(b.eyeOpen).toBe(1);
  });
  it('auto blinks eventually', () => {
    const b = new ExpressionBlender(() => 0);
    b.update(2.3);
    expect(b.blinking).toBe(true);
  });
});

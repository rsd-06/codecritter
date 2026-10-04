import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES, DEFAULT_SETTINGS } from './defaults';

describe('DEFAULT_SETTINGS', () => {
  it('has the expected shape', () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
    expect([1, 2, 3, 4]).toContain(DEFAULT_SETTINGS.scale);
    expect(DEFAULT_SETTINGS.agents.port).toBe(47626);
    expect(DEFAULT_SETTINGS.agents.token).toBe('');
    expect(DEFAULT_SETTINGS.reminders.stretch.everyMin).toBe(50);
    expect(DEFAULT_SETTINGS.pomodoro.cyclesBeforeLong).toBe(4);
    expect(Object.values(DEFAULT_SETTINGS.reactions).every(Boolean)).toBe(true);
  });

  it('has complete hex palettes for each character', () => {
    for (const id of ['stitch', 'yoda'] as const) {
      const p = DEFAULT_PALETTES[id];
      expect(Object.keys(p)).toHaveLength(8);
      for (const c of Object.values(p)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

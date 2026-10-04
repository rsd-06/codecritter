import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { deepMerge, loadSettings, validateSettings } from './settingsLogic';

describe('settings logic', () => {
  it('fills missing keys from defaults', () => {
    const s = loadSettings({ version: 1, userName: 'Ana', reminders: { water: { everyMin: 10 } } });
    expect(s.userName).toBe('Ana');
    expect(s.reminders.water).toEqual({ enabled: true, everyMin: 10 });
    expect(s.reminders.stretch).toEqual(DEFAULT_SETTINGS.reminders.stretch);
    expect(s.palettes.yoda).toEqual(DEFAULT_SETTINGS.palettes.yoda);
  });
  it('handles garbage', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings('x')).toEqual(DEFAULT_SETTINGS);
  });
  it('deep merges patches, replaces arrays, allows null position', () => {
    const m = deepMerge(DEFAULT_SETTINGS, { sound: { volume: 0.1 }, messages: [{ id: '1' }] });
    expect(m.sound).toEqual({ enabled: true, volume: 0.1 });
    expect(m.messages).toHaveLength(1);
    const p = deepMerge(
      { ...DEFAULT_SETTINGS, position: { displayId: 1, x: 1, y: 2 } },
      { position: null },
    );
    expect(p.position).toBeNull();
  });
  it('validates ranges', () => {
    const s = validateSettings({ ...DEFAULT_SETTINGS, scale: 9 as never, opacity: 0 });
    expect(s.scale).toBe(4);
    expect(s.opacity).toBe(0.2);
    expect(validateSettings({ ...DEFAULT_SETTINGS, scale: 0 as never, opacity: 5 })).toMatchObject({
      scale: 1,
      opacity: 1,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import {
  PALETTE_KEYS,
  PRESETS,
  clamp,
  curlSnippet,
  fmtClock,
  isHHMM,
  isHex,
  matchPreset,
  newMessage,
  paletteEdit,
  paletteReset,
  parseIntIn,
  pomodoroPatch,
  reactionPatch,
  removeMessage,
  savableMessages,
  upsertMessage,
  validPort,
  validateMessage,
} from './helpers';

describe('validation', () => {
  it('HH:MM', () => {
    expect(isHHMM('00:00')).toBe(true);
    expect(isHHMM('23:59')).toBe(true);
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('9:30')).toBe(false);
    expect(isHHMM('12:60')).toBe(false);
  });
  it('parseIntIn', () => {
    expect(parseIntIn('25', 1, 180)).toBe(25);
    expect(parseIntIn(' 5 ', 1, 180)).toBe(5);
    expect(parseIntIn('0', 1, 180)).toBeNull();
    expect(parseIntIn('2.5', 1, 180)).toBeNull();
    expect(parseIntIn('', 1, 180)).toBeNull();
    expect(parseIntIn('181', 1, 180)).toBeNull();
  });
  it('hex, clamp, port', () => {
    expect(isHex('#a1B2c3')).toBe(true);
    expect(isHex('#fff')).toBe(false);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(validPort(80)).toBe(false);
    expect(validPort(47626)).toBe(true);
  });
  it('messages', () => {
    const m = newMessage('a');
    expect(validateMessage(m)).toBe('text-empty');
    expect(validateMessage({ ...m, text: 'hi' })).toBeNull();
    expect(validateMessage({ ...m, text: 'x'.repeat(121) })).toBe('text-long');
    expect(validateMessage({ ...m, text: 'hi', time: '99:00' })).toBe('time');
  });
});

describe('presets', () => {
  it('3 presets per character, valid hex, Classic = defaults', () => {
    for (const id of ['stitch', 'yoda'] as const) {
      expect(PRESETS[id]).toHaveLength(3);
      for (const p of PRESETS[id]) for (const k of PALETTE_KEYS) expect(isHex(p.palette[k])).toBe(true);
      expect(matchPreset(id, DEFAULT_SETTINGS.palettes[id])).toBe('Classic');
    }
    expect(matchPreset('stitch', { ...PRESETS.stitch[0]!.palette, body: '#000000' })).toBeNull();
  });
});

describe('patch builders', () => {
  it('palette edit/reset keep other character intact', () => {
    const p = paletteEdit(DEFAULT_SETTINGS, 'stitch', 'body', '#123456');
    expect(p.palettes?.stitch.body).toBe('#123456');
    expect(p.palettes?.yoda).toEqual(DEFAULT_SETTINGS.palettes.yoda);
    const s2 = { ...DEFAULT_SETTINGS, ...p };
    expect(paletteReset(s2, 'stitch').palettes?.stitch).toEqual(DEFAULT_SETTINGS.palettes.stitch);
  });
  it('reaction and pomodoro patches are complete objects', () => {
    expect(reactionPatch(DEFAULT_SETTINGS, 'purr', false).reactions).toEqual({
      ...DEFAULT_SETTINGS.reactions,
      purr: false,
    });
    expect(pomodoroPatch(DEFAULT_SETTINGS, { focusMin: 50 }).pomodoro?.breakMin).toBe(5);
  });
  it('message list ops', () => {
    const a = { ...newMessage('a'), text: 'a' };
    const b = newMessage('b');
    let l = upsertMessage([], a);
    l = upsertMessage(l, b);
    l = upsertMessage(l, { ...a, text: 'z' });
    expect(l.map((x) => x.text)).toEqual(['z', '']);
    expect(savableMessages(l)).toHaveLength(1);
    expect(removeMessage(l, 'a')).toHaveLength(1);
  });
});

describe('format', () => {
  it('clock and snippet', () => {
    expect(fmtClock(65_000)).toBe('01:05');
    expect(fmtClock(-5)).toBe('00:00');
    expect(curlSnippet(1234)).toContain('127.0.0.1:1234');
  });
});

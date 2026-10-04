import { DEFAULT_SETTINGS } from '../shared/defaults';
import type { Settings } from '../shared/types';

export type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge `patch` onto `base` (objects merge, arrays/primitives replace). Pure. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out as T;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Range validation / normalisation. Pure. */
export function validateSettings(s: Settings): Settings {
  const scale = Math.round(clamp(s.scale, 1, 4)) as Settings['scale'];
  return {
    ...s,
    scale,
    opacity: clamp(s.opacity, 0.2, 1),
    sound: { ...s.sound, volume: clamp(s.sound.volume, 0, 1) },
    overheatKps: clamp(s.overheatKps, 1, 30),
  };
}

/** Migration hook: bring stored data up to the current `version`. Pure. */
export function migrate(raw: unknown): Plain {
  const data: Plain = isPlain(raw) ? { ...raw } : {};
  // v1 is current; add `if (data.version === 1) {...; data.version = 2}` steps here.
  return data;
}

/** Load = migrate, then deep-merge onto defaults so newly added keys appear. Pure. */
export function loadSettings(raw: unknown): Settings {
  return validateSettings(deepMerge(structuredClone(DEFAULT_SETTINGS), migrate(raw)));
}

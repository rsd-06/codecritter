import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import type { Settings } from '../shared/types';

// Stub: P1-B replaces with migrations + broadcast.
const store = new Store<{ settings: Settings }>({ defaults: { settings: DEFAULT_SETTINGS } });

export function getSettings(): Settings {
  return store.get('settings');
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  store.set('settings', next);
  return next;
}

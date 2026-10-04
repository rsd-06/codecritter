import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import { IPC } from '../shared/ipc';
import type { Settings } from '../shared/types';
import { deepMerge, loadSettings, migrate, validateSettings } from './settingsLogic';

export { deepMerge, validateSettings, migrate, loadSettings };

let store: Store<{ settings: unknown }> | null = null;
let cache: Settings | null = null;

function ensure(): Store<{ settings: unknown }> {
  store ??= new Store<{ settings: unknown }>({ name: 'config' });
  return store;
}

export function getStore(): Store<{ settings: unknown }> {
  return ensure();
}

export function getSettings(): Settings {
  if (!cache) {
    cache = loadSettings(ensure().get('settings'));
    ensure().set('settings', cache);
  }
  return cache;
}

type Listener = (next: Settings, prev: Settings) => void;
const listeners = new Set<Listener>();
export function onSettingsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Send to every open window's renderer. */
export function broadcastAll(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const prev = getSettings();
  const next = validateSettings(deepMerge(prev, patch));
  cache = next;
  ensure().set('settings', next);
  broadcastAll(IPC.settings, next);
  for (const fn of listeners) fn(next, prev);
  return next;
}

/** Back-compat alias. */
export const setSettings = updateSettings;

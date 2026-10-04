import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Settings } from '../shared/types';
import { loadSettings } from './settingsLogic';

/** Settings export/import + optional sync-folder mirroring. Pure helpers + a small watcher. */

export const SYNC_FILE = 'codecritter-settings.json';
export const WRITE_DEBOUNCE_MS = 2000;
export const WATCH_DEBOUNCE_MS = 400;

/** Settings that travel between machines: everything except machine-local bits. */
export function toSyncable(s: Settings): Settings {
  return { ...s, position: null, syncFolder: null, agents: { ...s.agents, token: '' } };
}

export function serializeSyncable(s: Settings): string {
  return JSON.stringify(toSyncable(s), null, 2);
}

export const hashText = (t: string): string => createHash('sha256').update(t).digest('hex');

/** Merge imported JSON text onto `current`, keeping position/token/syncFolder/port local. */
export function mergeImported(text: string, current: Settings): Settings | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const imported = loadSettings(raw);
  return {
    ...imported,
    position: current.position,
    syncFolder: current.syncFolder,
    agents: { ...imported.agents, token: current.agents.token, port: current.agents.port },
  };
}

export async function exportToFile(path: string, s: Settings): Promise<void> {
  await writeFile(path, serializeSyncable(s), 'utf8');
}

export async function importFromFile(path: string, current: Settings): Promise<Settings | null> {
  try {
    return mergeImported(await readFile(path, 'utf8'), current);
  } catch {
    return null;
  }
}

export interface SyncDeps {
  getSettings(): Settings;
  /** Apply settings coming from the synced file. */
  apply(next: Settings): void;
}

export interface SyncOptions {
  writeDebounceMs?: number;
  watchDebounceMs?: number;
}

/** Mirrors settings to `<folder>/codecritter-settings.json` and applies external edits. */
export class SyncFolder {
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private lastHash = '';
  private folder: string | null = null;

  constructor(
    private deps: SyncDeps,
    private opts: SyncOptions = {},
  ) {}

  get file(): string | null {
    return this.folder ? join(this.folder, SYNC_FILE) : null;
  }

  /** (Re)point at a folder (or null to stop). Pulls an existing file first, else writes ours. */
  async setFolder(folder: string | null): Promise<void> {
    this.stop();
    this.folder = folder;
    if (!folder) return;
    try {
      await mkdir(folder, { recursive: true });
    } catch {
      return;
    }
    const file = join(folder, SYNC_FILE);
    let existing: string | null = null;
    try {
      existing = await readFile(file, 'utf8');
    } catch {
      /* none yet */
    }
    if (existing !== null) await this.pull(existing);
    else await this.writeNow();
    this.watch(folder);
  }

  /** Call whenever local settings change. */
  settingsChanged(): void {
    if (!this.folder) return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(
      () => void this.writeNow(),
      this.opts.writeDebounceMs ?? WRITE_DEBOUNCE_MS,
    );
  }

  private async writeNow(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const text = serializeSyncable(this.deps.getSettings());
    const h = hashText(text);
    if (h === this.lastHash) return;
    this.lastHash = h; // set first so our own fs event is ignored
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
    } catch {
      this.lastHash = '';
    }
  }

  private async pull(text: string): Promise<void> {
    const h = hashText(text);
    if (h === this.lastHash) return;
    this.lastHash = h;
    const cur = this.deps.getSettings();
    const next = mergeImported(text, cur);
    if (!next) return;
    if (serializeSyncable(next) === serializeSyncable(cur)) return;
    this.deps.apply(next);
  }

  private watch(folder: string): void {
    try {
      this.watcher = watch(folder, (_ev, name) => {
        if (name && name !== SYNC_FILE) return;
        if (this.readTimer) clearTimeout(this.readTimer);
        this.readTimer = setTimeout(() => {
          const file = this.file;
          if (!file) return;
          readFile(file, 'utf8').then(
            (t) => this.pull(t),
            () => undefined,
          );
        }, this.opts.watchDebounceMs ?? WATCH_DEBOUNCE_MS);
      });
      this.watcher.on('error', () => undefined);
    } catch {
      /* folder not watchable (network share etc.): export-on-change still works */
    }
  }

  stop(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    if (this.readTimer) clearTimeout(this.readTimer);
    this.writeTimer = this.readTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.lastHash = '';
  }
}

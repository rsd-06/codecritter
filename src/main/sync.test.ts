import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import type { Settings } from '../shared/types';
import { mergeImported, serializeSyncable, SYNC_FILE, SyncFolder } from './sync';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const base = (): Settings => structuredClone(DEFAULT_SETTINGS);

describe('sync helpers', () => {
  it('strips machine-local data when serialising', () => {
    const s = base();
    s.position = { displayId: 1, x: 5, y: 6 };
    s.agents.token = 'secret';
    s.syncFolder = 'C:/x';
    const out = JSON.parse(serializeSyncable(s)) as Settings;
    expect(out.position).toBeNull();
    expect(out.agents.token).toBe('');
    expect(out.syncFolder).toBeNull();
  });

  it('merge keeps local position/token/folder and rejects junk', () => {
    const cur = base();
    cur.position = { displayId: 2, x: 1, y: 2 };
    cur.agents.token = 'mine';
    cur.syncFolder = 'D:/sync';
    const remote = base();
    remote.userName = 'Remote';
    const m = mergeImported(JSON.stringify(remote), cur)!;
    expect(m.userName).toBe('Remote');
    expect(m.position).toEqual(cur.position);
    expect(m.agents.token).toBe('mine');
    expect(m.syncFolder).toBe('D:/sync');
    expect(mergeImported('nope', cur)).toBeNull();
    expect(mergeImported('[1]', cur)).toBeNull();
  });
});

describe('SyncFolder', () => {
  let dir: string;
  let cur: Settings;
  let applied: Settings[];
  let sync: SyncFolder;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'critter-sync-'));
    cur = base();
    applied = [];
    sync = new SyncFolder(
      {
        getSettings: () => cur,
        apply: (n) => {
          applied.push(n);
          cur = n;
        },
      },
      { writeDebounceMs: 30, watchDebounceMs: 30 },
    );
  });
  afterEach(async () => {
    sync.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the file on change (debounced) without applying its own write', async () => {
    await sync.setFolder(dir);
    cur = { ...cur, userName: 'Changed' };
    sync.settingsChanged();
    sync.settingsChanged();
    await sleep(300);
    const disk = JSON.parse(await readFile(join(dir, SYNC_FILE), 'utf8')) as Settings;
    expect(disk.userName).toBe('Changed');
    expect(applied).toHaveLength(0);
  });

  it('applies an existing file when pointed at a folder, and later external edits', async () => {
    const remote = { ...base(), userName: 'Elsewhere' };
    await writeFile(join(dir, SYNC_FILE), JSON.stringify(remote));
    await sync.setFolder(dir);
    expect(applied.map((a) => a.userName)).toEqual(['Elsewhere']);
    await writeFile(join(dir, SYNC_FILE), JSON.stringify({ ...remote, userName: 'Again' }));
    await sleep(400);
    expect(applied.at(-1)?.userName).toBe('Again');
  });
});

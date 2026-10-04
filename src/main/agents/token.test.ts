import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { critterDir, ensureToken, readConfig, writePortFile } from './token';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'critter-token-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('token', () => {
  it('creates a 64-hex token and reuses it', async () => {
    const t = await ensureToken(home);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureToken(home)).toBe(t);
    expect((await readFile(join(critterDir(home), 'token'), 'utf8')).trim()).toBe(t);
  });

  it('uses mode 0600 on posix', async () => {
    await ensureToken(home);
    if (process.platform !== 'win32') {
      const m = (await stat(join(critterDir(home), 'token'))).mode & 0o777;
      expect(m).toBe(0o600);
    }
  });

  it('regenerates when the file is empty', async () => {
    await ensureToken(home);
    await writeFile(join(critterDir(home), 'token'), '  \n');
    expect(await ensureToken(home)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('readConfig reads token and port, tolerating absence', async () => {
    expect(await readConfig(home)).toEqual({ token: null, port: null });
    const t = await ensureToken(home);
    await writePortFile(47627, home);
    expect(await readConfig(home)).toEqual({ token: t, port: 47627 });
    await writeFile(join(critterDir(home), 'port'), 'garbage');
    expect((await readConfig(home)).port).toBeNull();
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CMD_SCRIPT, findOnPath, prepareHookCmd, SH_SCRIPT } from './hookCmd';

describe('hookCmd', () => {
  let dir: string;
  let src: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'critter-hc-'));
    src = join(dir, 'src-hook.mjs');
    await writeFile(src, '// hook');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('scripts carry the marker', () => {
    expect(CMD_SCRIPT).toContain('critter-hook');
    expect(SH_SCRIPT).toContain('critter-hook');
  });

  it('findOnPath respects the platform extensions', () => {
    const ex = (p: string): boolean => p.endsWith('node.exe');
    expect(findOnPath('node', { PATH: 'C:\\a;C:\\b' }, 'win32', ex)).toMatch(/node\.exe$/);
    expect(findOnPath('node', { PATH: '' }, 'win32', ex)).toBeNull();
  });

  it('uses node + copied mjs when node exists', async () => {
    const r = await prepareHookCmd({
      dir: join(dir, 'cc'),
      hookSource: src,
      env: { PATH: '/x' },
      platform: 'linux',
      exists: () => true,
    });
    expect(r.mode).toBe('node');
    expect(r.hookCmd[0]).toBe('node');
    expect(r.hookCmd[1]).toContain('critter-hook.mjs');
    expect(await readFile(r.hookCmd[1]!, 'utf8')).toBe('// hook');
  });

  it('falls back to .cmd on windows and .sh elsewhere when node is missing', async () => {
    const win = await prepareHookCmd({
      dir: join(dir, 'w'),
      hookSource: src,
      env: { PATH: '' },
      platform: 'win32',
      exists: () => false,
    });
    expect(win.mode).toBe('cmd');
    expect(win.hookCmd[0]).toContain('critter-hook.cmd');
    const unix = await prepareHookCmd({
      dir: join(dir, 'u'),
      hookSource: null,
      env: { PATH: '' },
      platform: 'linux',
      exists: () => false,
    });
    expect(unix.mode).toBe('sh');
    expect(unix.hookCmd[0]).toContain('critter-hook.sh');
  });
});

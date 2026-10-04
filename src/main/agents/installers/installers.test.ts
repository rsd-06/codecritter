import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../../../shared/types';
import { AGENT_INSTALLERS, agentStatusAll } from './index';

const HOOK = ['node', 'C:\\Program Files\\CodeCritter\\bin\\critter-hook.mjs'];
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'critter-inst-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function put(rel: string, content: string): Promise<string> {
  const p = join(home, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
  return p;
}
const read = (p: string): Promise<string> => readFile(p, 'utf8');
const readJson = async (p: string): Promise<any> => JSON.parse(await read(p)); // eslint-disable-line @typescript-eslint/no-explicit-any
const has = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

const FILE_AGENTS: AgentId[] = [
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'kiro',
  'copilot',
  'opencode',
];

describe.each(FILE_AGENTS)('%s installer (common behaviour)', (id) => {
  const inst = AGENT_INSTALLERS[id];

  it('detects via config dir, installs fresh, is idempotent, uninstalls', async () => {
    expect(await inst.detect(home)).toBe(false);
    expect((await inst.status(home)).installed).toBe(false);

    const r1 = await inst.install(home, HOOK);
    expect(r1.ok).toBe(true);
    const st = await inst.status(home);
    expect(st.installed).toBe(true);
    expect(await has(st.path)).toBe(true);
    expect(await inst.detect(home)).toBe(true);
    const first = await read(st.path);
    expect(first).toContain('critter-hook');
    // Windows paths become forward-slashed (no escaped backslashes in the written file)
    if (id !== 'codex' && id !== 'opencode') {
      expect(first).toContain('C:/Program Files/CodeCritter/bin/critter-hook.mjs');
      expect(first).not.toContain('Program Files\\');
    }

    expect((await inst.install(home, HOOK)).ok).toBe(true);
    expect(await read(st.path)).toBe(first);

    expect((await inst.uninstall(home)).ok).toBe(true);
    expect((await inst.status(home)).installed).toBe(false);
  });

  it('uninstall on a clean home is a no-op success', async () => {
    const r = await inst.uninstall(home);
    expect(r.ok).toBe(true);
  });

  it('rejects a hookCmd that is not critter-hook', async () => {
    const r = await inst.install(home, ['node', '/tmp/other.mjs']);
    expect(r.ok).toBe(false);
  });
});

describe('claude-code', () => {
  const inst = AGENT_INSTALLERS['claude-code'];
  const rel = join('.claude', 'settings.json');

  it('writes the nested hooks schema with the right event mapping', async () => {
    await inst.install(home, HOOK);
    const d = await readJson(join(home, rel));
    const map: Record<string, string> = {
      UserPromptSubmit: 'thinking',
      PreToolUse: 'tool',
      Stop: 'done',
      SubagentStop: 'tool',
      Notification: 'attention',
    };
    for (const [ev, type] of Object.entries(map)) {
      expect(d.hooks[ev]).toHaveLength(1);
      expect(d.hooks[ev][0].matcher).toBe('');
      expect(d.hooks[ev][0].hooks[0].type).toBe('command');
      expect(d.hooks[ev][0].hooks[0].command).toMatch(new RegExp(`claude-code ${type}$`));
    }
  });

  it('preserves foreign keys and hooks, uninstall removes only ours, backs up once', async () => {
    const orig = {
      theme: 'dark',
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo mine' }] }],
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt' }] }],
      },
    };
    const p = await put(rel, JSON.stringify(orig));
    await inst.install(home, HOOK);
    const d = await readJson(p);
    expect(d.theme).toBe('dark');
    expect(d.permissions).toEqual(orig.permissions);
    expect(d.hooks.PostToolUse).toEqual(orig.hooks.PostToolUse);
    expect(d.hooks.Stop).toHaveLength(2);
    expect(d.hooks.Stop[0]).toEqual(orig.hooks.Stop[0]);
    expect(await readJson(p + '.codecritter.bak')).toEqual(orig);

    await inst.install(home, HOOK); // re-install must not duplicate or overwrite backup
    expect((await readJson(p)).hooks.Stop).toHaveLength(2);
    expect(await readJson(p + '.codecritter.bak')).toEqual(orig);

    await inst.uninstall(home);
    expect(await readJson(p)).toEqual(orig);
  });

  it('removes our entry from a group that also holds a foreign hook', async () => {
    const p = await put(
      rel,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: 'echo a' },
                { type: 'command', command: 'node /x/critter-hook.mjs claude-code done' },
              ],
            },
          ],
        },
      }),
    );
    await inst.uninstall(home);
    expect((await readJson(p)).hooks.Stop[0].hooks).toEqual([
      { type: 'command', command: 'echo a' },
    ]);
  });

  it('refuses malformed JSON without touching it', async () => {
    const p = await put(rel, '{ "hooks": ');
    const r = await inst.install(home, HOOK);
    expect(r.ok).toBe(false);
    expect(await read(p)).toBe('{ "hooks": ');
    expect((await inst.uninstall(home)).ok).toBe(false);
    expect(await read(p)).toBe('{ "hooks": ');
  });

  it('refuses structurally wrong hooks', async () => {
    const p = await put(rel, JSON.stringify({ hooks: [] }));
    expect((await inst.install(home, HOOK)).ok).toBe(false);
    expect(await read(p)).toBe(JSON.stringify({ hooks: [] }));
    const p2 = await put(rel, JSON.stringify({ hooks: { Stop: 'x' } }));
    expect((await inst.install(home, HOOK)).ok).toBe(false);
    expect(await read(p2)).toBe(JSON.stringify({ hooks: { Stop: 'x' } }));
  });

  it('tolerates a UTF-8 BOM', async () => {
    await put(rel, String.fromCharCode(0xfeff) + '{"theme":"dark"}');
    expect((await inst.install(home, HOOK)).ok).toBe(true);
    expect((await readJson(join(home, rel))).theme).toBe('dark');
  });

  it('treats an empty file as empty settings', async () => {
    await put(rel, '');
    expect((await inst.install(home, HOOK)).ok).toBe(true);
    expect((await inst.status(home)).installed).toBe(true);
  });
});

describe('gemini and antigravity', () => {
  it('antigravity mirrors gemini status (same file)', async () => {
    await AGENT_INSTALLERS.gemini.install(home, HOOK);
    const d = await readJson(join(home, '.gemini', 'settings.json'));
    expect(d.hooks.BeforeAgent[0].hooks[0].command).toMatch(/gemini thinking$/);
    expect(d.hooks.AfterAgent[0].hooks[0].command).toMatch(/gemini done$/);
    expect(d.hooks.Notification[0].hooks[0].command).toMatch(/gemini attention$/);
    const a = await AGENT_INSTALLERS.antigravity.status(home);
    expect(a.installed).toBe(true);
    expect(a.path).toBe(join(home, '.gemini', 'settings.json'));
    await AGENT_INSTALLERS.antigravity.uninstall(home);
    expect((await AGENT_INSTALLERS.gemini.status(home)).installed).toBe(false);
  });

  it('preserves foreign gemini settings', async () => {
    const p = await put(
      join('.gemini', 'settings.json'),
      JSON.stringify({ theme: 'x', mcpServers: { a: {} } }),
    );
    await AGENT_INSTALLERS.antigravity.install(home, HOOK);
    await AGENT_INSTALLERS.antigravity.uninstall(home);
    expect(await readJson(p)).toEqual({ theme: 'x', mcpServers: { a: {} } });
  });
});

describe('codex', () => {
  const inst = AGENT_INSTALLERS.codex;
  const rel = join('.codex', 'config.toml');

  it('writes a top-level notify array ahead of tables', async () => {
    const p = await put(rel, 'model = "o3"\n\n[projects."/x"]\ntrust = "trusted"\n');
    expect((await inst.install(home, HOOK)).ok).toBe(true);
    const t = await read(p);
    const lines = t.split('\n');
    const idx = lines.findIndex((l) => l.startsWith('notify'));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(lines.findIndex((l) => l.startsWith('[projects')));
    expect(t).toContain('"codex", "done"]');
    expect(t).toContain('model = "o3"');
    expect(t).toContain('[projects."/x"]\ntrust = "trusted"');
  });

  it('does not clobber a foreign notify (single or multi-line)', async () => {
    const single = 'notify = ["python", "x.py"]\n';
    const p = await put(rel, single);
    const r = await inst.install(home, HOOK);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/notify/);
    expect(await read(p)).toBe(single);

    const multi = 'notify = [\n  "python",\n  "x.py",\n]\n[a]\nb = 1\n';
    await put(rel, multi);
    expect((await inst.install(home, HOOK)).ok).toBe(false);
    expect(await read(p)).toBe(multi);
    expect((await inst.uninstall(home)).ok).toBe(true);
    expect(await read(p)).toBe(multi);
  });

  it('ignores a notify key that lives inside a table', async () => {
    const p = await put(rel, '[tui]\nnotify = ["x"]\n');
    expect((await inst.install(home, HOOK)).ok).toBe(true);
    expect(await read(p)).toContain('[tui]\nnotify = ["x"]');
  });

  it('re-install updates in place and uninstall restores original content', async () => {
    const orig = 'model = "o3"\n[a]\nb = 1\n';
    const p = await put(rel, orig);
    await inst.install(home, HOOK);
    await inst.install(home, ['node', '/new/critter-hook.mjs']);
    const t = await read(p);
    expect(t.match(/^notify/gm)).toHaveLength(1);
    expect(t).toContain('/new/critter-hook.mjs');
    await inst.uninstall(home);
    expect(await read(p)).toBe(orig);
    expect(await read(p + '.codecritter.bak')).toBe(orig);
  });

  it('creates the file if missing and preserves CRLF', async () => {
    await inst.install(home, HOOK);
    expect((await inst.status(home)).installed).toBe(true);
    const p = await put(rel, 'a = 1\r\n');
    await inst.install(home, HOOK);
    expect(await read(p)).toContain('\r\n');
    expect(await read(p)).not.toMatch(/[^\r]\n/);
  });
});

describe('cursor', () => {
  const inst = AGENT_INSTALLERS.cursor;
  const rel = join('.cursor', 'hooks.json');

  it('writes version 1 and the three events', async () => {
    await inst.install(home, HOOK);
    const d = await readJson(join(home, rel));
    expect(d.version).toBe(1);
    expect(d.hooks.beforeSubmitPrompt[0].command).toMatch(/cursor thinking$/);
    expect(d.hooks.stop[0].command).toMatch(/cursor done$/);
    expect(d.hooks.afterFileEdit[0].command).toMatch(/cursor tool$/);
  });

  it('preserves foreign hooks/keys and malformed files are untouched', async () => {
    const orig = {
      version: 1,
      hooks: { stop: [{ command: './mine.sh' }], beforeShellExecution: [{ command: 'x' }] },
    };
    const p = await put(rel, JSON.stringify(orig));
    await inst.install(home, HOOK);
    await inst.install(home, HOOK);
    const d = await readJson(p);
    expect(d.hooks.stop).toHaveLength(2);
    expect(d.hooks.beforeShellExecution).toEqual(orig.hooks.beforeShellExecution);
    await inst.uninstall(home);
    expect(await readJson(p)).toEqual(orig);

    await writeFile(p, 'nope{');
    expect((await inst.install(home, HOOK)).ok).toBe(false);
    expect(await read(p)).toBe('nope{');
  });
});

describe('kiro', () => {
  it('writes agentStop and promptSubmit hook files', async () => {
    await AGENT_INSTALLERS.kiro.install(home, HOOK);
    const dir = join(home, '.kiro', 'hooks');
    const done = await readJson(join(dir, 'codecritter-done.kiro.hook'));
    expect(done).toMatchObject({
      enabled: true,
      version: '1',
      when: { type: 'agentStop' },
      then: { type: 'runCommand' },
    });
    expect(done.then.command).toMatch(/kiro done$/);
    const th = await readJson(join(dir, 'codecritter-thinking.kiro.hook'));
    expect(th.when.type).toBe('promptSubmit');
    await AGENT_INSTALLERS.kiro.uninstall(home);
    expect(await has(join(dir, 'codecritter-done.kiro.hook'))).toBe(false);
  });

  it('never overwrites a foreign file of the same name', async () => {
    const p = await put(join('.kiro', 'hooks', 'codecritter-done.kiro.hook'), '{"mine":true}');
    expect((await AGENT_INSTALLERS.kiro.install(home, HOOK)).ok).toBe(false);
    expect(await read(p)).toBe('{"mine":true}');
    await AGENT_INSTALLERS.kiro.uninstall(home);
    expect(await read(p)).toBe('{"mine":true}');
  });
});

describe('copilot', () => {
  it('writes the hooks file and leaves siblings alone', async () => {
    const other = await put(join('.copilot', 'hooks', 'other.json'), '{}');
    await AGENT_INSTALLERS.copilot.install(home, HOOK);
    const d = await readJson(join(home, '.copilot', 'hooks', 'codecritter.json'));
    expect(d.version).toBe(1);
    expect(d.hooks.userPromptSubmitted[0]).toMatchObject({ type: 'command' });
    expect(d.hooks.userPromptSubmitted[0].bash).toBe(d.hooks.userPromptSubmitted[0].powershell);
    expect(d.hooks.sessionEnd[0].bash).toMatch(/copilot done$/);
    await AGENT_INSTALLERS.copilot.uninstall(home);
    expect(await read(other)).toBe('{}');
  });
});

describe('opencode', () => {
  it('writes an ESM plugin exporting CodeCritter', async () => {
    await AGENT_INSTALLERS.opencode.install(home, HOOK);
    const p = join(home, '.config', 'opencode', 'plugin', 'codecritter.js');
    const src = await read(p);
    expect(src).toContain('export const CodeCritter = async');
    expect(src).toContain('session.status');
    expect(src).toContain('session.idle');
    expect(src).toContain('session.error');
    expect(src).toContain('/v1/event');
    // syntax check: strip imports/exports and compile as a function body
    const body = src.replace(/^import .*$/gm, '').replace('export const', 'const');
    expect(() => new Function(body)).not.toThrow();
  });
});

describe('manual agents and status', () => {
  it.each(['devin', 'generic'] as AgentId[])('%s is manual', async (id) => {
    const inst = AGENT_INSTALLERS[id];
    expect(await inst.status(home)).toEqual({ installed: false, path: '' });
    const r = await inst.install(home, HOOK);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/agents\.md/);
    expect((await inst.status(home)).installed).toBe(false);
    expect((await inst.uninstall(home)).ok).toBe(true);
  });

  it('agentStatusAll covers every agent and survives bad files', async () => {
    await put(join('.claude', 'settings.json'), 'garbage');
    const all = await agentStatusAll(home);
    expect(Object.keys(all).sort()).toEqual(Object.keys(AGENT_INSTALLERS).sort());
    expect(all['claude-code'].installed).toBe(false);
    await AGENT_INSTALLERS.cursor.install(home, HOOK);
    expect((await agentStatusAll(home)).cursor.installed).toBe(true);
  });
});

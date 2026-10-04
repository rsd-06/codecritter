import { join } from 'node:path';
import type { Installer, Json } from './util';
import {
  backupOnce,
  exists,
  hookCommand,
  isOursCommand,
  readJsonObject,
  validateHookCmd,
  writeJson,
} from './util';

// Cursor: ~/.cursor/hooks.json
// { "version": 1, "hooks": { "beforeSubmitPrompt": [ { "command": "..." } ], "stop": [...], "afterFileEdit": [...] } }
const EVENTS: Record<string, string> = {
  beforeSubmitPrompt: 'thinking',
  stop: 'done',
  afterFileEdit: 'tool',
};

const path = (home: string): string => join(home, '.cursor', 'hooks.json');

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripOurs(hooks: Json): number {
  let removed = 0;
  for (const ev of Object.keys(hooks)) {
    const list = hooks[ev];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((h) => !(isObj(h) && isOursCommand(h.command)));
    removed += list.length - kept.length;
    if (kept.length === 0 && list.length > 0) delete hooks[ev];
    else hooks[ev] = kept;
  }
  return removed;
}

export const cursorInstaller: Installer = {
  id: 'cursor',
  label: 'Cursor',
  detect: (home) => exists(join(home, '.cursor')),
  async status(home) {
    const r = await readJsonObject(path(home));
    let installed = false;
    if (r.ok && isObj(r.data.hooks)) {
      installed = Object.values(r.data.hooks).some(
        (l) => Array.isArray(l) && l.some((h) => isObj(h) && isOursCommand(h.command)),
      );
    }
    return { installed, path: path(home) };
  },
  async install(home, hookCmd) {
    const bad = validateHookCmd(hookCmd);
    if (bad) return { ok: false, message: bad };
    const p = path(home);
    const r = await readJsonObject(p);
    if (!r.ok) return { ok: false, message: `${p} is not valid JSON (${r.error}); left untouched` };
    const data = r.data;
    if (data.hooks !== undefined && !isObj(data.hooks)) {
      return { ok: false, message: `"hooks" in ${p} is not an object; left untouched` };
    }
    const hooks: Json = isObj(data.hooks) ? data.hooks : {};
    for (const ev of Object.keys(hooks)) {
      if (!Array.isArray(hooks[ev])) {
        return { ok: false, message: `hooks.${ev} in ${p} is not an array; left untouched` };
      }
    }
    stripOurs(hooks);
    for (const [ev, type] of Object.entries(EVENTS)) {
      const list = (hooks[ev] as unknown[] | undefined) ?? [];
      list.push({ command: hookCommand(hookCmd, 'cursor', type) });
      hooks[ev] = list;
    }
    data.hooks = hooks;
    if (data.version === undefined) data.version = 1;
    await backupOnce(p);
    await writeJson(p, data);
    return { ok: true, message: `Installed Cursor hooks in ${p}` };
  },
  async uninstall(home) {
    const p = path(home);
    const r = await readJsonObject(p);
    if (!r.ok) return { ok: false, message: `${p} is not valid JSON (${r.error}); left untouched` };
    if (!r.exists || !isObj(r.data.hooks)) return { ok: true, message: 'Nothing to remove' };
    if (stripOurs(r.data.hooks) === 0) return { ok: true, message: 'Nothing to remove' };
    await writeJson(p, r.data);
    return { ok: true, message: `Removed Cursor hooks from ${p}` };
  },
};

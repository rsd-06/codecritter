import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentId } from '../../../shared/types';

export interface Installer {
  id: AgentId;
  label: string;
  /** Agent seems installed on this machine (its config dir exists). */
  detect(home: string): Promise<boolean>;
  /** Whether CodeCritter hooks are installed, and the file they live in. */
  status(home: string): Promise<{ installed: boolean; path: string }>;
  install(home: string, hookCmd: string[]): Promise<{ ok: boolean; message: string }>;
  uninstall(home: string): Promise<{ ok: boolean; message: string }>;
}

export type Json = Record<string, unknown>;
export type Result = { ok: boolean; message: string };

/** Marker identifying entries written by us (the hook script's file name). */
export const OURS = 'critter-hook';

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export type JsonRead = { ok: true; exists: boolean; data: Json } | { ok: false; error: string };

export async function readJsonObject(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return { ok: true, exists: false, data: {} };
    return { ok: false, error: (e as Error).message };
  }
  if (text.trim() === '') return { ok: true, exists: true, data: {} };
  try {
    const data: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { ok: false, error: 'top-level value is not a JSON object' };
    }
    return { ok: true, exists: true, data: data as Json };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Atomic-ish write: temp file then rename. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.codecritter.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

export async function writeJson(path: string, data: Json): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n');
}

/** Copy `path` to `path + .codecritter.bak` the first time only. */
export async function backupOnce(path: string): Promise<void> {
  const bak = `${path}.codecritter.bak`;
  if ((await exists(path)) && !(await exists(bak))) await copyFile(path, bak);
}

export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/**
 * Shell-quote a command line for hooks. Backslashes in path-like args become
 * forward slashes: node, cmd, PowerShell and Git-Bash all accept them, and they
 * survive JSON + bash quoting unharmed.
 */
export function shellQuote(args: string[]): string {
  return args
    .map((a) => {
      const v = /^[A-Za-z]:\\/.test(a) || a.includes('\\') ? a.replace(/\\/g, '/') : a;
      return /^[A-Za-z0-9_\-./:@=+,]+$/.test(v) ? v : `"${v.replace(/(["$`])/g, '\\$1')}"`;
    })
    .join(' ');
}

export function hookCommand(hookCmd: string[], agent: string, type: string): string {
  return shellQuote([...hookCmd, agent, type]);
}

export function isOursCommand(c: unknown): boolean {
  return typeof c === 'string' && c.includes(OURS);
}

export function validateHookCmd(hookCmd: string[]): string | null {
  if (!Array.isArray(hookCmd) || hookCmd.length === 0) return 'hookCmd is empty';
  if (!hookCmd.some((p) => p.includes(OURS))) return `hookCmd must include the ${OURS} script path`;
  return null;
}

// ---------------------------------------------------------------------------
// Claude-style nested hooks: { hooks: { Event: [ { matcher, hooks: [ {type, command} ] } ] } }
// Used by Claude Code and Gemini CLI.
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Remove our hook entries from a nested hooks map. Returns number removed. Mutates. */
export function stripNestedOurs(hooks: Json): number {
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const g of groups) {
      if (isObj(g) && Array.isArray(g.hooks)) {
        const inner = g.hooks.filter((h) => !(isObj(h) && isOursCommand(h.command)));
        const n = g.hooks.length - inner.length;
        removed += n;
        if (n > 0 && inner.length === 0) continue; // group only held ours
        kept.push(n > 0 ? { ...g, hooks: inner } : g);
      } else {
        kept.push(g);
      }
    }
    if (kept.length === 0 && kept.length !== groups.length) delete hooks[event];
    else hooks[event] = kept;
  }
  return removed;
}

export function nestedHasOurs(hooks: unknown): boolean {
  if (!isObj(hooks)) return false;
  return Object.values(hooks).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some(
        (g) =>
          isObj(g) &&
          Array.isArray(g.hooks) &&
          g.hooks.some((h) => isObj(h) && isOursCommand(h.command)),
      ),
  );
}

export interface NestedSpec {
  id: AgentId;
  label: string;
  dirName: string; // e.g. '.claude'
  fileName: string; // e.g. 'settings.json'
  /** hook event -> critter event type */
  events: Record<string, string>;
  /** agent id passed to critter-hook */
  agentName: string;
  /** add {name:'codecritter'} to each hook entry */
  named?: boolean;
}

export function makeNestedInstaller(spec: NestedSpec): Installer {
  const file = (home: string): string => join(home, spec.dirName, spec.fileName);
  return {
    id: spec.id,
    label: spec.label,
    detect: (home) => exists(join(home, spec.dirName)),
    async status(home) {
      const path = file(home);
      const r = await readJsonObject(path);
      return { installed: r.ok && nestedHasOurs(r.data.hooks), path };
    },
    async install(home, hookCmd) {
      const bad = validateHookCmd(hookCmd);
      if (bad) return { ok: false, message: bad };
      const path = file(home);
      const r = await readJsonObject(path);
      if (!r.ok) {
        return { ok: false, message: `${path} is not valid JSON (${r.error}); left untouched` };
      }
      const data = r.data;
      if (data.hooks !== undefined && !isObj(data.hooks)) {
        return { ok: false, message: `"hooks" in ${path} is not an object; left untouched` };
      }
      const hooks: Json = isObj(data.hooks) ? data.hooks : {};
      for (const ev of Object.keys(hooks)) {
        if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) {
          return { ok: false, message: `hooks.${ev} in ${path} is not an array; left untouched` };
        }
      }
      stripNestedOurs(hooks);
      for (const [event, type] of Object.entries(spec.events)) {
        const list = (hooks[event] as unknown[] | undefined) ?? [];
        const entry: Json = {
          type: 'command',
          command: hookCommand(hookCmd, spec.agentName, type),
        };
        if (spec.named) entry.name = 'codecritter';
        list.push({ matcher: '', hooks: [entry] });
        hooks[event] = list;
      }
      data.hooks = hooks;
      await backupOnce(path);
      await writeJson(path, data);
      return { ok: true, message: `Installed ${spec.label} hooks in ${path}` };
    },
    async uninstall(home) {
      const path = file(home);
      const r = await readJsonObject(path);
      if (!r.ok) {
        return { ok: false, message: `${path} is not valid JSON (${r.error}); left untouched` };
      }
      if (!r.exists || !isObj(r.data.hooks)) return { ok: true, message: 'Nothing to remove' };
      const hooks = r.data.hooks;
      const n = stripNestedOurs(hooks);
      if (n === 0) return { ok: true, message: 'Nothing to remove' };
      if (Object.keys(hooks).length === 0) delete r.data.hooks;
      await writeJson(path, r.data);
      return { ok: true, message: `Removed ${spec.label} hooks from ${path}` };
    },
  };
}

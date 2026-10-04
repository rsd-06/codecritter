import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Installer } from './util';
import { backupOnce, exists, isOursCommand, validateHookCmd, writeFileAtomic } from './util';

// Codex CLI: ~/.codex/config.toml, top-level `notify = ["cmd", "arg", ...]`.
// Codex appends one JSON argument ({"type":"agent-turn-complete",...}) when it runs the command.
// We edit just the notify line(s) - no TOML library, nothing else is rewritten.

const MARKER = '# codecritter';

interface NotifySpan {
  start: number; // line index
  end: number; // inclusive line index
  text: string;
}

/** Find a top-level `notify = ...` assignment (possibly a multi-line array). */
function findNotify(lines: string[]): NotifySpan | null {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\[/.test(t)) return null; // reached the first table: no longer top-level
    if (!/^notify\s*=/.test(t)) continue;
    let depth = 0;
    let inStr: string | null = null;
    let end = i;
    scan: for (let j = i; j < lines.length; j++) {
      const l = j === i ? lines[j].slice(lines[j].indexOf('=') + 1) : lines[j];
      for (let k = 0; k < l.length; k++) {
        const c = l[k];
        if (inStr) {
          if (c === '\\' && inStr === '"') k++;
          else if (c === inStr) inStr = null;
        } else if (c === '"' || c === "'") inStr = c;
        else if (c === '#') break;
        else if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth <= 0) {
            end = j;
            break scan;
          }
        }
      }
      end = j;
    }
    return { start: i, end, text: lines.slice(i, end + 1).join('\n') };
  }
  return null;
}

const path = (home: string): string => join(home, '.codex', 'config.toml');

function eol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

async function load(home: string): Promise<string | null> {
  try {
    return await readFile(path(home), 'utf8');
  } catch {
    return null;
  }
}

export const codexInstaller: Installer = {
  id: 'codex',
  label: 'Codex CLI',
  detect: (home) => exists(join(home, '.codex')),
  async status(home) {
    const text = await load(home);
    const span = text ? findNotify(text.split(/\r?\n/)) : null;
    return { installed: !!span && isOursCommand(span.text), path: path(home) };
  },
  async install(home, hookCmd) {
    const bad = validateHookCmd(hookCmd);
    if (bad) return { ok: false, message: bad };
    const p = path(home);
    const text = (await load(home)) ?? '';
    const nl = eol(text);
    const lines = text === '' ? [] : text.split(/\r?\n/);
    const span = findNotify(lines);
    if (span && !isOursCommand(span.text)) {
      return {
        ok: false,
        message:
          `${p} already has a notify command that is not CodeCritter's; not overwriting. ` +
          `Add this to your existing notify script instead: ${hookCmd.join(' ')} codex done`,
      };
    }
    const line = `notify = [${[...hookCmd, 'codex', 'done'].map((a) => JSON.stringify(a)).join(', ')}]`;
    if (span) {
      lines.splice(span.start, span.end - span.start + 1, line);
    } else {
      lines.unshift(MARKER, line);
    }
    await backupOnce(p);
    await writeFileAtomic(p, lines.join(nl).replace(/(\r?\n)*$/, '') + nl);
    return { ok: true, message: `Installed Codex notify hook in ${p}` };
  },
  async uninstall(home) {
    const p = path(home);
    const text = await load(home);
    if (text === null) return { ok: true, message: 'Nothing to remove' };
    const nl = eol(text);
    const lines = text.split(/\r?\n/);
    const span = findNotify(lines);
    if (!span || !isOursCommand(span.text)) return { ok: true, message: 'Nothing to remove' };
    const from =
      span.start > 0 && lines[span.start - 1].trim() === MARKER ? span.start - 1 : span.start;
    lines.splice(from, span.end - from + 1);
    await writeFileAtomic(p, lines.join(nl));
    return { ok: true, message: `Removed Codex notify hook from ${p}` };
  },
};

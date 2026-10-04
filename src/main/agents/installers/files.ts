import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Installer } from './util';
import {
  exists,
  hookCommand,
  isOursCommand,
  removeFile,
  validateHookCmd,
  writeFileAtomic,
} from './util';

// Installers that own whole files (Kiro, Copilot CLI, OpenCode): install writes them,
// uninstall deletes them. A pre-existing file of the same name that isn't ours is never overwritten.

async function isOursFile(p: string): Promise<boolean> {
  try {
    return isOursCommand(await readFile(p, 'utf8'));
  } catch {
    return false;
  }
}

interface FileSpec {
  rel: string; // path relative to home
  build(hookCmd: string[]): string;
}

function makeFileInstaller(
  id: Installer['id'],
  label: string,
  detectDir: string[],
  files: FileSpec[],
): Installer {
  const paths = (home: string): string[] => files.map((f) => join(home, f.rel));
  return {
    id,
    label,
    detect: (home) => exists(join(home, ...detectDir)),
    async status(home) {
      const ps = paths(home);
      const all = await Promise.all(ps.map(isOursFile));
      return { installed: all.every(Boolean), path: ps[0] };
    },
    async install(home, hookCmd) {
      const bad = validateHookCmd(hookCmd);
      if (bad) return { ok: false, message: bad };
      for (const f of files) {
        const p = join(home, f.rel);
        if ((await exists(p)) && !(await isOursFile(p))) {
          return { ok: false, message: `${p} exists and is not CodeCritter's; not overwriting` };
        }
      }
      for (const f of files) await writeFileAtomic(join(home, f.rel), f.build(hookCmd));
      return { ok: true, message: `Installed ${label} hooks (${paths(home).join(', ')})` };
    },
    async uninstall(home) {
      let n = 0;
      for (const p of paths(home)) {
        if (await isOursFile(p)) {
          await removeFile(p);
          n++;
        }
      }
      return { ok: true, message: n ? `Removed ${label} hooks` : 'Nothing to remove' };
    },
  };
}

// Kiro: ~/.kiro/hooks/*.kiro.hook (agent stop -> done, prompt submit -> thinking)
function kiroHook(name: string, description: string, when: string, cmd: string): string {
  return (
    JSON.stringify(
      {
        enabled: true,
        name,
        description,
        version: '1',
        when: { type: when },
        then: { type: 'runCommand', command: cmd },
      },
      null,
      2,
    ) + '\n'
  );
}

export const kiroInstaller = makeFileInstaller(
  'kiro',
  'Kiro',
  ['.kiro'],
  [
    {
      rel: join('.kiro', 'hooks', 'codecritter-done.kiro.hook'),
      build: (h) =>
        kiroHook(
          'CodeCritter: done',
          'Tell CodeCritter the agent finished',
          'agentStop',
          hookCommand(h, 'kiro', 'done'),
        ),
    },
    {
      rel: join('.kiro', 'hooks', 'codecritter-thinking.kiro.hook'),
      build: (h) =>
        kiroHook(
          'CodeCritter: thinking',
          'Tell CodeCritter a prompt was submitted',
          'promptSubmit',
          hookCommand(h, 'kiro', 'thinking'),
        ),
    },
  ],
);

// Copilot CLI: ~/.copilot/hooks/codecritter.json
export const copilotInstaller = makeFileInstaller(
  'copilot',
  'Copilot CLI',
  ['.copilot'],
  [
    {
      rel: join('.copilot', 'hooks', 'codecritter.json'),
      build: (h) => {
        const entry = (type: string): { type: string; bash: string; powershell: string } => {
          const c = hookCommand(h, 'copilot', type);
          return { type: 'command', bash: c, powershell: c };
        };
        return (
          JSON.stringify(
            {
              version: 1,
              hooks: {
                userPromptSubmitted: [entry('thinking')],
                sessionEnd: [entry('done')],
              },
            },
            null,
            2,
          ) + '\n'
        );
      },
    },
  ],
);

// OpenCode: ESM plugin. Talks to the local server directly (no hook CLI process needed),
// but the file embeds the marker so we can recognise it.
export function opencodePlugin(): string {
  return `// Managed by CodeCritter (critter-hook). Remove via CodeCritter settings.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function cfg() {
  const home = process.env.CRITTER_HOME || homedir();
  const read = (n) => {
    try { return readFileSync(join(home, '.codecritter', n), 'utf8').trim(); } catch { return ''; }
  };
  return { token: process.env.CRITTER_TOKEN || read('token'), port: process.env.CRITTER_PORT || read('port') || '47626' };
}

async function send(type, session) {
  try {
    const { token, port } = cfg();
    if (!token) return;
    await fetch('http://127.0.0.1:' + port + '/v1/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Critter-Token': token },
      body: JSON.stringify({ agent: 'opencode', type, session }),
      signal: AbortSignal.timeout(300),
    });
  } catch {
    /* never disturb the agent */
  }
}

export const CodeCritter = async () => ({
  event: async ({ event }) => {
    const p = event.properties || {};
    if (event.type === 'session.status') {
      const s = p.status && p.status.type;
      if (s === 'busy') await send('thinking', p.sessionID);
      else if (s === 'idle') await send('done', p.sessionID);
    } else if (event.type === 'session.idle') await send('done', p.sessionID);
    else if (event.type === 'session.error') await send('error', p.sessionID);
  },
});
`;
}

export const opencodeInstaller = makeFileInstaller(
  'opencode',
  'OpenCode',
  ['.config', 'opencode'],
  [{ rel: join('.config', 'opencode', 'plugin', 'codecritter.js'), build: () => opencodePlugin() }],
);

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Resolve the command agents run for hook events (the `hookCmd` given to C's installers).
 * - `node` on PATH: ['node', ~/.codecritter/critter-hook.mjs]
 * - otherwise a generated script (no Node needed): critter-hook.cmd (PowerShell) on Windows,
 *   critter-hook.sh (curl) elsewhere. Both contain "critter-hook" (installers validate it).
 * Scripts live under ~/.codecritter so they survive app updates/moves.
 */

export const CMD_SCRIPT = `@echo off
rem critter-hook (CodeCritter): forwards an agent event to the local server. Always exits 0, prints nothing.
rem Optional message: first 200 chars of stdin JSON field prompt/message/last_assistant_message (150 ms read cap).
set "CRITTER_A=%~1"
set "CRITTER_T=%~2"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $m=$null; try { $r=[Console]::In.ReadToEndAsync(); if($r.Wait(150)){ $j=$r.Result | ConvertFrom-Json; foreach($k in 'prompt','message','last_assistant_message'){ if(-not $m -and ($j.$k -is [string]) -and $j.$k){ $m=$j.$k } } } } catch {}; if($m -and $m.Length -gt 200){ $m=$m.Substring(0,200) }; $h=$env:CRITTER_HOME; if(-not $h){$h=$env:USERPROFILE}; $d=Join-Path $h '.codecritter'; $t=(Get-Content -LiteralPath (Join-Path $d 'token') -Raw).Trim(); $p=47626; $pf=Join-Path $d 'port'; if(Test-Path $pf){$n=0; if([int]::TryParse((Get-Content -LiteralPath $pf -Raw).Trim(),[ref]$n) -and $n -gt 0){$p=$n}}; $o=@{agent=$env:CRITTER_A;type=$env:CRITTER_T}; if($m){$o.message=$m}; $b=$o | ConvertTo-Json -Compress; Invoke-RestMethod -Uri ('http://127.0.0.1:'+$p+'/v1/event') -Method Post -Body $b -ContentType 'application/json' -Headers @{'X-Critter-Token'=$t} -TimeoutSec 1 | Out-Null } catch {}" >nul 2>&1
exit /b 0
`;

export const SH_SCRIPT = `#!/bin/sh
# critter-hook (CodeCritter): forwards an agent event to the local server. Always exits 0, prints nothing.
# Optional message (needs jq): first 200 chars of stdin JSON field prompt/message/last_assistant_message.
D="\${CRITTER_HOME:-$HOME}/.codecritter"
T=$(cat "$D/token" 2>/dev/null) || exit 0
P=$(cat "$D/port" 2>/dev/null)
case "$P" in ''|*[!0-9]*) P=47626 ;; esac
A="\${1:-generic}"
Y="\${2:-idle}"
M=""
if command -v jq >/dev/null 2>&1 && [ ! -t 0 ]; then
  if command -v timeout >/dev/null 2>&1; then IN=$(timeout 0.3 head -c 65536 2>/dev/null); else IN=$(head -c 65536 2>/dev/null); fi
  M=$(printf '%s' "$IN" | jq -r '(.prompt // .message // .last_assistant_message // empty) | tostring | .[0:200]' 2>/dev/null)
fi
if [ -n "$M" ]; then
  BODY=$(jq -nc --arg a "$A" --arg t "$Y" --arg m "$M" '{agent:$a,type:$t,message:$m}' 2>/dev/null)
fi
[ -n "$BODY" ] || BODY="{\\"agent\\":\\"$A\\",\\"type\\":\\"$Y\\"}"
curl -s -m 1 -o /dev/null -X POST -H "Content-Type: application/json" -H "X-Critter-Token: $T" \
  -d "$BODY" "http://127.0.0.1:$P/v1/event" >/dev/null 2>&1
exit 0
`;

export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['.exe', '.cmd'] : [''];
  for (const d of dirs)
    for (const e of exts) if (exists(join(d, name + e))) return join(d, name + e);
  return null;
}

export interface HookCmdResult {
  hookCmd: string[];
  mode: 'node' | 'cmd' | 'sh';
}

/** Copy the hook script + write fallback scripts; return the command to install. */
export async function prepareHookCmd(opts: {
  dir: string; // ~/.codecritter
  hookSource: string | null; // bin/critter-hook.mjs location
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
}): Promise<HookCmdResult> {
  const platform = opts.platform ?? process.platform;
  await mkdir(opts.dir, { recursive: true });
  const mjs = join(opts.dir, 'critter-hook.mjs');
  let haveMjs = false;
  if (opts.hookSource && existsSync(opts.hookSource)) {
    await copyFile(opts.hookSource, mjs);
    haveMjs = true;
  }
  if (haveMjs && findOnPath('node', opts.env, platform, opts.exists)) {
    return { hookCmd: ['node', mjs], mode: 'node' };
  }
  if (platform === 'win32') {
    const p = join(opts.dir, 'critter-hook.cmd');
    await writeFile(p, CMD_SCRIPT.replace(/\n/g, '\r\n'), 'utf8');
    return { hookCmd: [p], mode: 'cmd' };
  }
  const p = join(opts.dir, 'critter-hook.sh');
  await writeFile(p, SH_SCRIPT, 'utf8');
  await chmod(p, 0o755);
  return { hookCmd: [p], mode: 'sh' };
}

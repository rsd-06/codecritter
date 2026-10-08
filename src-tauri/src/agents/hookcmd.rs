//! Resolves the command agents run for hook events (the `hook_cmd` given to the installers).
//! - `node` on PATH: `["node", <home>/.codecritter/critter-hook.mjs]`
//! - otherwise a generated script (no Node needed): `critter-hook.cmd` (PowerShell) on Windows,
//!   `critter-hook.sh` (curl) elsewhere. Both contain "critter-hook" (installers validate it).
//! Scripts live under `~/.codecritter` so they survive app updates/moves. Identical to hookCmd.ts.

use std::fs;
use std::path::{Path, PathBuf};

pub const CMD_SCRIPT: &str = r###"@echo off
rem critter-hook (CodeCritter): forwards an agent event to the local server. Always exits 0, prints nothing.
rem Optional message: first 200 chars of stdin JSON field prompt/message/last_assistant_message (150 ms read cap).
set "CRITTER_A=%~1"
set "CRITTER_T=%~2"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $m=$null; try { $r=[Console]::In.ReadToEndAsync(); if($r.Wait(150)){ $j=$r.Result | ConvertFrom-Json; foreach($k in 'prompt','message','last_assistant_message'){ if(-not $m -and ($j.$k -is [string]) -and $j.$k){ $m=$j.$k } } } } catch {}; if($m -and $m.Length -gt 200){ $m=$m.Substring(0,200) }; $h=$env:CRITTER_HOME; if(-not $h){$h=$env:USERPROFILE}; $d=Join-Path $h '.codecritter'; $t=(Get-Content -LiteralPath (Join-Path $d 'token') -Raw).Trim(); $p=47626; $pf=Join-Path $d 'port'; if(Test-Path $pf){$n=0; if([int]::TryParse((Get-Content -LiteralPath $pf -Raw).Trim(),[ref]$n) -and $n -gt 0){$p=$n}}; $o=@{agent=$env:CRITTER_A;type=$env:CRITTER_T}; if($m){$o.message=$m}; $b=$o | ConvertTo-Json -Compress; Invoke-RestMethod -Uri ('http://127.0.0.1:'+$p+'/v1/event') -Method Post -Body $b -ContentType 'application/json' -Headers @{'X-Critter-Token'=$t} -TimeoutSec 1 | Out-Null } catch {}" >nul 2>&1
exit /b 0
"###;

pub const SH_SCRIPT: &str = r###"#!/bin/sh
# critter-hook (CodeCritter): forwards an agent event to the local server. Always exits 0, prints nothing.
# Optional message (needs jq): first 200 chars of stdin JSON field prompt/message/last_assistant_message.
D="${CRITTER_HOME:-$HOME}/.codecritter"
T=$(cat "$D/token" 2>/dev/null) || exit 0
P=$(cat "$D/port" 2>/dev/null)
case "$P" in ''|*[!0-9]*) P=47626 ;; esac
A="${1:-generic}"
Y="${2:-idle}"
M=""
if command -v jq >/dev/null 2>&1 && [ ! -t 0 ]; then
  if command -v timeout >/dev/null 2>&1; then IN=$(timeout 0.3 head -c 65536 2>/dev/null); else IN=$(head -c 65536 2>/dev/null); fi
  M=$(printf '%s' "$IN" | jq -r '(.prompt // .message // .last_assistant_message // empty) | tostring | .[0:200]' 2>/dev/null)
fi
if [ -n "$M" ]; then
  BODY=$(jq -nc --arg a "$A" --arg t "$Y" --arg m "$M" '{agent:$a,type:$t,message:$m}' 2>/dev/null)
fi
[ -n "$BODY" ] || BODY="{\"agent\":\"$A\",\"type\":\"$Y\"}"
curl -s -m 1 -o /dev/null -X POST -H "Content-Type: application/json" -H "X-Critter-Token: $T" \
  -d "$BODY" "http://127.0.0.1:$P/v1/event" >/dev/null 2>&1
exit 0
"###;

/// Looks `name` up in the given PATH string. `windows` selects `.exe`/`.cmd` suffixes.
pub fn find_on_path(
    name: &str,
    path_var: &str,
    windows: bool,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let sep = if windows { ';' } else { ':' };
    let exts: &[&str] = if windows { &[".exe", ".cmd"] } else { &[""] };
    for d in path_var.split(sep).filter(|d| !d.is_empty()) {
        for e in exts {
            let p = Path::new(d).join(format!("{name}{e}"));
            if exists(&p) {
                return Some(p);
            }
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Node,
    Cmd,
    Sh,
}

#[derive(Debug, Clone)]
pub struct HookCmdResult {
    pub hook_cmd: Vec<String>,
    pub mode: Mode,
}

pub struct PrepareOpts<'a> {
    /// `<home>/.codecritter`
    pub dir: &'a Path,
    /// Location of `bin/critter-hook.mjs` (resource dir or repo).
    pub hook_source: Option<&'a Path>,
    pub path_var: &'a str,
    pub windows: bool,
    pub exists: &'a dyn Fn(&Path) -> bool,
}

/// Copy the hook script + write fallback scripts; return the command to install.
pub fn prepare_with(opts: &PrepareOpts) -> std::io::Result<HookCmdResult> {
    fs::create_dir_all(opts.dir)?;
    let mjs = opts.dir.join("critter-hook.mjs");
    let mut have_mjs = false;
    if let Some(src) = opts.hook_source {
        if src.is_file() {
            fs::copy(src, &mjs)?;
            have_mjs = true;
        }
    }
    if have_mjs && find_on_path("node", opts.path_var, opts.windows, opts.exists).is_some() {
        return Ok(HookCmdResult {
            hook_cmd: vec!["node".into(), mjs.to_string_lossy().into_owned()],
            mode: Mode::Node,
        });
    }
    if opts.windows {
        let p = opts.dir.join("critter-hook.cmd");
        fs::write(&p, CMD_SCRIPT.replace('\n', "\r\n"))?;
        return Ok(HookCmdResult { hook_cmd: vec![p.to_string_lossy().into_owned()], mode: Mode::Cmd });
    }
    let p = opts.dir.join("critter-hook.sh");
    fs::write(&p, SH_SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755))?;
    }
    Ok(HookCmdResult { hook_cmd: vec![p.to_string_lossy().into_owned()], mode: Mode::Sh })
}

/// Production entry point: real PATH / platform / filesystem.
pub fn prepare(dir: &Path, hook_source: Option<&Path>) -> std::io::Result<HookCmdResult> {
    #[allow(unused_mut)]
    let mut path_var = std::env::var("PATH").or_else(|_| std::env::var("Path")).unwrap_or_default();
    // A Finder-launched .app inherits only /usr/bin:/bin:...; add where Homebrew / Volta usually put `node`.
    #[cfg(target_os = "macos")]
    {
        path_var.push_str(":/opt/homebrew/bin:/usr/local/bin");
        if let Some(h) = dirs::home_dir() {
            path_var.push_str(&format!(":{}/.volta/bin", h.display()));
        }
    }
    prepare_with(&PrepareOpts {
        dir,
        hook_source,
        path_var: &path_var,
        windows: cfg!(windows),
        exists: &|p| p.is_file(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::testutil::TempDir;

    fn with_node(_: &Path) -> bool {
        true
    }
    fn no_node(_: &Path) -> bool {
        false
    }

    #[test]
    fn find_on_path_honours_platform_extensions() {
        let hit = |p: &Path| p.to_string_lossy().ends_with("node.cmd");
        assert!(find_on_path("node", "C:\\a;C:\\b", true, &hit).is_some());
        assert!(find_on_path("node", "/a:/b", false, &hit).is_none());
        assert!(find_on_path("node", "", true, &with_node).is_none());
    }

    #[test]
    fn node_mode_copies_the_script() {
        let d = TempDir::new("hookcmd-node");
        let src = d.path().join("src.mjs");
        fs::write(&src, "// hook").unwrap();
        let dir = d.path().join(".codecritter");
        let r = prepare_with(&PrepareOpts {
            dir: &dir,
            hook_source: Some(&src),
            path_var: "/bin",
            windows: false,
            exists: &with_node,
        })
        .unwrap();
        assert_eq!(r.mode, Mode::Node);
        assert_eq!(r.hook_cmd[0], "node");
        assert!(r.hook_cmd[1].contains("critter-hook"));
        assert_eq!(fs::read_to_string(dir.join("critter-hook.mjs")).unwrap(), "// hook");
    }

    #[test]
    fn windows_without_node_writes_crlf_cmd() {
        let d = TempDir::new("hookcmd-cmd");
        let r = prepare_with(&PrepareOpts {
            dir: d.path(),
            hook_source: None,
            path_var: "",
            windows: true,
            exists: &no_node,
        })
        .unwrap();
        assert_eq!(r.mode, Mode::Cmd);
        assert!(r.hook_cmd[0].ends_with("critter-hook.cmd"));
        let t = fs::read_to_string(&r.hook_cmd[0]).unwrap();
        assert!(t.starts_with("@echo off\r\n"));
        assert!(t.contains("ReadToEndAsync") && t.contains("Wait(150)"));
        assert!(!t.contains("\r\r"));
    }

    #[test]
    fn posix_without_node_writes_sh() {
        let d = TempDir::new("hookcmd-sh");
        let src = d.path().join("src.mjs");
        fs::write(&src, "x").unwrap();
        // node absent although the source exists -> script fallback
        let r = prepare_with(&PrepareOpts {
            dir: d.path(),
            hook_source: Some(&src),
            path_var: "/bin",
            windows: false,
            exists: &no_node,
        })
        .unwrap();
        assert_eq!(r.mode, Mode::Sh);
        let t = fs::read_to_string(&r.hook_cmd[0]).unwrap();
        assert!(t.starts_with("#!/bin/sh\n"));
        assert!(t.contains("D=\"${CRITTER_HOME:-$HOME}/.codecritter\""));
        assert!(t.contains("BODY=\"{\\\"agent\\\":\\\"$A\\\""));
    }
}

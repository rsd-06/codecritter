//! Installers that own whole files (Kiro, Copilot CLI, OpenCode): install writes them,
//! uninstall deletes them. A pre-existing file of the same name that isn't ours is never overwritten.

use super::util::*;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn is_ours_file(p: &Path) -> bool {
    fs::read_to_string(p).map_or(false, |t| t.contains(OURS))
}

struct FileSpec {
    /// path relative to home
    rel: &'static [&'static str],
    build: fn(&[String]) -> String,
}

pub struct FileInstaller {
    id: &'static str,
    label: &'static str,
    detect_dir: &'static [&'static str],
    files: Vec<FileSpec>,
}

impl FileInstaller {
    fn paths(&self, home: &Path) -> Vec<PathBuf> {
        self.files.iter().map(|f| f.rel.iter().fold(home.to_path_buf(), |a, s| a.join(s))).collect()
    }
}

impl Installer for FileInstaller {
    fn id(&self) -> &'static str {
        self.id
    }
    fn label(&self) -> &'static str {
        self.label
    }
    fn detect(&self, home: &Path) -> bool {
        exists(&self.detect_dir.iter().fold(home.to_path_buf(), |a, s| a.join(s)))
    }
    fn status(&self, home: &Path) -> Status {
        let ps = self.paths(home);
        let installed = ps.iter().all(|p| is_ours_file(p));
        Status { installed, path: ps.first().map(|p| p2s(p)).unwrap_or_default() }
    }
    fn install(&self, home: &Path, hook_cmd: &[String]) -> OpResult {
        if let Some(bad) = validate_hook_cmd(hook_cmd) {
            return OpResult::err(bad);
        }
        let ps = self.paths(home);
        for p in &ps {
            if exists(p) && !is_ours_file(p) {
                return OpResult::err(format!(
                    "{} exists and is not CodeCritter's; not overwriting",
                    p2s(p)
                ));
            }
        }
        for (f, p) in self.files.iter().zip(&ps) {
            if let Err(e) = write_file_atomic(p, &(f.build)(hook_cmd)) {
                return OpResult::err(format!("could not write {}: {e}", p2s(p)));
            }
        }
        let list: Vec<String> = ps.iter().map(|p| p2s(p)).collect();
        OpResult::ok(format!("Installed {} hooks ({})", self.label, list.join(", ")))
    }
    fn uninstall(&self, home: &Path) -> OpResult {
        let mut n = 0;
        for p in self.paths(home) {
            if is_ours_file(&p) {
                remove_file(&p);
                n += 1;
            }
        }
        if n > 0 {
            OpResult::ok(format!("Removed {} hooks", self.label))
        } else {
            OpResult::ok("Nothing to remove")
        }
    }
}

fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_default();
    s.push('\n');
    s
}

// Kiro: ~/.kiro/hooks/*.kiro.hook (agent stop -> done, prompt submit -> thinking)
fn kiro_hook(name: &str, description: &str, when: &str, cmd: &str) -> String {
    pretty(&json!({
        "enabled": true,
        "name": name,
        "description": description,
        "version": "1",
        "when": { "type": when },
        "then": { "type": "runCommand", "command": cmd },
    }))
}

pub fn kiro() -> FileInstaller {
    FileInstaller {
        id: "kiro",
        label: "Kiro",
        detect_dir: &[".kiro"],
        files: vec![
            FileSpec {
                rel: &[".kiro", "hooks", "codecritter-done.kiro.hook"],
                build: |h| {
                    kiro_hook(
                        "CodeCritter: done",
                        "Tell CodeCritter the agent finished",
                        "agentStop",
                        &hook_command(h, "kiro", "done"),
                    )
                },
            },
            FileSpec {
                rel: &[".kiro", "hooks", "codecritter-thinking.kiro.hook"],
                build: |h| {
                    kiro_hook(
                        "CodeCritter: thinking",
                        "Tell CodeCritter a prompt was submitted",
                        "promptSubmit",
                        &hook_command(h, "kiro", "thinking"),
                    )
                },
            },
        ],
    }
}

// Copilot CLI: ~/.copilot/hooks/codecritter.json
pub fn copilot() -> FileInstaller {
    FileInstaller {
        id: "copilot",
        label: "Copilot CLI",
        detect_dir: &[".copilot"],
        files: vec![FileSpec {
            rel: &[".copilot", "hooks", "codecritter.json"],
            build: |h| {
                let entry = |kind: &str| {
                    let c = hook_command(h, "copilot", kind);
                    json!({ "type": "command", "bash": c, "powershell": c })
                };
                pretty(&json!({
                    "version": 1,
                    "hooks": {
                        "userPromptSubmitted": [entry("thinking")],
                        "sessionEnd": [entry("done")],
                    },
                }))
            },
        }],
    }
}

/// OpenCode: ESM plugin. Talks to the local server directly (no hook CLI process needed),
/// but the file embeds the marker so we can recognise it.
pub fn opencode_plugin() -> String {
    r###"// Managed by CodeCritter (critter-hook). Remove via CodeCritter settings.
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
"###
    .to_string()
}

pub fn opencode() -> FileInstaller {
    FileInstaller {
        id: "opencode",
        label: "OpenCode",
        detect_dir: &[".config", "opencode"],
        files: vec![FileSpec {
            rel: &[".config", "opencode", "plugin", "codecritter.js"],
            build: |_| opencode_plugin(),
        }],
    }
}

//! Shared installer helpers (port of installers/util.ts). Every function takes the home dir
//! explicitly so tests never touch the real `~/.claude`, `~/.codex`, ...

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub type Json = Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub installed: bool,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpResult {
    pub ok: bool,
    pub message: String,
}

impl OpResult {
    pub fn ok(message: impl Into<String>) -> Self {
        OpResult { ok: true, message: message.into() }
    }
    pub fn err(message: impl Into<String>) -> Self {
        OpResult { ok: false, message: message.into() }
    }
}

pub trait Installer: Send + Sync {
    fn id(&self) -> &'static str;
    fn label(&self) -> &'static str;
    /// Agent seems installed on this machine (its config dir exists).
    fn detect(&self, home: &Path) -> bool;
    /// Whether CodeCritter hooks are installed, and the file they live in.
    fn status(&self, home: &Path) -> Status;
    fn install(&self, home: &Path, hook_cmd: &[String]) -> OpResult;
    fn uninstall(&self, home: &Path) -> OpResult;
}

/// Marker identifying entries written by us (the hook script's file name).
pub const OURS: &str = "critter-hook";

pub fn exists(path: &Path) -> bool {
    fs::metadata(path).is_ok()
}

pub fn p2s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

pub enum JsonRead {
    Ok { exists: bool, data: Json },
    Err(String),
}

pub fn read_json_object(path: &Path) -> JsonRead {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return JsonRead::Ok { exists: false, data: Json::new() }
        }
        Err(e) => return JsonRead::Err(e.to_string()),
    };
    if text.trim().is_empty() {
        return JsonRead::Ok { exists: true, data: Json::new() };
    }
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text);
    match serde_json::from_str::<Value>(body) {
        Ok(Value::Object(m)) => JsonRead::Ok { exists: true, data: m },
        Ok(_) => JsonRead::Err("top-level value is not a JSON object".into()),
        Err(e) => JsonRead::Err(e.to_string()),
    }
}

/// Atomic-ish write: temp file then rename.
pub fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = PathBuf::from(format!("{}.codecritter.tmp", path.display()));
    fs::write(&tmp, content)?;
    if let Err(e) = fs::rename(&tmp, path) {
        // rename over an existing file can fail on some Windows setups; fall back to overwrite
        let r = fs::write(path, content);
        let _ = fs::remove_file(&tmp);
        return r.map_err(|_| e);
    }
    Ok(())
}

pub fn write_json(path: &Path, data: &Json) -> std::io::Result<()> {
    let mut s = serde_json::to_string_pretty(&Value::Object(data.clone()))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    s.push('\n');
    write_file_atomic(path, &s)
}

/// Copy `path` to `path + .codecritter.bak` the first time only.
pub fn backup_once(path: &Path) -> std::io::Result<()> {
    let bak = PathBuf::from(format!("{}.codecritter.bak", path.display()));
    if exists(path) && !exists(&bak) {
        fs::copy(path, &bak)?;
    }
    Ok(())
}

/// Order-preserving key removal (`Map::remove` is a swap_remove when serde_json's
/// `preserve_order` feature is on, which would shuffle the user's key order).
pub fn remove_key(map: &mut Json, key: &str) {
    if !map.contains_key(key) {
        return;
    }
    let old = std::mem::take(map);
    for (k, v) in old {
        if k != key {
            map.insert(k, v);
        }
    }
}

pub fn remove_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn is_safe_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "_-./:@=+,".contains(c)
}

/// Shell-quote a command line for hooks. Backslashes in path-like args become forward slashes:
/// node, cmd, PowerShell and Git-Bash all accept them, and they survive JSON + bash quoting.
pub fn shell_quote(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            let v = if a.contains('\\') { a.replace('\\', "/") } else { a.clone() };
            if !v.is_empty() && v.chars().all(is_safe_char) {
                v
            } else {
                let mut q = String::from("\"");
                for c in v.chars() {
                    if c == '"' || c == '$' || c == '`' {
                        q.push('\\');
                    }
                    q.push(c);
                }
                q.push('"');
                q
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn hook_command(hook_cmd: &[String], agent: &str, kind: &str) -> String {
    let mut v: Vec<String> = hook_cmd.to_vec();
    v.push(agent.to_string());
    v.push(kind.to_string());
    shell_quote(&v)
}

pub fn is_ours_command(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::String(s)) if s.contains(OURS))
}

pub fn validate_hook_cmd(hook_cmd: &[String]) -> Option<String> {
    if hook_cmd.is_empty() {
        return Some("hookCmd is empty".into());
    }
    if !hook_cmd.iter().any(|p| p.contains(OURS)) {
        return Some(format!("hookCmd must include the {OURS} script path"));
    }
    None
}

// ---------------------------------------------------------------------------
// Claude-style nested hooks: { hooks: { Event: [ { matcher, hooks: [ {type, command} ] } ] } }
// Used by Claude Code and Gemini CLI.
// ---------------------------------------------------------------------------

/// Remove our hook entries from a nested hooks map. Returns number removed.
pub fn strip_nested_ours(hooks: &mut Json) -> usize {
    let mut removed = 0;
    let events: Vec<String> = hooks.keys().cloned().collect();
    for event in events {
        let groups = match hooks.get(&event) {
            Some(Value::Array(g)) => g.clone(),
            _ => continue,
        };
        let mut kept: Vec<Value> = Vec::new();
        for g in &groups {
            let inner_hooks = g.as_object().and_then(|o| o.get("hooks")).and_then(|h| h.as_array());
            if let Some(list) = inner_hooks {
                let inner: Vec<Value> = list
                    .iter()
                    .filter(|h| !(h.is_object() && is_ours_command(h.get("command"))))
                    .cloned()
                    .collect();
                let n = list.len() - inner.len();
                removed += n;
                if n > 0 && inner.is_empty() {
                    continue; // group only held ours
                }
                if n > 0 {
                    let mut g2 = g.clone();
                    g2["hooks"] = Value::Array(inner);
                    kept.push(g2);
                } else {
                    kept.push(g.clone());
                }
            } else {
                kept.push(g.clone());
            }
        }
        if kept.is_empty() && !groups.is_empty() {
            remove_key(hooks, &event);
        } else {
            hooks.insert(event, Value::Array(kept));
        }
    }
    removed
}

pub fn nested_has_ours(hooks: Option<&Value>) -> bool {
    let Some(Value::Object(m)) = hooks else { return false };
    m.values().any(|groups| {
        groups.as_array().map_or(false, |gs| {
            gs.iter().any(|g| {
                g.get("hooks").and_then(|h| h.as_array()).map_or(false, |hs| {
                    hs.iter().any(|h| h.is_object() && is_ours_command(h.get("command")))
                })
            })
        })
    })
}

pub struct NestedSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub dir_name: &'static str,
    pub file_name: &'static str,
    /// hook event -> critter event type (insertion order kept)
    pub events: &'static [(&'static str, &'static str)],
    /// agent id passed to critter-hook
    pub agent_name: &'static str,
    /// add {name:'codecritter'} to each hook entry
    pub named: bool,
    /// extra directory (relative to home) that also counts for `detect`
    pub extra_detect: Option<&'static str>,
}

pub struct NestedInstaller(pub NestedSpec);

impl NestedInstaller {
    fn file(&self, home: &Path) -> PathBuf {
        home.join(self.0.dir_name).join(self.0.file_name)
    }
}

impl Installer for NestedInstaller {
    fn id(&self) -> &'static str {
        self.0.id
    }
    fn label(&self) -> &'static str {
        self.0.label
    }
    fn detect(&self, home: &Path) -> bool {
        exists(&home.join(self.0.dir_name))
            || self.0.extra_detect.map_or(false, |d| exists(&home.join(d)))
    }
    fn status(&self, home: &Path) -> Status {
        let path = self.file(home);
        let installed = match read_json_object(&path) {
            JsonRead::Ok { data, .. } => nested_has_ours(data.get("hooks")),
            JsonRead::Err(_) => false,
        };
        Status { installed, path: p2s(&path) }
    }
    fn install(&self, home: &Path, hook_cmd: &[String]) -> OpResult {
        if let Some(bad) = validate_hook_cmd(hook_cmd) {
            return OpResult::err(bad);
        }
        let path = self.file(home);
        let ps = p2s(&path);
        let mut data = match read_json_object(&path) {
            JsonRead::Ok { data, .. } => data,
            JsonRead::Err(e) => {
                return OpResult::err(format!("{ps} is not valid JSON ({e}); left untouched"))
            }
        };
        let mut hooks: Json = match data.get("hooks") {
            None => Json::new(),
            Some(Value::Object(m)) => m.clone(),
            Some(_) => {
                return OpResult::err(format!("\"hooks\" in {ps} is not an object; left untouched"))
            }
        };
        for (ev, v) in hooks.iter() {
            if !v.is_array() {
                return OpResult::err(format!("hooks.{ev} in {ps} is not an array; left untouched"));
            }
        }
        strip_nested_ours(&mut hooks);
        for (event, kind) in self.0.events {
            let mut list = match hooks.get(*event) {
                Some(Value::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            let mut entry = Json::new();
            entry.insert("type".into(), Value::String("command".into()));
            entry.insert(
                "command".into(),
                Value::String(hook_command(hook_cmd, self.0.agent_name, kind)),
            );
            if self.0.named {
                entry.insert("name".into(), Value::String("codecritter".into()));
            }
            let mut group = Json::new();
            group.insert("matcher".into(), Value::String(String::new()));
            group.insert("hooks".into(), Value::Array(vec![Value::Object(entry)]));
            list.push(Value::Object(group));
            hooks.insert((*event).to_string(), Value::Array(list));
        }
        data.insert("hooks".into(), Value::Object(hooks));
        if let Err(e) = backup_once(&path).and_then(|_| write_json(&path, &data)) {
            return OpResult::err(format!("could not write {ps}: {e}"));
        }
        OpResult::ok(format!("Installed {} hooks in {ps}", self.0.label))
    }
    fn uninstall(&self, home: &Path) -> OpResult {
        let path = self.file(home);
        let ps = p2s(&path);
        let (exists_, mut data) = match read_json_object(&path) {
            JsonRead::Ok { exists, data } => (exists, data),
            JsonRead::Err(e) => {
                return OpResult::err(format!("{ps} is not valid JSON ({e}); left untouched"))
            }
        };
        let mut hooks = match data.get("hooks") {
            Some(Value::Object(m)) if exists_ => m.clone(),
            _ => return OpResult::ok("Nothing to remove"),
        };
        let n = strip_nested_ours(&mut hooks);
        if n == 0 {
            return OpResult::ok("Nothing to remove");
        }
        if hooks.is_empty() {
            remove_key(&mut data, "hooks");
        } else {
            data.insert("hooks".into(), Value::Object(hooks));
        }
        if let Err(e) = write_json(&path, &data) {
            return OpResult::err(format!("could not write {ps}: {e}"));
        }
        OpResult::ok(format!("Removed {} hooks from {ps}", self.0.label))
    }
}

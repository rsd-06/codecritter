//! Cursor: `~/.cursor/hooks.json`
//! `{ "version": 1, "hooks": { "beforeSubmitPrompt": [ { "command": "..." } ], "stop": [...], "afterFileEdit": [...] } }`

use super::util::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

const EVENTS: [(&str, &str); 3] =
    [("beforeSubmitPrompt", "thinking"), ("stop", "done"), ("afterFileEdit", "tool")];

fn path(home: &Path) -> PathBuf {
    home.join(".cursor").join("hooks.json")
}

fn is_ours_entry(h: &Value) -> bool {
    h.is_object() && is_ours_command(h.get("command"))
}

fn strip_ours(hooks: &mut Json) -> usize {
    let mut removed = 0;
    let events: Vec<String> = hooks.keys().cloned().collect();
    for ev in events {
        let list = match hooks.get(&ev) {
            Some(Value::Array(l)) => l.clone(),
            _ => continue,
        };
        let kept: Vec<Value> = list.iter().filter(|h| !is_ours_entry(h)).cloned().collect();
        removed += list.len() - kept.len();
        if kept.is_empty() && !list.is_empty() {
            remove_key(hooks, &ev);
        } else {
            hooks.insert(ev, Value::Array(kept));
        }
    }
    removed
}

pub struct CursorInstaller;

impl Installer for CursorInstaller {
    fn id(&self) -> &'static str {
        "cursor"
    }
    fn label(&self) -> &'static str {
        "Cursor"
    }
    fn detect(&self, home: &Path) -> bool {
        exists(&home.join(".cursor"))
    }
    fn status(&self, home: &Path) -> Status {
        let p = path(home);
        let mut installed = false;
        if let JsonRead::Ok { data, .. } = read_json_object(&p) {
            if let Some(Value::Object(h)) = data.get("hooks") {
                installed = h.values().any(|l| l.as_array().map_or(false, |a| a.iter().any(is_ours_entry)));
            }
        }
        Status { installed, path: p2s(&p) }
    }
    fn install(&self, home: &Path, hook_cmd: &[String]) -> OpResult {
        if let Some(bad) = validate_hook_cmd(hook_cmd) {
            return OpResult::err(bad);
        }
        let p = path(home);
        let ps = p2s(&p);
        let mut data = match read_json_object(&p) {
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
        strip_ours(&mut hooks);
        for (ev, kind) in EVENTS {
            let mut list = match hooks.get(ev) {
                Some(Value::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            let mut entry = Json::new();
            entry.insert("command".into(), Value::String(hook_command(hook_cmd, "cursor", kind)));
            list.push(Value::Object(entry));
            hooks.insert(ev.to_string(), Value::Array(list));
        }
        data.insert("hooks".into(), Value::Object(hooks));
        if !data.contains_key("version") {
            data.insert("version".into(), Value::from(1));
        }
        if let Err(e) = backup_once(&p).and_then(|_| write_json(&p, &data)) {
            return OpResult::err(format!("could not write {ps}: {e}"));
        }
        OpResult::ok(format!("Installed Cursor hooks in {ps}"))
    }
    fn uninstall(&self, home: &Path) -> OpResult {
        let p = path(home);
        let ps = p2s(&p);
        let (exists_, mut data) = match read_json_object(&p) {
            JsonRead::Ok { exists, data } => (exists, data),
            JsonRead::Err(e) => {
                return OpResult::err(format!("{ps} is not valid JSON ({e}); left untouched"))
            }
        };
        let mut hooks = match data.get("hooks") {
            Some(Value::Object(m)) if exists_ => m.clone(),
            _ => return OpResult::ok("Nothing to remove"),
        };
        if strip_ours(&mut hooks) == 0 {
            return OpResult::ok("Nothing to remove");
        }
        data.insert("hooks".into(), Value::Object(hooks));
        if let Err(e) = write_json(&p, &data) {
            return OpResult::err(format!("could not write {ps}: {e}"));
        }
        OpResult::ok(format!("Removed Cursor hooks from {ps}"))
    }
}

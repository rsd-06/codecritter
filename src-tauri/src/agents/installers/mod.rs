//! Agent hook installers (port of src/main/agents/installers). All functions take `home`.

pub mod codex;
pub mod cursor;
pub mod files;
pub mod util;

use serde_json::{json, Map, Value};
use std::path::Path;
pub use util::{Installer, OpResult, Status};
use util::{NestedInstaller, NestedSpec};

/// Claude Code: `~/.claude/settings.json`
/// `{ "hooks": { "<Event>": [ { "matcher": "", "hooks": [ { "type": "command", "command": "..." } ] } ] } }`
pub fn claude_code() -> NestedInstaller {
    NestedInstaller(NestedSpec {
        id: "claude-code",
        label: "Claude Code",
        dir_name: ".claude",
        file_name: "settings.json",
        agent_name: "claude-code",
        named: false,
        extra_detect: None,
        events: &[
            ("UserPromptSubmit", "thinking"),
            ("PreToolUse", "tool"),
            ("Stop", "done"),
            ("SubagentStop", "tool"),
            ("Notification", "attention"),
        ],
    })
}

const GEMINI_EVENTS: &[(&str, &str)] =
    &[("BeforeAgent", "thinking"), ("AfterAgent", "done"), ("Notification", "attention")];

/// Gemini CLI: `~/.gemini/settings.json`, same nested schema as Claude Code.
pub fn gemini() -> NestedInstaller {
    NestedInstaller(NestedSpec {
        id: "gemini",
        label: "Gemini CLI",
        dir_name: ".gemini",
        file_name: "settings.json",
        agent_name: "gemini",
        named: true,
        extra_detect: None,
        events: GEMINI_EVENTS,
    })
}

/// Antigravity shares Gemini's settings file, so this is an alias: it reads and writes the very
/// same hooks (reported as agent "gemini"). Uninstalling either one removes both.
pub fn antigravity() -> NestedInstaller {
    NestedInstaller(NestedSpec {
        id: "antigravity",
        label: "Antigravity",
        dir_name: ".gemini",
        file_name: "settings.json",
        agent_name: "gemini",
        named: true,
        extra_detect: Some(".antigravity"),
        events: GEMINI_EVENTS,
    })
}

/// Tools with no hook file we can edit (Devin, generic): points at docs/agents.md.
pub struct Manual {
    id: &'static str,
    label: &'static str,
}

impl Installer for Manual {
    fn id(&self) -> &'static str {
        self.id
    }
    fn label(&self) -> &'static str {
        self.label
    }
    fn detect(&self, _home: &Path) -> bool {
        false
    }
    fn status(&self, _home: &Path) -> Status {
        Status { installed: false, path: String::new() }
    }
    fn install(&self, _home: &Path, _hook_cmd: &[String]) -> OpResult {
        OpResult::ok(format!(
            "{} has no hook file we can edit. Call the local API from your agent: see docs/agents.md (\"Devin and other tools\").",
            self.label
        ))
    }
    fn uninstall(&self, _home: &Path) -> OpResult {
        OpResult::ok("Nothing to remove (manual setup)")
    }
}

/// Every installer, keyed by agent id (order = display order).
pub fn all() -> Vec<Box<dyn Installer>> {
    vec![
        Box::new(claude_code()),
        Box::new(codex::CodexInstaller),
        Box::new(cursor::CursorInstaller),
        Box::new(gemini()),
        Box::new(antigravity()),
        Box::new(files::kiro()),
        Box::new(files::copilot()),
        Box::new(files::opencode()),
        Box::new(Manual { id: "devin", label: "Devin" }),
        Box::new(Manual { id: "generic", label: "Generic / other tools" }),
    ]
}

pub fn by_id(id: &str) -> Option<Box<dyn Installer>> {
    all().into_iter().find(|i| i.id() == id)
}

/// `{ [agentId]: { installed, path } }`
pub fn status_all_in(home: &Path) -> Value {
    let mut out = Map::new();
    for inst in all() {
        // a bad file must never break the whole listing
        let st = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| inst.status(home)))
            .unwrap_or(Status { installed: false, path: String::new() });
        out.insert(inst.id().to_string(), json!({ "installed": st.installed, "path": st.path }));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::testutil::TempDir;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn hook() -> Vec<String> {
        vec!["node".into(), "C:\\Program Files\\CodeCritter\\bin\\critter-hook.mjs".into()]
    }

    struct Home(TempDir);
    impl Home {
        fn new(tag: &str) -> Home {
            Home(TempDir::new(tag))
        }
        fn p(&self) -> &Path {
            self.0.path()
        }
        fn join(&self, rel: &[&str]) -> PathBuf {
            rel.iter().fold(self.p().to_path_buf(), |a, s| a.join(s))
        }
        fn put(&self, rel: &[&str], content: &str) -> PathBuf {
            let p = self.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, content).unwrap();
            p
        }
    }
    fn read(p: &Path) -> String {
        fs::read_to_string(p).unwrap()
    }
    fn rj(p: &Path) -> Value {
        serde_json::from_str(&read(p)).unwrap()
    }
    fn bak(p: &Path) -> PathBuf {
        PathBuf::from(format!("{}.codecritter.bak", p.display()))
    }
    fn inst(id: &str) -> Box<dyn Installer> {
        by_id(id).unwrap()
    }

    const FILE_AGENTS: [&str; 7] =
        ["claude-code", "codex", "cursor", "gemini", "kiro", "copilot", "opencode"];

    #[test]
    fn common_behaviour_for_every_file_agent() {
        for id in FILE_AGENTS {
            let h = Home::new(&format!("inst-{id}"));
            let i = inst(id);
            assert!(!i.detect(h.p()), "{id} detect before");
            assert!(!i.status(h.p()).installed, "{id} status before");

            let r1 = i.install(h.p(), &hook());
            assert!(r1.ok, "{id}: {}", r1.message);
            let st = i.status(h.p());
            assert!(st.installed, "{id} installed");
            assert!(Path::new(&st.path).exists(), "{id} file exists");
            assert!(i.detect(h.p()), "{id} detect after");
            let first = read(Path::new(&st.path));
            assert!(first.contains("critter-hook"));
            if id != "codex" && id != "opencode" {
                assert!(first.contains("C:/Program Files/CodeCritter/bin/critter-hook.mjs"), "{id}");
                assert!(!first.contains("Program Files\\"), "{id}");
            }

            assert!(i.install(h.p(), &hook()).ok);
            assert_eq!(read(Path::new(&st.path)), first, "{id} idempotent");

            assert!(i.uninstall(h.p()).ok);
            assert!(!i.status(h.p()).installed, "{id} uninstalled");

            // clean home uninstall is a no-op success
            let h2 = Home::new(&format!("inst2-{id}"));
            assert!(i.uninstall(h2.p()).ok);
            // non critter-hook command is rejected
            let bad = i.install(h2.p(), &["node".into(), "/tmp/other.mjs".into()]);
            assert!(!bad.ok, "{id} rejects foreign hookCmd");
        }
    }

    #[test]
    fn claude_code_schema_and_event_mapping() {
        let h = Home::new("cc-schema");
        inst("claude-code").install(h.p(), &hook());
        let d = rj(&h.join(&[".claude", "settings.json"]));
        for (ev, kind) in [
            ("UserPromptSubmit", "thinking"),
            ("PreToolUse", "tool"),
            ("Stop", "done"),
            ("SubagentStop", "tool"),
            ("Notification", "attention"),
        ] {
            let g = d["hooks"][ev].as_array().unwrap();
            assert_eq!(g.len(), 1);
            assert_eq!(g[0]["matcher"], "");
            assert_eq!(g[0]["hooks"][0]["type"], "command");
            assert!(g[0]["hooks"][0]["command"].as_str().unwrap().ends_with(&format!("claude-code {kind}")));
        }
    }

    #[test]
    fn claude_code_preserves_foreign_and_backs_up_once() {
        let h = Home::new("cc-foreign");
        let i = inst("claude-code");
        let orig = json!({
            "theme": "dark",
            "permissions": { "allow": ["Bash(ls)"] },
            "hooks": {
                "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "echo mine" }] }],
                "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "fmt" }] }],
            }
        });
        let p = h.put(&[".claude", "settings.json"], &orig.to_string());
        i.install(h.p(), &hook());
        let d = rj(&p);
        assert_eq!(d["theme"], "dark");
        assert_eq!(d["permissions"], orig["permissions"]);
        assert_eq!(d["hooks"]["PostToolUse"], orig["hooks"]["PostToolUse"]);
        assert_eq!(d["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(d["hooks"]["Stop"][0], orig["hooks"]["Stop"][0]);
        assert_eq!(rj(&bak(&p)), orig);

        i.install(h.p(), &hook()); // re-install: no duplicates, backup untouched
        assert_eq!(rj(&p)["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(rj(&bak(&p)), orig);

        i.uninstall(h.p());
        assert_eq!(rj(&p), orig);
    }

    #[test]
    fn claude_code_removes_only_our_entry_from_a_shared_group() {
        let h = Home::new("cc-shared");
        let p = h.put(
            &[".claude", "settings.json"],
            &json!({"hooks":{"Stop":[{"matcher":"","hooks":[
                {"type":"command","command":"echo a"},
                {"type":"command","command":"node /x/critter-hook.mjs claude-code done"}]}]}})
            .to_string(),
        );
        inst("claude-code").uninstall(h.p());
        assert_eq!(rj(&p)["hooks"]["Stop"][0]["hooks"], json!([{"type":"command","command":"echo a"}]));
    }

    #[test]
    fn claude_code_refuses_malformed_json_untouched() {
        let h = Home::new("cc-bad");
        let i = inst("claude-code");
        let p = h.put(&[".claude", "settings.json"], "{ \"hooks\": ");
        assert!(!i.install(h.p(), &hook()).ok);
        assert_eq!(read(&p), "{ \"hooks\": ");
        assert!(!i.uninstall(h.p()).ok);
        assert_eq!(read(&p), "{ \"hooks\": ");
        assert!(!bak(&p).exists());
    }

    #[test]
    fn claude_code_refuses_structurally_wrong_hooks() {
        let h = Home::new("cc-shape");
        let i = inst("claude-code");
        let p = h.put(&[".claude", "settings.json"], "{\"hooks\":[]}");
        assert!(!i.install(h.p(), &hook()).ok);
        assert_eq!(read(&p), "{\"hooks\":[]}");
        h.put(&[".claude", "settings.json"], "{\"hooks\":{\"Stop\":\"x\"}}");
        assert!(!i.install(h.p(), &hook()).ok);
        assert_eq!(read(&p), "{\"hooks\":{\"Stop\":\"x\"}}");
        h.put(&[".claude", "settings.json"], "[1,2]");
        assert!(!i.install(h.p(), &hook()).ok);
    }

    #[test]
    fn claude_code_tolerates_bom_and_empty_file() {
        let h = Home::new("cc-bom");
        let i = inst("claude-code");
        h.put(&[".claude", "settings.json"], "\u{feff}{\"theme\":\"dark\"}");
        assert!(i.install(h.p(), &hook()).ok);
        assert_eq!(rj(&h.join(&[".claude", "settings.json"]))["theme"], "dark");
        let h2 = Home::new("cc-empty");
        h2.put(&[".claude", "settings.json"], "");
        assert!(i.install(h2.p(), &hook()).ok);
        assert!(i.status(h2.p()).installed);
    }

    #[test]
    fn gemini_and_antigravity_share_a_file() {
        let h = Home::new("gem");
        inst("gemini").install(h.p(), &hook());
        let d = rj(&h.join(&[".gemini", "settings.json"]));
        let c = |ev: &str| d["hooks"][ev][0]["hooks"][0]["command"].as_str().unwrap().to_string();
        assert!(c("BeforeAgent").ends_with("gemini thinking"));
        assert!(c("AfterAgent").ends_with("gemini done"));
        assert!(c("Notification").ends_with("gemini attention"));
        assert_eq!(d["hooks"]["BeforeAgent"][0]["hooks"][0]["name"], "codecritter");
        let a = inst("antigravity").status(h.p());
        assert!(a.installed);
        assert_eq!(a.path, h.join(&[".gemini", "settings.json"]).to_string_lossy());
        inst("antigravity").uninstall(h.p());
        assert!(!inst("gemini").status(h.p()).installed);
    }

    #[test]
    fn antigravity_detects_its_own_dir() {
        let h = Home::new("ag-detect");
        assert!(!inst("antigravity").detect(h.p()));
        fs::create_dir_all(h.join(&[".antigravity"])).unwrap();
        assert!(inst("antigravity").detect(h.p()));
        assert!(!inst("gemini").detect(h.p()));
    }

    #[test]
    fn gemini_preserves_foreign_settings() {
        let h = Home::new("gem-foreign");
        let orig = json!({"theme":"x","mcpServers":{"a":{}}});
        let p = h.put(&[".gemini", "settings.json"], &orig.to_string());
        inst("antigravity").install(h.p(), &hook());
        inst("antigravity").uninstall(h.p());
        assert_eq!(rj(&p), orig);
    }

    const CODEX: [&str; 2] = [".codex", "config.toml"];

    #[test]
    fn codex_writes_top_level_notify_before_tables() {
        let h = Home::new("codex-top");
        let p = h.put(&CODEX, "model = \"o3\"\n\n[projects.\"/x\"]\ntrust = \"trusted\"\n");
        assert!(inst("codex").install(h.p(), &hook()).ok);
        let t = read(&p);
        let lines: Vec<&str> = t.split('\n').collect();
        let idx = lines.iter().position(|l| l.starts_with("notify")).unwrap();
        assert!(idx < lines.iter().position(|l| l.starts_with("[projects")).unwrap());
        assert!(t.contains("\"codex\", \"done\"]"));
        assert!(t.contains("model = \"o3\""));
        assert!(t.contains("[projects.\"/x\"]\ntrust = \"trusted\""));
    }

    #[test]
    fn codex_does_not_clobber_foreign_notify() {
        let h = Home::new("codex-foreign");
        let i = inst("codex");
        let single = "notify = [\"python\", \"x.py\"]\n";
        let p = h.put(&CODEX, single);
        let r = i.install(h.p(), &hook());
        assert!(!r.ok);
        assert!(r.message.contains("notify"));
        assert_eq!(read(&p), single);

        let multi = "notify = [\n  \"python\",\n  \"x.py\",\n]\n[a]\nb = 1\n";
        h.put(&CODEX, multi);
        assert!(!i.install(h.p(), &hook()).ok);
        assert_eq!(read(&p), multi);
        assert!(i.uninstall(h.p()).ok);
        assert_eq!(read(&p), multi);
    }

    #[test]
    fn codex_ignores_notify_inside_a_table() {
        let h = Home::new("codex-table");
        let p = h.put(&CODEX, "[tui]\nnotify = [\"x\"]\n");
        assert!(inst("codex").install(h.p(), &hook()).ok);
        assert!(read(&p).contains("[tui]\nnotify = [\"x\"]"));
    }

    #[test]
    fn codex_reinstall_updates_in_place_and_uninstall_restores() {
        let h = Home::new("codex-re");
        let i = inst("codex");
        let orig = "model = \"o3\"\n[a]\nb = 1\n";
        let p = h.put(&CODEX, orig);
        i.install(h.p(), &hook());
        i.install(h.p(), &["node".into(), "/new/critter-hook.mjs".into()]);
        let t = read(&p);
        assert_eq!(t.lines().filter(|l| l.starts_with("notify")).count(), 1);
        assert!(t.contains("/new/critter-hook.mjs"));
        i.uninstall(h.p());
        assert_eq!(read(&p), orig);
        assert_eq!(read(&bak(&p)), orig);
    }

    #[test]
    fn codex_creates_missing_file_and_preserves_crlf() {
        let h = Home::new("codex-crlf");
        let i = inst("codex");
        i.install(h.p(), &hook());
        assert!(i.status(h.p()).installed);
        let h2 = Home::new("codex-crlf2");
        let p = h2.put(&CODEX, "a = 1\r\n");
        i.install(h2.p(), &hook());
        let t = read(&p);
        assert!(t.contains("\r\n"));
        // every \n is preceded by \r
        let b = t.as_bytes();
        assert!(b.iter().enumerate().all(|(k, c)| *c != b'\n' || (k > 0 && b[k - 1] == b'\r')));
    }

    #[test]
    fn cursor_writes_version_and_three_events() {
        let h = Home::new("cursor");
        inst("cursor").install(h.p(), &hook());
        let d = rj(&h.join(&[".cursor", "hooks.json"]));
        assert_eq!(d["version"], 1);
        let c = |ev: &str| d["hooks"][ev][0]["command"].as_str().unwrap().to_string();
        assert!(c("beforeSubmitPrompt").ends_with("cursor thinking"));
        assert!(c("stop").ends_with("cursor done"));
        assert!(c("afterFileEdit").ends_with("cursor tool"));
    }

    #[test]
    fn cursor_preserves_foreign_and_refuses_malformed() {
        let h = Home::new("cursor-foreign");
        let i = inst("cursor");
        let orig = json!({"version":1,"hooks":{"stop":[{"command":"./mine.sh"}],"beforeShellExecution":[{"command":"x"}]}});
        let p = h.put(&[".cursor", "hooks.json"], &orig.to_string());
        i.install(h.p(), &hook());
        i.install(h.p(), &hook());
        let d = rj(&p);
        assert_eq!(d["hooks"]["stop"].as_array().unwrap().len(), 2);
        assert_eq!(d["hooks"]["beforeShellExecution"], orig["hooks"]["beforeShellExecution"]);
        i.uninstall(h.p());
        assert_eq!(rj(&p), orig);

        fs::write(&p, "nope{").unwrap();
        assert!(!i.install(h.p(), &hook()).ok);
        assert_eq!(read(&p), "nope{");
        assert!(!i.uninstall(h.p()).ok);
    }

    #[test]
    fn kiro_writes_two_hook_files_and_never_overwrites_foreign() {
        let h = Home::new("kiro");
        let i = inst("kiro");
        i.install(h.p(), &hook());
        let dir = [".kiro", "hooks"];
        let done = rj(&h.join(&[dir[0], dir[1], "codecritter-done.kiro.hook"]));
        assert_eq!(done["enabled"], true);
        assert_eq!(done["version"], "1");
        assert_eq!(done["when"]["type"], "agentStop");
        assert_eq!(done["then"]["type"], "runCommand");
        assert!(done["then"]["command"].as_str().unwrap().ends_with("kiro done"));
        let th = rj(&h.join(&[dir[0], dir[1], "codecritter-thinking.kiro.hook"]));
        assert_eq!(th["when"]["type"], "promptSubmit");
        i.uninstall(h.p());
        assert!(!h.join(&[dir[0], dir[1], "codecritter-done.kiro.hook"]).exists());

        let h2 = Home::new("kiro-foreign");
        let p = h2.put(&[".kiro", "hooks", "codecritter-done.kiro.hook"], "{\"mine\":true}");
        assert!(!i.install(h2.p(), &hook()).ok);
        assert_eq!(read(&p), "{\"mine\":true}");
        assert!(!h2.join(&[".kiro", "hooks", "codecritter-thinking.kiro.hook"]).exists());
        i.uninstall(h2.p());
        assert_eq!(read(&p), "{\"mine\":true}");
    }

    #[test]
    fn copilot_writes_hooks_file_and_leaves_siblings() {
        let h = Home::new("copilot");
        let other = h.put(&[".copilot", "hooks", "other.json"], "{}");
        inst("copilot").install(h.p(), &hook());
        let d = rj(&h.join(&[".copilot", "hooks", "codecritter.json"]));
        assert_eq!(d["version"], 1);
        let e = &d["hooks"]["userPromptSubmitted"][0];
        assert_eq!(e["type"], "command");
        assert_eq!(e["bash"], e["powershell"]);
        assert!(d["hooks"]["sessionEnd"][0]["bash"].as_str().unwrap().ends_with("copilot done"));
        inst("copilot").uninstall(h.p());
        assert_eq!(read(&other), "{}");
    }

    #[test]
    fn opencode_writes_an_esm_plugin() {
        let h = Home::new("opencode");
        inst("opencode").install(h.p(), &hook());
        let src = read(&h.join(&[".config", "opencode", "plugin", "codecritter.js"]));
        for needle in [
            "export const CodeCritter = async",
            "session.status",
            "session.idle",
            "session.error",
            "/v1/event",
            "critter-hook",
        ] {
            assert!(src.contains(needle), "missing {needle}");
        }
        assert_eq!(src, files::opencode_plugin());
    }

    #[test]
    fn manual_agents_are_manual() {
        for id in ["devin", "generic"] {
            let h = Home::new(&format!("manual-{id}"));
            let i = inst(id);
            assert_eq!(i.status(h.p()), Status { installed: false, path: String::new() });
            let r = i.install(h.p(), &hook());
            assert!(r.ok);
            assert!(r.message.contains("agents.md"));
            assert!(!i.status(h.p()).installed);
            assert!(i.uninstall(h.p()).ok);
        }
    }

    #[test]
    fn status_all_covers_every_agent_and_survives_bad_files() {
        let h = Home::new("status-all");
        h.put(&[".claude", "settings.json"], "garbage");
        let all_ = status_all_in(h.p());
        let mut keys: Vec<&str> = all_.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        keys.sort();
        let mut want: Vec<&str> = [
            "claude-code", "codex", "cursor", "gemini", "antigravity", "kiro", "copilot",
            "opencode", "devin", "generic",
        ]
        .to_vec();
        want.sort();
        assert_eq!(keys, want);
        assert_eq!(all_["claude-code"]["installed"], false);
        inst("cursor").install(h.p(), &hook());
        assert_eq!(status_all_in(h.p())["cursor"]["installed"], true);
    }

    #[test]
    fn shell_quote_matches_ts_rules() {
        use super::util::shell_quote;
        let q = |a: &[&str]| shell_quote(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(q(&["node", "/a/b.mjs", "x", "done"]), "node /a/b.mjs x done");
        assert_eq!(q(&["C:\\Program Files\\x.mjs"]), "\"C:/Program Files/x.mjs\"");
        assert_eq!(q(&["a\"b$c`d"]), "\"a\\\"b\\$c\\`d\"");
        assert_eq!(q(&["C:\\x\\y.cmd"]), "C:/x/y.cmd");
    }
}

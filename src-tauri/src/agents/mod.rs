//! T2b: loopback HTTP server (tiny_http) for agent events + installers for claude-code, codex,
//! cursor, gemini/antigravity, kiro, copilot, opencode (+ manual devin/generic).
//! Events go to the overlay via `crate::winmgr::emit_overlay(app, "critter:agent", AgentEvent)`.
//!
//! File formats and behaviour are identical to the Electron implementation so existing user
//! installs (`~/.codecritter/{token,port,critter-hook.*}` and the agents' own config files) keep
//! working. Every installer function takes a `home: &Path` (see `installers`); only the public
//! wrappers below use `dirs::home_dir()`.

pub mod hookcmd;
pub mod installers;
pub mod server;
pub mod token;

use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

const DEFAULT_PORT: u16 = 47626;

static SERVER: Mutex<Option<server::ServerHandle>> = Mutex::new(None);
/// Serialises start/restart so concurrent settings changes can't race on the port.
static LIFECYCLE: Mutex<()> = Mutex::new(());
static HOOK_SOURCE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Find `bin/critter-hook.mjs`: bundled resource first, then the repo (dev builds).
fn locate_hook_source(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("bin").join("critter-hook.mjs"));
        candidates.push(res.join("_up_").join("bin").join("critter-hook.mjs"));
        candidates.push(res.join("critter-hook.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut d = exe.parent().map(Path::to_path_buf);
        for _ in 0..6 {
            let Some(dir) = d else { break };
            candidates.push(dir.join("bin").join("critter-hook.mjs"));
            d = dir.parent().map(Path::to_path_buf);
        }
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("bin").join("critter-hook.mjs"));
    candidates.into_iter().find(|p| p.is_file())
}

fn hook_source() -> Option<PathBuf> {
    HOOK_SOURCE.lock().clone()
}

/// Copy the hook script / write fallback scripts under `<home>/.codecritter`.
fn hook_cmd_for(home: &Path) -> Result<Vec<String>, String> {
    hookcmd::prepare(&token::critter_dir(home), hook_source().as_deref())
        .map(|r| r.hook_cmd)
        .map_err(|e| e.to_string())
}

fn settings_enabled_port(app: &AppHandle) -> (bool, u16) {
    let enabled = crate::store::get_ptr(app, "/agents/enabled").as_bool().unwrap_or(true);
    let port = crate::store::get_ptr(app, "/agents/port")
        .as_u64()
        .filter(|p| *p > 0 && *p < 65536)
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_PORT);
    (enabled, port)
}

fn start_server(app: &AppHandle) {
    let (enabled, port) = settings_enabled_port(app);
    if !enabled {
        return;
    }
    let Some(home) = home() else {
        eprintln!("[agents] no home directory; agent server not started");
        return;
    };
    let tok = match token::ensure_token(&home) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[agents] token unavailable: {e}");
            return;
        }
    };
    let app2 = app.clone();
    let on_event: server::OnEvent = Arc::new(move |e| {
        crate::winmgr::emit_overlay(&app2, "critter:agent", e);
    });
    match server::start(server::ServerOptions {
        port,
        token: tok,
        on_event,
        home: Some(home),
        host: None,
    }) {
        Ok(h) => {
            eprintln!("[agents] listening on 127.0.0.1:{}", h.port);
            *SERVER.lock() = Some(h);
        }
        Err(e) => eprintln!("[agents] bridge unavailable: {e}"),
    }
}

/// Start the server if `settings.agents.enabled`; refresh the copied hook script.
pub fn start(app: AppHandle) {
    *HOOK_SOURCE.lock() = locate_hook_source(&app);
    std::thread::spawn(|| {
        // keep the copied hook script in sync with the app version on every launch
        if let Some(h) = home() {
            if let Err(e) = hook_cmd_for(&h) {
                eprintln!("[agents] hook script: {e}");
            }
        }
    });
    std::thread::spawn(move || {
        let _g = LIFECYCLE.lock();
        start_server(&app);
    });
}

/// Stop and re-start the server (called when `agents.enabled` or `agents.port` changes).
pub fn restart(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _g = LIFECYCLE.lock();
        let old = SERVER.lock().take();
        drop(old); // joins the accept loop (<= ~100 ms)
        start_server(&app);
    });
}

/// `{ [agentId]: { installed: bool, path: string } }` (TS `SettingsBridge.agentStatus`).
pub fn status_all() -> Value {
    match home() {
        Some(h) => installers::status_all_in(&h),
        None => json!({}),
    }
}

/// Returns `(ok, message)`.
pub fn install(id: &str) -> (bool, String) {
    let Some(h) = home() else { return (false, "No home directory".into()) };
    install_in(&h, id)
}

/// Returns `(ok, message)`.
pub fn uninstall(id: &str) -> (bool, String) {
    let Some(h) = home() else { return (false, "No home directory".into()) };
    uninstall_in(&h, id)
}

pub fn install_in(home: &Path, id: &str) -> (bool, String) {
    let Some(inst) = installers::by_id(id) else { return (false, format!("Unknown agent {id}")) };
    let cmd = match hook_cmd_for(home) {
        Ok(c) => c,
        Err(e) => return (false, format!("Could not prepare the hook script: {e}")),
    };
    let r = inst.install(home, &cmd);
    (r.ok, r.message)
}

pub fn uninstall_in(home: &Path, id: &str) -> (bool, String) {
    let Some(inst) = installers::by_id(id) else { return (false, format!("Unknown agent {id}")) };
    let r = inst.uninstall(home);
    (r.ok, r.message)
}

#[cfg(test)]
pub(crate) mod testutil {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    static N: AtomicU32 = AtomicU32::new(0);

    /// Unique temp dir under `std::env::temp_dir()`, removed on drop. Never the real home.
    pub struct TempDir(PathBuf);
    impl TempDir {
        pub fn new(tag: &str) -> TempDir {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let p = std::env::temp_dir().join(format!(
                "critter-t2b-{tag}-{}-{}-{nanos}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
        pub fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Minimal raw HTTP/1.1 client (custom Host/Origin headers allowed). Returns (status, body).
    pub fn http_request(
        port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        s.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let has = |n: &str| headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(n));
        let mut req = format!("{method} {path} HTTP/1.1\r\n");
        if !has("host") {
            req.push_str(&format!("Host: 127.0.0.1:{port}\r\n"));
        }
        for (k, v) in headers {
            req.push_str(&format!("{k}: {v}\r\n"));
        }
        if !body.is_empty() || method == "POST" {
            req.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        req.push_str("Connection: close\r\n\r\n");
        let _ = s.write_all(req.as_bytes());
        let _ = s.write_all(body.as_bytes());
        let mut buf = Vec::new();
        let _ = s.read_to_end(&mut buf); // a reset after the response is fine
        let text = String::from_utf8_lossy(&buf).into_owned();
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }
}

#[cfg(test)]
mod e2e_tests {
    //! End to end: `node bin/critter-hook.mjs` against the Rust server (skipped without node).
    use super::server::{self, AgentEvent, ServerOptions};
    use super::testutil::TempDir;
    use super::token;
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    fn node_available() -> bool {
        Command::new("node").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().map_or(false, |s| s.success())
    }

    fn hook_path() -> String {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("bin")
            .join("critter-hook.mjs")
            .to_string_lossy()
            .into_owned()
    }

    struct Fx {
        home: TempDir,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        server: server::ServerHandle,
    }
    fn fx() -> Fx {
        let home = TempDir::new("e2e");
        let tok = token::ensure_token(home.path()).unwrap();
        let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::default();
        let ev = events.clone();
        let server = server::start(ServerOptions {
            port: 0,
            token: tok,
            on_event: Arc::new(move |e| ev.lock().unwrap().push(e)),
            home: Some(home.path().to_path_buf()),
            host: None,
        })
        .unwrap();
        Fx { home, events, server }
    }

    struct Out {
        code: Option<i32>,
        stdout: String,
        stderr: String,
        ms: u128,
    }
    fn run(f: &Fx, args: &[&str], stdin: Option<&str>, env: &[(&str, &str)], keep_open: bool) -> Out {
        let t0 = Instant::now();
        let mut cmd = Command::new("node");
        cmd.arg(hook_path()).args(args);
        cmd.env("CRITTER_HOME", f.home.path());
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let mut stdin_handle = child.stdin.take();
        if !keep_open {
            if let Some(mut si) = stdin_handle.take() {
                let _ = si.write_all(stdin.unwrap_or("").as_bytes());
            }
        }
        let o = child.wait_with_output().unwrap();
        drop(stdin_handle);
        Out {
            code: o.status.code(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
            ms: t0.elapsed().as_millis(),
        }
    }
    fn evs(f: &Fx) -> Vec<AgentEvent> {
        f.events.lock().unwrap().clone()
    }

    #[test]
    fn hook_cli_end_to_end() {
        if !node_available() {
            eprintln!("node not found; skipping e2e");
            return;
        }
        // 1. token+port from CRITTER_HOME, silent, exit 0
        let f = fx();
        let r = run(&f, &["generic", "done", "--message", "hello"], None, &[], false);
        assert_eq!(r.code, Some(0));
        assert_eq!(r.stdout, "");
        let e = evs(&f);
        assert_eq!(e.len(), 1);
        assert_eq!((e[0].agent.as_str(), e[0].kind.as_str(), e[0].message.as_deref()), ("generic", "done", Some("hello")));

        // 2. message/cwd/session from Claude stdin JSON
        let f = fx();
        let stdin = serde_json::json!({"hook_event_name":"UserPromptSubmit","prompt":"fix the bug","cwd":"/proj","session_id":"s1"}).to_string();
        assert_eq!(run(&f, &["claude-code", "thinking"], Some(&stdin), &[], false).code, Some(0));
        let e = &evs(&f)[0];
        assert_eq!((e.agent.as_str(), e.kind.as_str()), ("claude-code", "thinking"));
        assert_eq!(e.message.as_deref(), Some("fix the bug"));
        assert_eq!(e.cwd.as_deref(), Some("/proj"));
        assert_eq!(e.session.as_deref(), Some("s1"));

        // 3. hook_event_name mapping with type=auto
        let f = fx();
        run(&f, &["claude-code", "auto"], Some(r#"{"hook_event_name":"Notification","message":"needs permission"}"#), &[], false);
        run(&f, &["claude-code", "auto"], Some(r#"{"hook_event_name":"Stop","last_assistant_message":"all done"}"#), &[], false);
        let e = evs(&f);
        assert_eq!((e[0].kind.as_str(), e[0].message.as_deref()), ("attention", Some("needs permission")));
        assert_eq!((e[1].kind.as_str(), e[1].message.as_deref()), ("done", Some("all done")));

        // 4. Codex JSON payload as last argv
        let f = fx();
        let payload = r#"{"type":"agent-turn-complete","thread-id":"t9","cwd":"/w","last-assistant-message":"finished"}"#;
        run(&f, &["codex", "done", payload], None, &[], false);
        let e = &evs(&f)[0];
        assert_eq!((e.agent.as_str(), e.kind.as_str()), ("codex", "done"));
        assert_eq!((e.session.as_deref(), e.cwd.as_deref(), e.message.as_deref()), (Some("t9"), Some("/w"), Some("finished")));

        // 5. server down / token missing -> exit 0 silently
        let f = fx();
        let r = run(&f, &["generic", "done"], None, &[("CRITTER_PORT", "1")], false);
        assert_eq!((r.code, r.stdout.as_str()), (Some(0), ""));
        assert!(evs(&f).is_empty());
        let empty = TempDir::new("e2e-empty");
        let r2 = run(&f, &["generic", "done"], None, &[("CRITTER_HOME", empty.path().to_str().unwrap())], false);
        assert_eq!((r2.code, r2.stdout.as_str()), (Some(0), ""));

        // 6. garbage args / invalid type: silent unless CRITTER_DEBUG
        let f = fx();
        let q = run(&f, &["generic", "bogus-type"], None, &[], false);
        assert_eq!(q.code, Some(0));
        assert_eq!(format!("{}{}", q.stdout, q.stderr), "");
        let d = run(&f, &["generic", "bogus-type"], None, &[("CRITTER_DEBUG", "1")], false);
        assert_eq!((d.code, d.stdout.as_str()), (Some(0), ""));
        assert!(!d.stderr.is_empty());
        assert!(evs(&f).is_empty());

        // 7. stdin left open must not hang (cap)
        let f = fx();
        let r = run(&f, &["generic", "tool"], None, &[], true);
        assert_eq!(r.code, Some(0));
        assert!(r.ms < 3000, "took {} ms", r.ms);
        assert_eq!(evs(&f)[0].kind, "tool");

        // 8. CRITTER_PORT / CRITTER_TOKEN overrides
        let f = fx();
        let empty = TempDir::new("e2e-env");
        let tok = token::ensure_token(f.home.path()).unwrap();
        let port = f.server.port.to_string();
        run(&f, &["generic", "idle"], None, &[("CRITTER_HOME", empty.path().to_str().unwrap()), ("CRITTER_PORT", &port), ("CRITTER_TOKEN", &tok)], false);
        assert_eq!(evs(&f)[0].kind, "idle");
    }

    #[test]
    fn install_in_prepares_hook_script_under_temp_home() {
        let home = TempDir::new("install-in");
        let (ok, msg) = super::install_in(home.path(), "cursor");
        assert!(ok, "{msg}");
        assert!(home.path().join(".cursor").join("hooks.json").exists());
        let (ok2, _) = super::uninstall_in(home.path(), "cursor");
        assert!(ok2);
        assert!(!super::install_in(home.path(), "nope").0);
    }
}

//! Auto-update (tauri-plugin-updater). The ONLY network request CodeCritter makes: a GET of `latest.json`
//! from GitHub Releases (endpoint in tauri.conf.json), ~30 s after start and then every 6 h, only while
//! `settings.updates.auto` is on (the manual "Check for updates now" / tray item always works).
//! Updates are minisign-verified by the plugin against the pubkey in tauri.conf.json.
//!
//! Flow: check -> (auto) download in the background -> install at a quiet moment (user idle >= 2 min and
//! no Pomodoro running) or immediately on tray Quit -> the installer relaunches the app -> the overlay
//! shows an "Updated to vX.Y.Z" bubble (a marker file `updated.json` bridges the restart).
//! Offline / no release yet / any error: silent (CRITTER_DEBUG log only).

use crate::{scheduler, store, winmgr};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
const TICK: Duration = Duration::from_secs(15);
/// The user must have been away this long before a downloaded update installs by itself.
pub const QUIET_IDLE_MS: u64 = 120_000;

/// Pure: may a downloaded update install now (without the user asking)?
pub fn quiet_moment(idle_ms: u64, pomodoro_running: bool) -> bool {
    idle_ms >= QUIET_IDLE_MS && !pomodoro_running
}

/// Pure: is the next automatic check due? `since_last` is None before the first check.
pub fn check_due(since_start: Duration, since_last: Option<Duration>) -> bool {
    match since_last {
        None => since_start >= FIRST_CHECK_AFTER,
        Some(d) => d >= CHECK_EVERY,
    }
}

#[derive(Default)]
struct Inner {
    last_checked_ms: Option<i64>,
    last_check_at: Option<Instant>,
    available: Option<(String, Option<String>)>,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    error: Option<String>,
    installing: bool,
}

static ST: OnceLock<Mutex<Inner>> = OnceLock::new();

fn st() -> &'static Mutex<Inner> {
    ST.get_or_init(|| Mutex::new(Inner::default()))
}

fn debug() -> bool {
    std::env::var_os("CRITTER_DEBUG").is_some()
}

fn log(msg: &str) {
    if debug() {
        eprintln!("[critter] updater: {msg}");
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn auto_on(app: &AppHandle) -> bool {
    store::get_ptr(app, "/updates/auto").as_bool().unwrap_or(true)
}

/// Check for an update; when `download` is set also fetch it. Never panics, never surfaces errors to the user
/// except through the returned `Err` (callers decide whether to show it).
async fn check_inner(app: &AppHandle, download: bool) -> Result<Value, String> {
    let result = async {
        let updater = app.updater().map_err(|e| e.to_string())?;
        updater.check().await.map_err(|e| e.to_string())
    }
    .await;
    // Record the outcome synchronously (the guard must not live across an await).
    let (outcome, to_download) = {
        let mut g = st().lock();
        g.last_check_at = Some(Instant::now());
        g.last_checked_ms = Some(now_ms());
        match result {
            Err(e) => {
                log(&format!("check failed: {e}"));
                g.error = Some(e.clone());
                (Err(e), None)
            }
            Ok(None) => {
                log("up to date");
                g.error = None;
                g.available = None;
                g.update = None;
                g.bytes = None;
                (Ok(json!({ "available": false })), None)
            }
            Ok(Some(u)) => {
                log(&format!("update available: {}", u.version));
                g.error = None;
                let info = json!({ "available": true, "version": u.version, "notes": u.body });
                let same = g.update.as_ref().map(|c| c.version == u.version).unwrap_or(false);
                g.available = Some((u.version.clone(), u.body.clone()));
                if !same {
                    g.bytes = None;
                    g.update = Some(u);
                }
                let dl = if download && g.bytes.is_none() { g.update.clone() } else { None };
                (Ok(info), dl)
            }
        }
    };
    if let Some(u) = to_download {
        match u.download(|_, _| {}, || {}).await {
            Ok(b) => {
                log(&format!("downloaded {} bytes", b.len()));
                st().lock().bytes = Some(b);
            }
            Err(e) => {
                log(&format!("download failed: {e}"));
                st().lock().error = Some(e.to_string());
            }
        }
    }
    outcome
}

fn marker_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("updated.json"))
}

/// Installs the downloaded (or freshly downloaded) update. On Windows the installer ends this process and
/// relaunches the app; elsewhere we restart explicitly.
async fn install_inner(app: &AppHandle) -> Result<(), String> {
    let (update, bytes, version) = {
        let mut g = st().lock();
        if g.installing {
            return Ok(());
        }
        let Some(u) = g.update.clone() else { return Err("no update available".into()) };
        g.installing = true;
        (u.clone(), g.bytes.clone(), u.version)
    };
    let bytes = match bytes {
        Some(b) => b,
        None => match update.download(|_, _| {}, || {}).await {
            Ok(b) => b,
            Err(e) => {
                st().lock().installing = false;
                return Err(e.to_string());
            }
        },
    };
    if let Some(p) = marker_path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, json!({ "to": version }).to_string());
    }
    log(&format!("installing {version}"));
    if let Err(e) = update.install(bytes) {
        st().lock().installing = false;
        if let Some(p) = marker_path(app) {
            let _ = std::fs::remove_file(p);
        }
        return Err(e.to_string());
    }
    app.restart();
}

/// Settings command: manual check (download is left to the user's "Install" press unless auto is on).
pub async fn check_now(app: &AppHandle) -> Result<Value, String> {
    let auto = auto_on(app);
    check_inner(app, auto).await
}

pub async fn install_now(app: &AppHandle) -> Result<(), String> {
    install_inner(app).await
}

/// `UpdateStatus` for the settings window.
pub fn status() -> Value {
    let g = st().lock();
    let mut v = json!({
        "currentVersion": env!("CARGO_PKG_VERSION"),
        "lastCheckedAt": g.last_checked_ms,
        "available": g.available.is_some(),
        "downloaded": g.bytes.is_some(),
    });
    if let Some((ver, _)) = &g.available {
        v["version"] = json!(ver);
    }
    if let Some(e) = &g.error {
        v["error"] = json!(e);
    }
    v
}

/// Tray Quit: if an update is already downloaded and auto-update is on, install it instead of just exiting.
/// Returns true when an install was started (the process is replaced/restarted by it).
pub fn install_on_quit(app: &AppHandle) -> bool {
    if !auto_on(app) || st().lock().bytes.is_none() {
        return false;
    }
    let app = app.clone();
    tauri::async_runtime::block_on(async move { install_inner(&app).await.is_ok() })
}

/// Tray "Check for updates...": check, then tell the user through a bubble.
pub fn tray_check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let text = match check_now(&app).await {
            Ok(v) if v["available"] == true => {
                let ver = v["version"].as_str().unwrap_or("").to_string();
                if auto_on(&app) {
                    format!("v{ver} found. Installs when you are away.")
                } else {
                    format!("v{ver} is available. Open Settings to install.")
                }
            }
            Ok(_) => "You are up to date.".to_string(),
            Err(_) => "Could not check for updates.".to_string(),
        };
        winmgr::emit_overlay(&app, "critter:reminder", json!({ "kind": "message", "text": text, "durationMs": 5000 }));
    });
}

/// After a self-update the installer relaunches the app: show "Updated to vX.Y.Z" once.
fn announce_update(app: &AppHandle) {
    let Some(p) = marker_path(app) else { return };
    let Ok(text) = std::fs::read_to_string(&p) else { return };
    let _ = std::fs::remove_file(&p);
    let to = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}'))
        .ok()
        .and_then(|v| v["to"].as_str().map(str::to_string));
    if to.as_deref() == Some(env!("CARGO_PKG_VERSION")) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(4));
            winmgr::emit_overlay(
                &app,
                "critter:reminder",
                json!({ "kind": "updated", "text": env!("CARGO_PKG_VERSION"), "durationMs": 6000 }),
            );
        });
    }
}

pub fn start(app: AppHandle) {
    announce_update(&app);
    std::thread::Builder::new()
        .name("updater".into())
        .spawn(move || {
            let t0 = Instant::now();
            loop {
                std::thread::sleep(TICK);
                if !auto_on(&app) {
                    continue;
                }
                let since_last = st().lock().last_check_at.map(|t| t.elapsed());
                if check_due(t0.elapsed(), since_last) {
                    let app2 = app.clone();
                    let _ = tauri::async_runtime::block_on(async move { check_inner(&app2, true).await });
                }
                let ready = st().lock().bytes.is_some();
                if ready && quiet_moment(scheduler::idle_ms_now(), scheduler::pomodoro_running()) {
                    log("quiet moment: installing");
                    let app2 = app.clone();
                    let _ = tauri::async_runtime::block_on(async move { install_inner(&app2).await });
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_moment_needs_two_minutes_idle_and_no_pomodoro() {
        assert!(!quiet_moment(0, false));
        assert!(!quiet_moment(119_999, false));
        assert!(quiet_moment(120_000, false));
        assert!(!quiet_moment(10 * 60_000, true));
    }

    #[test]
    fn check_schedule_30s_then_every_6h() {
        assert!(!check_due(Duration::from_secs(29), None));
        assert!(check_due(Duration::from_secs(30), None));
        assert!(!check_due(Duration::from_secs(9999), Some(Duration::from_secs(3600))));
        assert!(check_due(Duration::from_secs(99999), Some(CHECK_EVERY)));
    }
}

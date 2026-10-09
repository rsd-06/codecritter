//! One-time hint bubbles for Linux desktops: no tray host (GNOME without the AppIndicator extension) and
//! input that looks dead on a Wayland session. Each hint is shown once (marker file in the config dir).

use crate::{scheduler, winmgr};
use serde_json::json;
use std::{process::Command, thread, time::Duration};
use tauri::{AppHandle, Manager};

use super::session::{self, Session};

pub const TRAY_HINT: &str = "No system tray found. On GNOME install the AppIndicator extension to see it. \
Ctrl+Alt+S opens Settings, Ctrl+Alt+H hides me.";
pub const INPUT_HINT: &str = "Not seeing your typing? On Wayland only XWayland apps are visible to me. \
See docs/linux.md (evdev mode).";

/// Pure: parse `dbus-send ... NameHasOwner` output.
pub fn parse_name_has_owner(out: &str) -> Option<bool> {
    let l = out.lines().find(|l| l.contains("boolean"))?;
    if l.contains("true") {
        Some(true)
    } else if l.contains("false") {
        Some(false)
    } else {
        None
    }
}

/// Is a StatusNotifier host/watcher on the session bus? None when it cannot be determined.
pub fn tray_host_present() -> Option<bool> {
    let out = Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus.NameHasOwner",
            "string:org.kde.StatusNotifierWatcher",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_name_has_owner(&String::from_utf8_lossy(&out.stdout))
}

/// Pure: should the dead-input hint show? Wayland session, nothing seen for the whole wait.
pub fn input_looks_dead(sess: Session, idle_ms: u64, waited_ms: u64) -> bool {
    sess == Session::Wayland && idle_ms >= waited_ms.saturating_sub(5_000)
}

fn show_once(app: &AppHandle, name: &str, text: &str) {
    let marker = app.path().app_config_dir().ok().map(|d| d.join(format!("hint-{name}")));
    if let Some(m) = &marker {
        if m.exists() {
            return;
        }
        if let Some(dir) = m.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(m, "1");
    }
    winmgr::emit_overlay(app, "critter:reminder", json!({ "kind": "message", "text": text, "durationMs": 12000 }));
}

/// Tray creation failed outright (setup continues without it).
pub fn tray_failed(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(5));
        show_once(&app, "tray", TRAY_HINT);
    });
}

pub fn start(app: AppHandle) {
    let _ = thread::Builder::new().name("linux-hints".into()).spawn(move || {
        thread::sleep(Duration::from_secs(8));
        if tray_host_present() == Some(false) {
            show_once(&app, "tray", TRAY_HINT);
        }
        const WAIT_MS: u64 = 90_000;
        thread::sleep(Duration::from_millis(WAIT_MS));
        if input_looks_dead(session::current(), scheduler::idle_ms_now(), WAIT_MS) {
            show_once(&app, "input", INPUT_HINT);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dbus_reply() {
        assert_eq!(parse_name_has_owner("method return time=1\n   boolean true\n"), Some(true));
        assert_eq!(parse_name_has_owner("method return\n   boolean false\n"), Some(false));
        assert_eq!(parse_name_has_owner("Error"), None);
    }

    #[test]
    fn dead_input_only_on_wayland_after_full_silence() {
        assert!(input_looks_dead(Session::Wayland, 100_000, 90_000));
        assert!(!input_looks_dead(Session::Wayland, 2_000, 90_000));
        assert!(!input_looks_dead(Session::X11, 100_000, 90_000));
    }
}

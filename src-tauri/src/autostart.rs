//! Login-item registration. Release builds only (a debug build would register the dev exe).

use crate::store;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn apply(app: &AppHandle, enabled: bool) {
    if cfg!(debug_assertions) || cfg!(target_os = "linux") {
        return;
    }
    let launch = app.autolaunch();
    let current = launch.is_enabled().unwrap_or(false);
    if current == enabled {
        return;
    }
    let r = if enabled { launch.enable() } else { launch.disable() };
    if let Err(e) = r {
        eprintln!("[autostart] {e}");
    }
}

pub fn init(app: &AppHandle) {
    apply(app, store::get_ptr(app, "/autostart").as_bool().unwrap_or(false));
}

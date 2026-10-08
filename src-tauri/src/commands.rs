//! Webview -> Rust commands. Names are the snake_case form of the IPC keys in src/shared/ipc.ts.
//! JS invoke args are camelCase (`{ id }`, `{ kind }`, `{ patch }`, `{ on }`, `{ cmd }`, `{ dx, dy }`).

use crate::{agents, scheduler, store, sync, updater, winmgr};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Value {
    store::get(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, patch: Value) -> Value {
    store::update(&app, patch)
}

#[tauri::command]
pub fn set_interactive(app: AppHandle, on: bool) {
    winmgr::set_interactive(&app, on);
}

#[tauri::command]
pub fn drag_start(app: AppHandle) {
    winmgr::drag_start(&app);
}

/// dx/dy are accepted for contract parity but ignored (global cursor delta is used).
#[tauri::command]
pub fn drag_move(app: AppHandle, dx: Option<f64>, dy: Option<f64>) {
    let _ = (dx, dy);
    winmgr::drag_move(&app);
}

#[tauri::command]
pub fn drag_end(app: AppHandle) {
    winmgr::drag_end(&app);
}

#[tauri::command]
pub async fn open_settings(app: AppHandle) {
    winmgr::open_settings(&app);
}

#[tauri::command]
pub fn show_context_menu(app: AppHandle) {
    crate::tray::popup_menu(&app);
}

#[tauri::command]
pub fn pomodoro_cmd(app: AppHandle, cmd: String) -> Value {
    scheduler::pomodoro_cmd(&app, &cmd)
}

#[tauri::command]
pub fn pomodoro_state(app: AppHandle) -> Value {
    scheduler::pomodoro_state(&app)
}

#[tauri::command]
pub async fn agent_status() -> Value {
    tauri::async_runtime::spawn_blocking(agents::status_all).await.unwrap_or_else(|_| json!({}))
}

fn ok_msg((ok, message): (bool, String)) -> Value {
    json!({ "ok": ok, "message": message })
}

#[tauri::command]
pub async fn install_agent(id: String) -> Value {
    let r = tauri::async_runtime::spawn_blocking(move || agents::install(&id)).await;
    ok_msg(r.unwrap_or((false, "installer crashed".into())))
}

#[tauri::command]
pub async fn uninstall_agent(id: String) -> Value {
    let r = tauri::async_runtime::spawn_blocking(move || agents::uninstall(&id)).await;
    ok_msg(r.unwrap_or((false, "uninstaller crashed".into())))
}

/// Synthetic agent event for the settings "test" buttons.
#[tauri::command]
pub fn test_event(app: AppHandle, kind: String) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    winmgr::emit_overlay(
        &app,
        "critter:agent",
        json!({ "agent": "generic", "type": kind, "message": format!("test {kind}"), "ts": ts }),
    );
}

#[tauri::command]
pub fn test_reminder(app: AppHandle, kind: String) {
    scheduler::test_reminder(&app, &kind);
}

#[tauri::command]
pub async fn export_settings(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || sync::export(&app)).await.ok().flatten()
}

#[tauri::command]
pub async fn import_settings(app: AppHandle) -> bool {
    tauri::async_runtime::spawn_blocking(move || sync::import(&app)).await.unwrap_or(false)
}

/// Opens an https URL in the default browser (settings "About" links via `window.open`).
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) {
    if url.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

/// Used by tests/diagnostics from the webview console: re-broadcast current settings.
#[tauri::command]
pub fn rebroadcast_settings(app: AppHandle) {
    let _ = app.emit(store::EVT_SETTINGS, store::get(&app));
}

/// Manual update check (settings button). Errors are returned as an error string (offline etc.).
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Value, String> {
    updater::check_now(&app).await
}

/// Download (if needed), install and relaunch.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install_now(&app).await
}

#[tauri::command]
pub fn update_status() -> Value {
    updater::status()
}

/// "granted" | "denied" | "not-needed": whether the OS lets CodeCritter see global keyboard/mouse activity
/// (macOS Input Monitoring). Counts only; key identities are never read.
#[tauri::command]
pub fn input_access() -> &'static str {
    crate::platform::input_access()
}

/// Opens the OS pane where the user grants that access (no-op where none is needed).
#[tauri::command]
pub fn open_input_access() {
    crate::platform::open_input_access_settings();
}

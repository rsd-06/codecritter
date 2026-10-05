//! T2c owns this file. Settings export/import + sync-folder watcher (2 s mtime poll, or the optional
//! `notify` crate behind the `notify-watch` feature). Sync file excludes position, syncFolder and
//! agents.token. Apply imported settings with `crate::store::update`.

use tauri::AppHandle;

/// Start the sync-folder watcher for `settings.syncFolder`. T1 stub: no-op.
pub fn start(_app: AppHandle) {}

/// Called by `store::update` on every settings change (EXTRA hook beyond the plan, no-op for now):
/// push to the sync folder / re-point the watcher when `syncFolder` changed.
pub fn on_settings_changed(_app: &AppHandle) {}

/// Ask for a save path (tauri-plugin-dialog `blocking_save_file`), write settings, return the path.
/// Called from a blocking thread, so blocking dialogs are fine. None = cancelled.
pub fn export(_app: &AppHandle) -> Option<String> {
    None
}

/// Ask for a file (blocking open dialog), validate, apply via `store::update`. false = cancelled/invalid.
pub fn import(_app: &AppHandle) -> bool {
    false
}

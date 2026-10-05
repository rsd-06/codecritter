//! T2b owns this directory. Loopback HTTP server (tiny_http) for agent events + installers for
//! claude-code, codex, cursor, gemini/antigravity, kiro, copilot, opencode.
//! Events go to the overlay via `crate::winmgr::emit_overlay(app, "critter:agent", AgentEvent)`.

use serde_json::{json, Value};
use tauri::AppHandle;

/// Start the server if `settings.agents.enabled`. T1 stub: no-op.
pub fn start(_app: AppHandle) {}

/// Stop and re-start the server (called when `agents.enabled` or `agents.port` changes).
pub fn restart(_app: &AppHandle) {}

/// `{ [agentId]: { installed: bool, path: string } }` (TS `SettingsBridge.agentStatus`).
pub fn status_all() -> Value {
    json!({})
}

/// Returns `(ok, message)`.
pub fn install(_id: &str) -> (bool, String) {
    (false, "Agent installers not available yet".into())
}

/// Returns `(ok, message)`.
pub fn uninstall(_id: &str) -> (bool, String) {
    (false, "Agent installers not available yet".into())
}

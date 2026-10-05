//! T2a owns this directory. Global keyboard/mouse hook (rdev) -> aggregator (counts only, never key
//! identities) -> `critter:input` events (`InputSample`, camelCase) to the overlay.
//! Honour `state::is_paused(app)` (stop emitting) and keep the stream silent when idle.

use tauri::AppHandle;

/// Spawn the listener thread. T1 stub: no-op.
pub fn start(_app: AppHandle) {}

//! T2c owns this directory (plus sync.rs). 1 s tick thread; pure logic with an injectable clock.
//! Reminder/pomodoro events: `crate::winmgr::emit_overlay(app, "critter:reminder" | "critter:pomodoro", ..)`;
//! pomodoro state pushes should use `app.emit("critter:pomodoro", state)` so the settings window
//! also receives them. Read settings with `crate::store::get(app)`; write with `crate::store::update`.

use serde_json::{json, Value};
use tauri::AppHandle;

pub fn start(_app: AppHandle) {}

/// Called by `store::update` when reminders / pomodoro / messages / dnd changed.
pub fn on_settings_changed(_app: &AppHandle) {}

/// `cmd` is one of start | pause | resume | skip | stop. Returns the new `PomodoroState`.
pub fn pomodoro_cmd(app: &AppHandle, _cmd: &str) -> Value {
    pomodoro_state(app)
}

/// TS `PomodoroState`: `{ phase, endsAt, cycle, paused, remainingMs }`.
pub fn pomodoro_state(_app: &AppHandle) -> Value {
    json!({ "phase": "idle", "endsAt": null, "cycle": 0, "paused": false, "remainingMs": 0 })
}

/// Emit a `ReminderEvent` of `kind` to the overlay (settings "test reminder" buttons).
/// T1 behaviour: fixed text, 6 s; T2c may personalise.
pub fn test_reminder(app: &AppHandle, kind: &str) {
    let text = match kind {
        "stretch" => "Time to stretch!",
        "water" => "Drink some water!",
        "pomodoro-focus" => "Focus time!",
        "pomodoro-break" => "Break time!",
        "pomodoro-done" => "All done!",
        _ => "Hello from CodeCritter!",
    };
    crate::winmgr::emit_overlay(
        app,
        "critter:reminder",
        json!({ "kind": kind, "text": text, "durationMs": 6000 }),
    );
}

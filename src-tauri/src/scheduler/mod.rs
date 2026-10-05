//! Scheduler: one 1 s tick thread drives the pomodoro engine (every tick) and the reminder engine
//! (every 20 s, like the Electron app). Logic lives in `reminders.rs` / `pomodoro.rs` (pure, tested).
//! Events: `critter:reminder` -> overlay only; `critter:pomodoro` -> every window.
//!
//! Idle detection: `note_input_activity()` (call from the input aggregator on any key/click/move)
//! records the last input time; until it is called once idle is treated as 0 (never "away").

pub mod pomodoro;
pub mod reminders;

use parking_lot::Mutex;
use pomodoro::{Cfg, PomodoroEngine};
use reminders::{Clock, ReminderEngine, SystemClock, TICK_MS};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Epoch ms of the last user input; 0 = never reported (idle unknown -> 0).
static LAST_INPUT_MS: AtomicU64 = AtomicU64::new(0);
static START_MS: AtomicU64 = AtomicU64::new(0);

/// Record user activity "now" (cheap; safe to call from the input hook at any rate).
pub fn note_input_activity() {
    LAST_INPUT_MS.store(SystemClock.now_ms().max(1) as u64, Ordering::Relaxed);
}

/// Idle time now (for the updater): since the last input, or since the scheduler started when none yet.
pub fn idle_ms_now() -> u64 {
    let now = SystemClock.now_ms();
    match LAST_INPUT_MS.load(Ordering::Relaxed) {
        0 => (now.max(0) as u64).saturating_sub(START_MS.load(Ordering::Relaxed)),
        t => (now.max(0) as u64).saturating_sub(t),
    }
}

/// A Pomodoro session (focus or break, paused or not) is in progress.
pub fn pomodoro_running() -> bool {
    sched().lock().pomo.state(SystemClock.now_ms()).phase != pomodoro::Phase::Idle
}

fn idle_ms(now: i64) -> u64 {
    match LAST_INPUT_MS.load(Ordering::Relaxed) {
        0 => 0,
        t => (now.max(0) as u64).saturating_sub(t),
    }
}

struct Sched {
    rem: ReminderEngine,
    pomo: PomodoroEngine,
    last_rem_tick: i64,
}

static SCHED: OnceLock<Mutex<Sched>> = OnceLock::new();

fn sched() -> &'static Mutex<Sched> {
    SCHED.get_or_init(|| Mutex::new(Sched { rem: ReminderEngine::new(), pomo: PomodoroEngine::new(), last_rem_tick: 0 }))
}

fn emit_reminder(app: &AppHandle, kind: &str, text: &str, duration_ms: u64) {
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        eprintln!("[critter] reminder {kind}");
    }
    crate::winmgr::emit_overlay(app, "critter:reminder", json!({ "kind": kind, "text": text, "durationMs": duration_ms }));
}

fn apply_pomo(app: &AppHandle, effects: Vec<pomodoro::Effect>) {
    for e in effects {
        match e {
            pomodoro::Effect::State(s) => {
                let _ = app.emit("critter:pomodoro", s.to_json());
            }
            pomodoro::Effect::Reminder { kind, duration_ms } => emit_reminder(app, kind, "", duration_ms),
        }
    }
}

fn apply_rem(app: &AppHandle, effects: Vec<reminders::Effect>) {
    for e in effects {
        match e {
            reminders::Effect::Fire { kind, text, duration_ms } => emit_reminder(app, kind, &text, duration_ms),
            reminders::Effect::DisableMessage(id) => {
                let msgs: Vec<Value> = crate::store::get(app)["messages"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|mut m| {
                        if m["id"].as_str() == Some(id.as_str()) {
                            m["enabled"] = json!(false);
                        }
                        m
                    })
                    .collect();
                crate::store::update(app, json!({ "messages": msgs }));
            }
        }
    }
}

pub fn start(app: AppHandle) {
    {
        let now = SystemClock.now_ms();
        START_MS.store(now.max(0) as u64, Ordering::Relaxed);
        let s = crate::store::get(&app);
        let mut g = sched().lock();
        g.rem.sync_intervals(now, &s);
        g.last_rem_tick = now;
    }
    std::thread::Builder::new()
        .name("scheduler".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = SystemClock.now_ms();
            let settings = crate::store::get(&app);
            let (pe, re) = {
                let mut g = sched().lock();
                let pe = g.pomo.tick(now, &Cfg::from_settings(&settings));
                let re = if now - g.last_rem_tick >= TICK_MS as i64 {
                    g.last_rem_tick = now;
                    g.rem.tick(&SystemClock, idle_ms(now), &settings)
                } else {
                    Vec::new()
                };
                (pe, re)
            };
            apply_pomo(&app, pe);
            apply_rem(&app, re);
        })
        .ok();
}

/// Called by `store::update` when reminders / pomodoro / messages / dnd changed.
pub fn on_settings_changed(app: &AppHandle) {
    let s = crate::store::get(app);
    sched().lock().rem.sync_intervals(SystemClock.now_ms(), &s);
}

/// `cmd` is one of start | pause | resume | skip | stop. Returns the new `PomodoroState`.
pub fn pomodoro_cmd(app: &AppHandle, cmd: &str) -> Value {
    let now = SystemClock.now_ms();
    let cfg = Cfg::from_settings(&crate::store::get(app));
    let (effects, state) = {
        let mut g = sched().lock();
        let e = match cmd {
            "start" => g.pomo.start(now, &cfg),
            "pause" => g.pomo.pause(now),
            "resume" => g.pomo.resume(now),
            "skip" => g.pomo.skip(now, &cfg),
            "stop" => g.pomo.stop(now),
            _ => Vec::new(),
        };
        (e, g.pomo.state(now))
    };
    apply_pomo(app, effects);
    state.to_json()
}

/// TS `PomodoroState`: `{ phase, endsAt, cycle, paused, remainingMs }`.
pub fn pomodoro_state(_app: &AppHandle) -> Value {
    let now = SystemClock.now_ms();
    sched().lock().pomo.state(now).to_json()
}

/// Emit a `ReminderEvent` of `kind` to the overlay (settings "test reminder" buttons).
/// Text is empty for stretch/water/pomodoro-* (the overlay chooses lines); `message` carries a fixed text.
pub fn test_reminder(app: &AppHandle, kind: &str) {
    match kind {
        "stretch" | "water" => emit_reminder(app, kind, "", reminders::REMINDER_DURATION_MS),
        "pomodoro-focus" | "pomodoro-break" => emit_reminder(app, kind, "", 6000),
        "pomodoro-done" => emit_reminder(app, kind, "", 8000),
        _ => emit_reminder(app, "message", "Hello from CodeCritter!", reminders::REMINDER_DURATION_MS),
    }
}

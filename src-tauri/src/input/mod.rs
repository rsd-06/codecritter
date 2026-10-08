//! Global keyboard/mouse hook (rdev) -> aggregator (counts only, never key identities) ->
//! `critter:input` events (`InputSample`, camelCase) to the overlay.
//! Silent while reactions are paused / the companion is hidden; silent when nothing changes.

pub mod aggregator;
#[cfg(not(target_os = "macos"))]
mod hook;
#[cfg(windows)]
mod wheel;

use crate::{state, winmgr};
use aggregator::InputAggregator;
use parking_lot::Mutex;
use serde_json::json;
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::AppHandle;

pub fn start(app: AppHandle) {
    let t0 = Instant::now();
    let agg = Arc::new(Mutex::new(InputAggregator::new(0.0, 1000.0, 10000.0)));
    // macOS: counting event tap + Input Monitoring permission flow (platform/macos/input.rs); elsewhere rdev.
    #[cfg(target_os = "macos")]
    let failed = crate::platform::macos::input::start(agg.clone(), t0, app.clone());
    #[cfg(not(target_os = "macos"))]
    let failed = hook::start(agg.clone(), t0);
    #[cfg(windows)]
    wheel::start(agg.clone(), t0);
    let debug = std::env::var_os("CRITTER_DEBUG").is_some();

    thread::spawn(move || {
        let mut last_cursor: Option<(f64, f64)> = None;
        loop {
            thread::sleep(Duration::from_millis(100));
            let now = t0.elapsed().as_secs_f64() * 1000.0;
            let mut a = agg.lock();
            if failed.load(Ordering::Relaxed) {
                // Cursor-only fallback: derive mouse speed from polled positions.
                if let Ok(c) = app.cursor_position() {
                    if last_cursor != Some((c.x, c.y)) {
                        crate::scheduler::note_input_activity();
                        a.mouse_move(c.x, c.y, now);
                        last_cursor = Some((c.x, c.y));
                    }
                }
            }
            let sample = a.tick(now);
            drop(a);
            if let Some(s) = sample {
                if state::is_paused(&app) || state::is_hidden(&app) {
                    continue;
                }
                if debug {
                    eprintln!(
                        "[critter] input kps={} burst={} scroll={} mouse={} clicks={} idle={}",
                        s.keys_per_sec, s.key_burst, s.scroll_delta, s.mouse_speed, s.clicks_per_sec, s.idle_ms
                    );
                }
                winmgr::emit_overlay(
                    &app,
                    "critter:input",
                    json!({
                        "keysPerSec": s.keys_per_sec,
                        "keyBurst": s.key_burst,
                        "scrollDelta": s.scroll_delta,
                        "mouseSpeed": s.mouse_speed,
                        "clicksPerSec": s.clicks_per_sec,
                        "idleMs": s.idle_ms,
                    }),
                );
            }
        }
    });
}

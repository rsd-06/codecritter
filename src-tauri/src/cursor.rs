//! Emits `critter:cursor` (`CursorSample`: screen cursor + overlay bounds, all in PHYSICAL pixels) to
//! the overlay. The overlay hit-tests click-through from these samples, so sampling continues while
//! reactions are paused; it stops (slow re-check only) while the companion is hidden. While peeking it keeps sampling
//! (same 4 / 30 Hz rates) so the visible part of the head can still be hit-tested (right-click menu).
//!
//! Rate: 30 Hz while the cursor is within 400 logical px of the overlay or moving fast, else 4 Hz
//! (also 4 Hz once the cursor has been still for 3 s). Unchanged samples are not emitted.

use crate::{state, winmgr};
use serde_json::json;
use std::{
    thread,
    time::{Duration, Instant},
};
use tauri::AppHandle;

const FAST_MS: u64 = 33;
const SLOW_MS: u64 = 250;
const STOPPED_MS: u64 = 500;
const NEAR_PX: f64 = 400.0; // logical
const FAST_SPEED: f64 = 600.0; // logical px/s
const STILL_MS: u128 = 3000;

/// Pure: distance from a point to a rect (0 when inside).
pub fn dist_to_rect(x: f64, y: f64, rx: f64, ry: f64, rw: f64, rh: f64) -> f64 {
    let dx = (rx - x).max(0.0).max(x - (rx + rw));
    let dy = (ry - y).max(0.0).max(y - (ry + rh));
    dx.hypot(dy)
}

/// Pure: polling interval for the next sample.
pub fn next_delay(dist_px: f64, speed_px_s: f64, still: bool, scale: f64) -> u64 {
    if !still && (speed_px_s > FAST_SPEED * scale || dist_px <= NEAR_PX * scale) {
        FAST_MS
    } else {
        SLOW_MS
    }
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<(i64, i64, i32, i32, u32, u32)> = None;
        let mut last_pt: Option<(f64, f64, Instant)> = None;
        let mut last_move = Instant::now();
        loop {
            let mut delay = STOPPED_MS;
            if !state::is_hidden(&app) {
                delay = SLOW_MS;
                if let (Some(w), Ok(c)) = (winmgr::overlay(&app), app.cursor_position()) {
                    if let (Ok(p), Ok(s), Ok(sf)) = (w.outer_position(), w.outer_size(), w.scale_factor()) {
                        let now = Instant::now();
                        let speed = match last_pt {
                            Some((lx, ly, t)) if (lx, ly) != (c.x, c.y) => {
                                (c.x - lx).hypot(c.y - ly) / now.duration_since(t).as_secs_f64().max(0.001)
                            }
                            _ => 0.0,
                        };
                        if last_pt.map_or(true, |(lx, ly, _)| (lx, ly) != (c.x, c.y)) {
                            last_move = now;
                        }
                        last_pt = Some((c.x, c.y, now));
                        let key = (c.x.round() as i64, c.y.round() as i64, p.x, p.y, s.width, s.height);
                        if last != Some(key) {
                            last = Some(key);
                            winmgr::emit_overlay(
                                &app,
                                "critter:cursor",
                                json!({
                                    "x": key.0, "y": key.1,
                                    "winX": p.x, "winY": p.y, "winW": s.width, "winH": s.height,
                                }),
                            );
                        }
                        let d = dist_to_rect(c.x, c.y, p.x as f64, p.y as f64, s.width as f64, s.height as f64);
                        delay = next_delay(d, speed, last_move.elapsed().as_millis() > STILL_MS, sf);
                    }
                }
            } else {
                last_pt = None;
                last = None; // re-emit when the overlay is shown again
            }
            thread::sleep(Duration::from_millis(delay));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_is_zero_inside_and_euclidean_outside() {
        assert_eq!(dist_to_rect(5.0, 5.0, 0.0, 0.0, 10.0, 10.0), 0.0);
        assert_eq!(dist_to_rect(13.0, 14.0, 0.0, 0.0, 10.0, 10.0), 5.0);
        assert_eq!(dist_to_rect(-3.0, 5.0, 0.0, 0.0, 10.0, 10.0), 3.0);
    }

    #[test]
    fn delay_fast_near_or_fast_slow_otherwise() {
        assert_eq!(next_delay(100.0, 0.0, false, 1.0), FAST_MS);
        assert_eq!(next_delay(900.0, 0.0, false, 1.0), SLOW_MS);
        assert_eq!(next_delay(900.0, 700.0, false, 1.0), FAST_MS);
        assert_eq!(next_delay(100.0, 0.0, true, 1.0), SLOW_MS);
        assert_eq!(next_delay(700.0, 0.0, false, 2.0), FAST_MS); // 400 logical = 800 physical
    }
}

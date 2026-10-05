//! T2a owns this file. Emits `critter:cursor` (`CursorSample`: screen cursor + overlay bounds, all in
//! PHYSICAL pixels) to the overlay. The overlay hit-tests from these samples (click-through is
//! driven by them), so keep sampling while reactions are paused; only stop when hidden.
//!
//! T1 implementation (minimal): 30 Hz while the cursor is within 400 logical px of the overlay,
//! 4 Hz otherwise, 2 Hz while hidden. T2a: tune / add peek handling / skip identical samples.

use crate::{state, winmgr};
use serde_json::json;
use std::{thread, time::Duration};
use tauri::AppHandle;

pub fn start(app: AppHandle) {
    thread::spawn(move || loop {
        let mut delay = 250;
        if state::is_hidden(&app) {
            delay = 500;
        } else if let (Some(w), Ok(c)) = (winmgr::overlay(&app), app.cursor_position()) {
            if let (Ok(p), Ok(s), Ok(sf)) = (w.outer_position(), w.outer_size(), w.scale_factor()) {
                let (cx, cy) = (p.x as f64 + s.width as f64 / 2.0, p.y as f64 + s.height as f64 / 2.0);
                let dist = ((c.x - cx).powi(2) + (c.y - cy).powi(2)).sqrt();
                if dist < 400.0 * sf {
                    delay = 33;
                }
                winmgr::emit_overlay(
                    &app,
                    "critter:cursor",
                    json!({
                        "x": c.x.round(), "y": c.y.round(),
                        "winX": p.x, "winY": p.y, "winW": s.width, "winH": s.height,
                    }),
                );
            }
        }
        thread::sleep(Duration::from_millis(delay));
    });
}

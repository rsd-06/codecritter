//! Peek mode: manual toggle (tray / shortcut via `set_peek`) + auto-detect of a fullscreen foreground
//! app. Windows: `SHQueryUserNotificationState` (QUNS 2/3/4 = fullscreen / D3D fullscreen /
//! presentation). Other OSes: no-op detector (manual peek only). While peeking the overlay is slid
//! with `winmgr::set_peek_position` so `PEEK_VISIBLE_FRACTION` of it stays on screen at the
//! configured edge; the pre-peek position is restored on unpeek and never persisted.

use crate::{state, store, winmgr};
use serde_json::Value;
use std::{sync::atomic::Ordering, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

/// Share of the overlay window left on screen while peeking (src/shared/constants.ts).
pub const PEEK_VISIBLE_FRACTION: f64 = 0.6;
const POLL_MS: u64 = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Bottom,
    Left,
    Right,
}

impl Edge {
    fn parse(v: &Value) -> Edge {
        match v.as_str() {
            Some("left") => Edge::Left,
            Some("right") => Edge::Right,
            _ => Edge::Bottom,
        }
    }
}

/// QUERY_USER_NOTIFICATION_STATE values that mean "a fullscreen app is in front":
/// 2 = BUSY (fullscreen), 3 = RUNNING_D3D_FULL_SCREEN, 4 = PRESENTATION_MODE.
pub fn is_fullscreen_state(quns: i32) -> bool {
    matches!(quns, 2..=4)
}

/// Pure: overlay top-left (physical px) that leaves `visible` of the window on screen at `edge` of
/// `display` (x, y, w, h). `win` is the pre-peek (x, y, w, h). Off-edge axis stays clamped to the display.
pub fn peek_position(
    win: (i32, i32, i32, i32),
    display: (i32, i32, i32, i32),
    edge: Edge,
    visible: f64,
) -> (i32, i32) {
    let (wx, wy, ww, wh) = win;
    let (dx, dy, dw, dh) = display;
    let clamp = |v: i32, lo: i32, hi: i32| v.min(hi).max(lo);
    match edge {
        Edge::Bottom => (
            clamp(wx, dx, dx + dw - ww),
            (dy as f64 + dh as f64 - wh as f64 * visible).round() as i32,
        ),
        Edge::Left => (
            (dx as f64 - (ww as f64 - ww as f64 * visible)).round() as i32,
            clamp(wy, dy, dy + dh - wh),
        ),
        Edge::Right => (
            (dx as f64 + dw as f64 - ww as f64 * visible).round() as i32,
            clamp(wy, dy, dy + dh - wh),
        ),
    }
}

/// Pure: what the auto detector should do on a poll. `Some(true)` = start peeking, `Some(false)` =
/// stop (only if auto caused the peek), `None` = nothing.
pub fn auto_action(fullscreen: bool, prev_fullscreen: bool, peeking: bool, auto_peeked: bool) -> Option<bool> {
    if fullscreen == prev_fullscreen {
        return None;
    }
    if fullscreen && !peeking {
        Some(true)
    } else if !fullscreen && auto_peeked {
        Some(false)
    } else {
        None
    }
}

#[cfg(windows)]
fn fullscreen_app_active() -> bool {
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    // SAFETY: plain Win32 query with no pointer arguments.
    unsafe { SHQueryUserNotificationState() }
        .map(|s| is_fullscreen_state(s.0))
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn fullscreen_app_active() -> bool {
    false
}

/// Move the overlay for the current peek state (call when peeking or the edge changed).
fn apply(app: &AppHandle) {
    let Some(w) = winmgr::overlay(app) else { return };
    let st = app.state::<state::AppState>();
    let Ok(size) = w.outer_size() else { return };
    // Pre-peek position: stored by set_peek_position while locked, else the live position.
    let home = if st.peek_locked.load(Ordering::Relaxed) {
        *st.peek_restore.lock()
    } else {
        None
    }
    .or_else(|| w.outer_position().ok().map(|p| (p.x, p.y)));
    let Some((hx, hy)) = home else { return };
    let (ww, wh) = (size.width as i32, size.height as i32);
    let (cx, cy) = (hx as f64 + ww as f64 / 2.0, hy as f64 + wh as f64 / 2.0);
    let mon = app
        .monitor_from_point(cx, cy)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = mon else { return };
    let (p, s) = (m.position(), m.size());
    let edge = Edge::parse(&store::get_ptr(app, "/peek/edge"));
    let pos = peek_position(
        (hx, hy, ww, wh),
        (p.x, p.y, s.width as i32, s.height as i32),
        edge,
        PEEK_VISIBLE_FRACTION,
    );
    winmgr::set_peek_position(app, Some(pos));
}

/// Turn peek on/off: slides the overlay, flips state, emits `critter:peek`, refreshes the tray.
pub fn set_peek(app: &AppHandle, on: bool) {
    let st = app.state::<state::AppState>();
    if st.peeking.swap(on, Ordering::Relaxed) == on {
        return;
    }
    if on {
        apply(app);
    } else {
        winmgr::set_peek_position(app, None);
    }
    let _ = app.emit("critter:peek", on);
    crate::tray::refresh(app);
}

/// Background loop: re-applies the position when the edge setting changes while peeking, and runs the
/// auto detector only while `settings.peek.auto` is on. Costs one tiny wakeup every 2 s.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut prev_fs = false;
        let mut auto_peeked = false;
        let mut applied_edge = Edge::parse(&store::get_ptr(&app, "/peek/edge"));
        loop {
            thread::sleep(Duration::from_millis(POLL_MS));
            let peeking = state::is_peeking(&app);
            if !peeking {
                auto_peeked = false;
            }
            let edge = Edge::parse(&store::get_ptr(&app, "/peek/edge"));
            if peeking && edge != applied_edge {
                apply(&app);
            }
            applied_edge = edge;

            if store::get_ptr(&app, "/peek/auto").as_bool().unwrap_or(false) {
                let fs = fullscreen_app_active();
                match auto_action(fs, prev_fs, peeking, auto_peeked) {
                    Some(true) => {
                        auto_peeked = true;
                        if std::env::var_os("CRITTER_DEBUG").is_some() {
                            eprintln!("[critter] peek ON (fullscreen app)");
                        }
                        set_peek(&app, true);
                    }
                    Some(false) => {
                        auto_peeked = false;
                        if std::env::var_os("CRITTER_DEBUG").is_some() {
                            eprintln!("[critter] peek off");
                        }
                        set_peek(&app, false);
                    }
                    None => {}
                }
                prev_fs = fs;
            } else {
                prev_fs = false;
                auto_peeked = false;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const D: (i32, i32, i32, i32) = (0, 0, 1920, 1080);

    #[test]
    fn quns_states_2_3_4_are_fullscreen() {
        for s in [2, 3, 4] {
            assert!(is_fullscreen_state(s), "{s}");
        }
        for s in [0, 1, 5, 6, 7] {
            assert!(!is_fullscreen_state(s), "{s}");
        }
    }

    #[test]
    fn bottom_edge_keeps_60_percent_visible_and_clamps_x() {
        let (x, y) = peek_position((1800, 500, 256, 224), D, Edge::Bottom, 0.6);
        assert_eq!(y, 1080 - (224.0f64 * 0.6).round() as i32);
        assert_eq!(x, 1920 - 256);
    }

    #[test]
    fn left_and_right_edges() {
        let (x, y) = peek_position((500, 2000, 256, 224), D, Edge::Left, 0.6);
        assert_eq!(x, -(256.0f64 * 0.4).round() as i32);
        assert_eq!(y, 1080 - 224);
        let (x, y) = peek_position((500, -50, 256, 224), D, Edge::Right, 0.6);
        assert_eq!(x, 1920 - (256.0f64 * 0.6).round() as i32);
        assert_eq!(y, 0);
    }

    #[test]
    fn secondary_monitor_offsets_are_respected() {
        let d2 = (1920, 0, 1920, 1080);
        let (x, _) = peek_position((2000, 100, 256, 224), d2, Edge::Left, 1.0);
        assert_eq!(x, 1920);
    }

    #[test]
    fn auto_action_only_on_change_and_only_undoes_own_peek() {
        assert_eq!(auto_action(true, false, false, false), Some(true));
        assert_eq!(auto_action(true, true, true, true), None);
        assert_eq!(auto_action(true, false, true, false), None); // already manually peeking
        assert_eq!(auto_action(false, true, true, true), Some(false));
        assert_eq!(auto_action(false, true, true, false), None); // manual peek stays
    }
}

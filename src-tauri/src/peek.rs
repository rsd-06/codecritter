//! Peek mode: manual toggle (tray / shortcut via `set_peek`) + auto-detect of a fullscreen foreground
//! app. Windows: `SHQueryUserNotificationState` (QUNS 2/3/4 = fullscreen / D3D fullscreen /
//! presentation) OR geometry: the foreground window (not ours, not the desktop/shell, visible, not
//! minimised) whose frame covers the whole monitor (rcMonitor, so a maximised window with a visible
//! taskbar never counts). The geometry check catches browser F11 fullscreen, which Firefox-family
//! browsers do not report through QUNS. No window titles or process names are ever read (only the
//! window class, to skip the shell, and the pid, to skip our own windows). Other OSes: no-op
//! detector (manual peek only). While peeking the overlay is slid with `winmgr::set_peek_position`
//! so `PEEK_VISIBLE_FRACTION` of it stays on screen at the configured edge; the pre-peek position
//! is restored on unpeek and never persisted.

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

/// Rectangle as (left, top, right, bottom), physical px.
pub type Rect = (i32, i32, i32, i32);

/// WS_BORDER | WS_DLGFRAME: both set = a title bar.
#[cfg(windows)]
const WS_CAPTION_BITS: u32 = 0x00C0_0000;

/// Allowed slack (px) between the window frame and the monitor rect.
pub const FULLSCREEN_TOLERANCE: i32 = 2;

/// Window classes of the desktop and the taskbars; never "fullscreen apps".
pub fn is_shell_class(class: &str) -> bool {
    matches!(class, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

/// Pure: does `frame` cover the whole `monitor` rect (within `tol` px on every side)?
pub fn covers_monitor(frame: Rect, monitor: Rect, tol: i32) -> bool {
    frame.0 <= monitor.0 + tol && frame.1 <= monitor.1 + tol && frame.2 >= monitor.2 - tol && frame.3 >= monitor.3 - tol
}

/// Facts about the foreground window, gathered by the OS layer.
#[derive(Clone, Copy, Debug)]
pub struct FgWindow {
    pub visible: bool,
    pub minimized: bool,
    pub ours: bool,
    pub shell: bool,
    /// Has a title bar (WS_CAPTION). Firefox-family and Chromium strip it in F11 fullscreen; a normally
    /// maximised window keeps it, which tells it apart when the taskbar auto-hides (maximised then also
    /// covers the whole monitor).
    pub captioned: bool,
    pub frame: Rect,
    /// Full monitor rect (rcMonitor) of the monitor the window is on.
    pub monitor: Rect,
}

/// Pure: if the foreground window is a fullscreen app, the monitor rect it fills.
pub fn fullscreen_monitor(w: &FgWindow) -> Option<Rect> {
    if !w.visible || w.minimized || w.ours || w.shell || w.captioned {
        return None;
    }
    covers_monitor(w.frame, w.monitor, FULLSCREEN_TOLERANCE).then_some(w.monitor)
}

/// Pure: the overall fullscreen verdict. QUNS busy/D3D/presentation counts globally; the geometry
/// signal only counts when it is on the overlay's monitor.
pub fn decide_fullscreen(quns: i32, fg: Option<&FgWindow>, overlay_monitor: Option<Rect>) -> bool {
    if is_fullscreen_state(quns) {
        return true;
    }
    match (fg.and_then(fullscreen_monitor), overlay_monitor) {
        (Some(m), Some(o)) => m == o,
        _ => false,
    }
}

#[cfg(windows)]
fn foreground_window() -> Option<FgWindow> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, GWL_STYLE,
    };
    // SAFETY: plain Win32 queries on the foreground HWND with correctly sized out-buffers.
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut buf = [0u16; 64];
        let n = GetClassNameW(hwnd, &mut buf).max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..n.min(buf.len())]);
        let mut r = RECT::default();
        let dwm_ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok();
        if !dwm_ok && GetWindowRect(hwnd, &mut r).is_err() {
            return None;
        }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            return None;
        }
        let m = mi.rcMonitor;
        Some(FgWindow {
            visible: IsWindowVisible(hwnd).as_bool(),
            minimized: IsIconic(hwnd).as_bool(),
            ours: pid == GetCurrentProcessId(),
            shell: is_shell_class(&class),
            captioned: (GetWindowLongW(hwnd, GWL_STYLE) as u32) & WS_CAPTION_BITS == WS_CAPTION_BITS,
            frame: (r.left, r.top, r.right, r.bottom),
            monitor: (m.left, m.top, m.right, m.bottom),
        })
    }
}

#[cfg(windows)]
fn quns_state() -> i32 {
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    // SAFETY: plain Win32 query with no pointer arguments.
    unsafe { SHQueryUserNotificationState() }.map(|s| s.0).unwrap_or(0)
}

/// rcMonitor-equivalent rect of the monitor under the overlay's centre.
#[cfg(windows)]
fn overlay_monitor_rect(app: &AppHandle) -> Option<Rect> {
    let w = winmgr::overlay(app)?;
    let (p, s) = (w.outer_position().ok()?, w.outer_size().ok()?);
    let (cx, cy) = (p.x as f64 + s.width as f64 / 2.0, p.y as f64 + s.height as f64 / 2.0);
    let m = app.monitor_from_point(cx, cy).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())?;
    let (mp, ms) = (m.position(), m.size());
    Some((mp.x, mp.y, mp.x + ms.width as i32, mp.y + ms.height as i32))
}

#[cfg(windows)]
fn fullscreen_app_active(app: &AppHandle) -> bool {
    let fg = foreground_window();
    let om = overlay_monitor_rect(app);
    let quns = quns_state();
    let verdict = decide_fullscreen(quns, fg.as_ref(), om);
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        eprintln!("[critter] peek poll: quns={quns} fg={fg:?} overlay_monitor={om:?} -> fullscreen={verdict}");
    }
    verdict
}

#[cfg(not(windows))]
fn fullscreen_app_active(_app: &AppHandle) -> bool {
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
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        eprintln!("[critter] peek {} (toggle)", if on { "ON" } else { "off" });
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
                let fs = fullscreen_app_active(&app);
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

    const MON: Rect = (0, 0, 1920, 1080);
    const MON2: Rect = (1920, 0, 3840, 1080);
    fn fg(frame: Rect, monitor: Rect) -> FgWindow {
        FgWindow { visible: true, minimized: false, ours: false, shell: false, captioned: false, frame, monitor }
    }

    #[test]
    fn browser_f11_fullscreen_counts() {
        assert_eq!(fullscreen_monitor(&fg(MON, MON)), Some(MON));
        assert!(fullscreen_monitor(&fg((-1, 0, 1921, 1081), MON)).is_some());
    }

    #[test]
    fn maximised_window_with_taskbar_does_not_count() {
        assert_eq!(fullscreen_monitor(&fg((0, 0, 1920, 1040), MON)), None);
        assert_eq!(fullscreen_monitor(&fg((8, 8, 1912, 1032), MON)), None);
    }

    #[test]
    fn maximised_window_with_autohide_taskbar_covers_the_monitor_but_keeps_its_title_bar() {
        let w = FgWindow { captioned: true, ..fg(MON, MON) };
        assert_eq!(fullscreen_monitor(&w), None);
        assert!(!decide_fullscreen(1, Some(&w), Some(MON)));
    }

    #[test]
    fn borderless_fullscreen_game_counts_even_with_overshoot() {
        assert!(fullscreen_monitor(&fg((-8, -8, 1928, 1088), MON)).is_some());
    }

    #[test]
    fn desktop_shell_own_hidden_minimised_never_count() {
        for f in [
            FgWindow { shell: true, ..fg(MON, MON) },
            FgWindow { ours: true, ..fg(MON, MON) },
            FgWindow { visible: false, ..fg(MON, MON) },
            FgWindow { minimized: true, ..fg(MON, MON) },
            FgWindow { captioned: true, ..fg(MON, MON) },
        ] {
            assert_eq!(fullscreen_monitor(&f), None);
        }
        for c in ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            assert!(is_shell_class(c));
        }
        assert!(!is_shell_class("MozillaWindowClass"));
    }

    #[test]
    fn only_same_monitor_as_overlay_counts() {
        let f = fg(MON2, MON2);
        assert!(!decide_fullscreen(1, Some(&f), Some(MON)));
        assert!(decide_fullscreen(1, Some(&f), Some(MON2)));
        assert!(!decide_fullscreen(1, Some(&f), None));
    }

    #[test]
    fn quns_alone_still_counts_and_nothing_means_no() {
        assert!(decide_fullscreen(3, None, Some(MON)));
        assert!(!decide_fullscreen(1, None, Some(MON)));
        assert!(!decide_fullscreen(1, Some(&fg((0, 0, 1920, 1040), MON)), Some(MON)));
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

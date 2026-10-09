//! (Named winmgr, not windows: that would shadow the `windows` crate.)
//! Overlay + settings windows: creation, positioning, dragging, scale, visibility, peek bounds.
//!
//! All coordinates handled here are PHYSICAL pixels (screen space). The overlay's logical size is
//! `128*scale x 112*scale` (the renderer's stage), multiplied by the monitor scale factor.
//! `settings.position` is `{displayId, x, y}` with physical x/y and displayId always 0 (Tauri has no
//! stable monitor ids); on restore the saved point is mapped to whichever monitor contains it.

use crate::state::{AppState, DragState};
use crate::store;
use serde::Serialize;
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const OVERLAY: &str = "overlay";
pub const SETTINGS: &str = "settings";
pub const STAGE_W: f64 = 128.0;
pub const STAGE_H: f64 = 112.0;

/// WebView2 browser args (shared by every window: the first-created environment wins). Keeps the
/// Chromium footprint small: no GPU process, one renderer, no background services. The first
/// `--disable-features` group is Tauri's own default and must be kept.
#[cfg(windows)]
const WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,Translate,MediaRouter,OptimizationHints,msEdgeShopping,msWebAssist,msEdgeRewards,AutofillServerCommunication,BackForwardCache,NetworkServiceSandbox,AudioServiceOutOfProcess --disable-gpu --in-process-gpu --disable-background-networking --disable-component-update --disable-breakpad --disable-site-isolation-trials --renderer-process-limit=1 --enable-low-end-device-mode --disable-extensions --no-pings --autoplay-policy=no-user-gesture-required --js-flags=--max-old-space-size=64,--lite-mode";

/// `WEBVIEW2_ARGS` plus dev-only extras from `CRITTER_WEBVIEW_EXTRA_ARGS` (e.g. `--remote-debugging-port=9333`).
/// WebView2 also honours its own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var; combining here keeps the
/// built-in flags (notably the autoplay policy the click-through overlay needs for sound) in every case.
#[cfg(windows)]
fn webview2_args() -> String {
    combine_args(WEBVIEW2_ARGS, std::env::var("CRITTER_WEBVIEW_EXTRA_ARGS").ok().as_deref())
}

#[cfg(any(windows, test))]
fn combine_args(base: &str, extra: Option<&str>) -> String {
    match extra.map(str::trim).filter(|e| !e.is_empty()) {
        Some(e) => format!("{base} {e}"),
        None => base.to_string(),
    }
}

/// Fixed WebView2 profile folder (`%LOCALAPPDATA%\<identifier>\webview`), shared by both windows.
/// Without it WebView2 would create `<exe>.WebView2` next to the executable (inside the install dir).
#[cfg(windows)]
fn webview_data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let d = app.path().app_local_data_dir();
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        eprintln!("[windows] webview data dir: {d:?}");
    }
    d.ok().map(|d| d.join("webview"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Clamp a window rect fully inside `area`.
pub fn clamp_rect(r: Rect, area: Rect) -> Rect {
    let max_x = area.x + (area.w - r.w).max(0);
    let max_y = area.y + (area.h - r.h).max(0);
    Rect { x: r.x.clamp(area.x, max_x), y: r.y.clamp(area.y, max_y), ..r }
}

/// Horizontal gap kept free right of the overlay (Windows leaves room for the tray clock), in
/// logical px (scaled by the caller).
pub fn default_margin(windows: bool) -> i32 {
    if windows {
        260
    } else {
        24
    }
}

/// Default spot: bottom of the work area, `margin` px from its right edge.
pub fn default_rect_for(work: Rect, size: (i32, i32), margin: i32) -> Rect {
    clamp_rect(
        Rect { x: work.x + work.w - size.0 - margin, y: work.y + work.h - size.1, w: size.0, h: size.1 },
        work,
    )
}

pub fn overlay_logical(scale: i64) -> (f64, f64) {
    ((STAGE_W * scale as f64).round(), (STAGE_H * scale as f64).round())
}

fn physical(logical: (f64, f64), sf: f64) -> (i32, i32) {
    ((logical.0 * sf).round() as i32, (logical.1 * sf).round() as i32)
}

fn work_rect(m: &Monitor) -> Rect {
    let a = m.work_area();
    Rect { x: a.position.x, y: a.position.y, w: a.size.width as i32, h: a.size.height as i32 }
}

fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<Monitor> {
    app.monitor_from_point(x, y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())
}

pub fn overlay(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY)
}

/// Emit an event to the overlay webview only (use `app.emit` to reach every window).
pub fn emit_overlay<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(OVERLAY, event, payload);
}

fn win_rect(w: &WebviewWindow) -> Option<Rect> {
    let p = w.outer_position().ok()?;
    let s = w.outer_size().ok()?;
    Some(Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 })
}

fn locked(app: &AppHandle) -> bool {
    app.state::<AppState>().peek_locked.load(Ordering::Relaxed)
}

pub fn persist_position(app: &AppHandle) {
    if locked(app) {
        return;
    }
    let Some(r) = overlay(app).and_then(|w| win_rect(&w)) else { return };
    let cur = store::get_ptr(app, "/position");
    if cur.get("x").and_then(|v| v.as_i64()) == Some(r.x as i64)
        && cur.get("y").and_then(|v| v.as_i64()) == Some(r.y as i64)
    {
        return;
    }
    store::update(app, json!({ "position": { "displayId": 0, "x": r.x, "y": r.y } }));
}

pub fn create_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let scale = store::scale(app);
    let (lw, lh) = overlay_logical(scale);

    let saved = store::get_ptr(app, "/position");
    let saved_xy = saved.get("x").and_then(|v| v.as_f64()).zip(saved.get("y").and_then(|v| v.as_f64()));
    let monitor = match saved_xy {
        Some((x, y)) => monitor_at(app, x, y),
        None => app.primary_monitor().ok().flatten(),
    };
    let rect = monitor.as_ref().map(|m| {
        let sf = m.scale_factor();
        let size = physical((lw, lh), sf);
        let work = work_rect(m);
        match saved_xy {
            Some((x, y)) => clamp_rect(Rect { x: x as i32, y: y as i32, w: size.0, h: size.1 }, work),
            None => {
                let margin = (default_margin(cfg!(windows)) as f64 * sf).round() as i32;
                default_rect_for(work, size, margin)
            }
        }
    });

    let mut b = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay/index.html".into()))
        .title("CodeCritter")
        .inner_size(lw, lh)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .visible_on_all_workspaces(true)
        .visible(false);
    if let Some(r) = rect {
        b = b.position(r.x as f64, r.y as f64);
    }
    #[cfg(windows)]
    {
        b = b.additional_browser_args(&webview2_args());
        if let Some(d) = webview_data_dir(app) {
            b = b.data_directory(d);
        }
    }
    let win = b.build()?;
    #[cfg(target_os = "linux")]
    crate::platform::linux::tune_webview(&win);
    if let Some(r) = rect {
        let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
    }
    let _ = win.set_ignore_cursor_events(true);
    if !crate::state::is_hidden(app) {
        let _ = win.show();
    }
    Ok(win)
}

/// Scale change keeps the bottom-centre of the overlay anchored.
pub fn apply_scale(app: &AppHandle, scale: i64) {
    let Some(w) = overlay(app) else { return };
    let Some(old) = win_rect(&w) else { return };
    let sf = w.scale_factor().unwrap_or(1.0);
    let (nw, nh) = physical(overlay_logical(scale), sf);
    let mut next = Rect { x: old.x + (old.w - nw) / 2, y: old.y + old.h - nh, w: nw, h: nh };
    if !locked(app) {
        if let Some(m) = monitor_at(app, (old.x + old.w / 2) as f64, (old.y + old.h / 2) as f64) {
            next = clamp_rect(next, work_rect(&m));
        }
    }
    let (lw, lh) = overlay_logical(scale);
    let _ = w.set_size(LogicalSize::new(lw, lh));
    let _ = w.set_position(PhysicalPosition::new(next.x, next.y));
    persist_position(app);
}

/* ---- display changes ---- */

/// Re-fit the overlay after a monitor was removed / moved / changed DPI: the window is clamped into
/// the work area of the monitor under its centre (or the primary monitor when that one is gone), and
/// resized for the new scale factor. Skipped while peeking (the off-screen peek position is intended).
pub fn reclamp_overlay(app: &AppHandle) {
    if locked(app) || app.state::<AppState>().drag.lock().is_some() {
        return;
    }
    let Some(w) = overlay(app) else { return };
    let Some(r) = win_rect(&w) else { return };
    let Some(m) = monitor_at(app, (r.x + r.w / 2) as f64, (r.y + r.h / 2) as f64) else { return };
    let (lw, lh) = overlay_logical(store::scale(app));
    let (nw, nh) = physical((lw, lh), m.scale_factor());
    let target = clamp_rect(Rect { x: r.x, y: r.y, w: nw, h: nh }, work_rect(&m));
    if (nw, nh) != (r.w, r.h) {
        let _ = w.set_size(LogicalSize::new(lw, lh));
    }
    if (target.x, target.y) != (r.x, r.y) {
        let _ = w.set_position(PhysicalPosition::new(target.x, target.y));
        persist_position(app);
    }
}

/// Cheap fingerprint of the monitor layout (position, size, scale of every monitor).
fn monitor_signature(app: &AppHandle) -> Vec<(i32, i32, u32, u32, i64)> {
    let mut v: Vec<_> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            (p.x, p.y, s.width, s.height, (m.scale_factor() * 100.0).round() as i64)
        })
        .collect();
    v.sort_unstable();
    v
}

/// Tauri has no display-removed event, so a 3 s watcher compares the monitor fingerprint and
/// re-clamps the overlay when it changes (also reacts to taskbar / work-area changes via the
/// overlay's own moved/scale events registered in `lib.rs`).
pub fn watch_displays(app: AppHandle) {
    std::thread::Builder::new()
        .name("display-watch".into())
        .spawn(move || {
            let mut last = monitor_signature(&app);
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let now = monitor_signature(&app);
                if now != last && !now.is_empty() {
                    last = now;
                    reclamp_overlay(&app);
                }
            }
        })
        .ok();
}

/* ---- commands: click-through + drag ---- */

pub fn set_interactive(app: &AppHandle, on: bool) {
    if let Some(w) = overlay(app) {
        let _ = w.set_ignore_cursor_events(!on);
    }
}

pub fn drag_start(app: &AppHandle) {
    let Some(w) = overlay(app) else { return };
    let (Ok(c), Ok(p)) = (app.cursor_position(), w.outer_position()) else { return };
    *app.state::<AppState>().drag.lock() =
        Some(DragState { cursor: (c.x, c.y), origin: (p.x, p.y) });
}

/// Moves by the global cursor delta since `drag_start` (the renderer's dx/dy are ignored: the
/// screen-cursor delta is jitter-free and DPI-correct).
pub fn drag_move(app: &AppHandle) {
    let Some(d) = *app.state::<AppState>().drag.lock() else { return };
    let (Some(w), Ok(c)) = (overlay(app), app.cursor_position()) else { return };
    let Some(r) = win_rect(&w) else { return };
    let mut target = Rect {
        x: d.origin.0 + (c.x - d.cursor.0).round() as i32,
        y: d.origin.1 + (c.y - d.cursor.1).round() as i32,
        ..r
    };
    if let Some(m) = monitor_at(app, c.x, c.y) {
        target = clamp_rect(target, work_rect(&m));
    }
    let _ = w.set_position(PhysicalPosition::new(target.x, target.y));
}

pub fn drag_end(app: &AppHandle) {
    let was = app.state::<AppState>().drag.lock().take();
    if was.is_some() {
        persist_position(app);
    }
}

/* ---- visibility ---- */

pub fn set_companion_visible(app: &AppHandle, visible: bool) {
    app.state::<AppState>().hidden.store(!visible, Ordering::Relaxed);
    if let Some(w) = overlay(app) {
        let _ = if visible { w.show() } else { w.hide() };
    }
    crate::tray::refresh(app);
}

pub fn toggle_companion_visible(app: &AppHandle) {
    set_companion_visible(app, crate::state::is_hidden(app));
}

/* ---- peek (T2a drives these from peek.rs) ---- */

/// Move the overlay (possibly partly off-screen) without clamping or persisting. `None` ends the
/// peek and restores the pre-peek position clamped to its monitor.
#[allow(dead_code)] // used by T2a (peek.rs)
pub fn set_peek_position(app: &AppHandle, pos: Option<(i32, i32)>) {
    let Some(w) = overlay(app) else { return };
    let st = app.state::<AppState>();
    match pos {
        Some((x, y)) => {
            if !st.peek_locked.swap(true, Ordering::Relaxed) {
                if let Ok(p) = w.outer_position() {
                    *st.peek_restore.lock() = Some((p.x, p.y));
                }
            }
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
        None => {
            st.peek_locked.store(false, Ordering::Relaxed);
            let restore = st.peek_restore.lock().take();
            if let (Some((x, y)), Some(r)) = (restore, win_rect(&w)) {
                let mut t = Rect { x, y, ..r };
                if let Some(m) = monitor_at(app, x as f64, y as f64) {
                    t = clamp_rect(t, work_rect(&m));
                }
                let _ = w.set_position(PhysicalPosition::new(t.x, t.y));
            }
        }
    }
}

/* ---- settings window ---- */

/// Created lazily, destroyed on close (releases its webview memory while idling in the tray).
pub fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let b = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings/index.html".into()))
        .title("CodeCritter Settings")
        .inner_size(900.0, 640.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .visible(true);
    #[cfg(windows)]
    let b = {
        let b = b.additional_browser_args(&webview2_args());
        match webview_data_dir(app) {
            Some(d) => b.data_directory(d),
            None => b,
        }
    };
    let built = b.build();
    match built {
        Ok(w) => {
            #[cfg(target_os = "linux")]
            crate::platform::linux::tune_webview(&w);
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[windows] settings window: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { x: 0, y: 0, w: 1920, h: 1040 };

    #[test]
    #[cfg(windows)]
    fn webview_args_allow_autoplay_and_combine_dev_extras() {
        // the click-through overlay never gets a user gesture: without this flag its AudioContext stays suspended
        assert!(WEBVIEW2_ARGS.contains("--autoplay-policy=no-user-gesture-required"));
        assert!(WEBVIEW2_ARGS.contains("--disable-features="));
        let both = combine_args(WEBVIEW2_ARGS, Some(" --remote-debugging-port=9333 "));
        assert!(both.starts_with(WEBVIEW2_ARGS) && both.ends_with("--remote-debugging-port=9333"));
        assert_eq!(combine_args(WEBVIEW2_ARGS, Some("")), WEBVIEW2_ARGS);
        assert_eq!(combine_args(WEBVIEW2_ARGS, None), WEBVIEW2_ARGS);
    }

    #[test]
    fn clamp_inside() {
        let r = clamp_rect(Rect { x: -50, y: 2000, w: 256, h: 224 }, WORK);
        assert_eq!((r.x, r.y), (0, 1040 - 224));
        let r = clamp_rect(Rect { x: 1900, y: 5, w: 256, h: 224 }, WORK);
        assert_eq!((r.x, r.y), (1920 - 256, 5));
    }

    #[test]
    fn default_spot_windows_and_other() {
        let r = default_rect_for(WORK, (256, 224), default_margin(true));
        assert_eq!((r.x, r.y), (1920 - 256 - 260, 1040 - 224));
        let r = default_rect_for(WORK, (256, 224), default_margin(false));
        assert_eq!(r.x, 1920 - 256 - 24);
    }

    #[test]
    fn logical_size_follows_scale() {
        assert_eq!(overlay_logical(1), (128.0, 112.0));
        assert_eq!(overlay_logical(4), (512.0, 448.0));
    }
}

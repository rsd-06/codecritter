//! T2a owns this file. Peek mode: manual toggle + auto-detect fullscreen foreground app.
//! Windows: `SHQueryUserNotificationState` (windows crate, feature Win32_UI_Shell) — peek on QUNS 2/3/4.
//! Position the overlay with `crate::winmgr::set_peek_position(app, Some((x, y)))` (physical px, the
//! overlay may be partly off-screen; the visible share is `PEEK_VISIBLE_FRACTION` = 0.6 of the window)
//! and `None` to restore. The edge comes from `store::get_ptr(app, "/peek/edge")`.

use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

/// Start the auto-detect loop. T1 stub: no-op.
pub fn start(_app: AppHandle) {}

/// Turn peek on/off. T1 behaviour: flips state, notifies the overlay (`critter:peek`) and the tray;
/// T2a adds the window sliding.
pub fn set_peek(app: &AppHandle, on: bool) {
    let st = app.state::<AppState>();
    if st.peeking.swap(on, Ordering::Relaxed) == on {
        return;
    }
    let _ = app.emit("critter:peek", on);
    crate::tray::refresh(app);
}

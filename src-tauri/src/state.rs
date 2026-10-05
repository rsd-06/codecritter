//! Shared runtime state, registered with `app.manage(AppState::default())`.
//! Access from anywhere with `app.state::<AppState>()`.

use parking_lot::{Mutex, RwLock};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Default)]
pub struct DragState {
    /// Global cursor position (physical px) when the drag began.
    pub cursor: (f64, f64),
    /// Overlay outer position (physical px) when the drag began.
    pub origin: (i32, i32),
}

#[derive(Default)]
pub struct AppState {
    /// Current settings (camelCase JSON, identical to the TS `Settings` type).
    pub settings: RwLock<Value>,
    /// "Pause reactions" tray toggle: the input stream stops (cursor stays on for hit-testing).
    pub reactions_paused: AtomicBool,
    /// Peek mode (overlay slid to the screen edge).
    pub peeking: AtomicBool,
    /// User hid the companion (tray / shortcut).
    pub hidden: AtomicBool,
    /// While peeking the overlay position must not be clamped or persisted.
    pub peek_locked: AtomicBool,
    pub drag: Mutex<Option<DragState>>,
    /// Pre-peek overlay position (physical px) restored when peek ends.
    #[allow(dead_code)] // used by winmgr::set_peek_position (T2a)
    pub peek_restore: Mutex<Option<(i32, i32)>>,
}

pub fn is_paused(app: &AppHandle) -> bool {
    app.state::<AppState>().reactions_paused.load(Ordering::Relaxed)
}

pub fn set_paused(app: &AppHandle, v: bool) {
    app.state::<AppState>().reactions_paused.store(v, Ordering::Relaxed);
    crate::tray::refresh(app);
}

pub fn is_peeking(app: &AppHandle) -> bool {
    app.state::<AppState>().peeking.load(Ordering::Relaxed)
}

pub fn is_hidden(app: &AppHandle) -> bool {
    app.state::<AppState>().hidden.load(Ordering::Relaxed)
}

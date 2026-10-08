//! Overlay window behaviour AppKit needs beyond what Tauri sets: visible on every Space and over
//! fullscreen apps, above normal floating windows, no shadow, never hidden when the app deactivates.
//! (Transparency comes from `macOSPrivateApi`; click-through from `set_ignore_cursor_events`.)

use crate::winmgr;
use objc2::{msg_send, runtime::{AnyObject, Bool}};
use std::{thread, time::Duration};
use tauri::AppHandle;

// NSWindowCollectionBehavior bits
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
pub const BEHAVIOR: usize = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;
/// NSStatusWindowLevel: above floating palettes and fullscreen-app windows, below menus and the screen saver.
pub const LEVEL: isize = 25;

fn apply(app: &AppHandle) {
    let Some(w) = winmgr::overlay(app) else { return };
    let w2 = w.clone();
    let _ = w.run_on_main_thread(move || {
        let Ok(ptr) = w2.ns_window() else { return };
        let win = ptr as *mut AnyObject;
        if win.is_null() {
            return;
        }
        // SAFETY: `win` is the live NSWindow backing the overlay and we are on the main thread; every
        // selector is a documented NSWindow setter whose argument type matches the Rust value.
        unsafe {
            let cur: usize = msg_send![win, collectionBehavior];
            let _: () = msg_send![win, setCollectionBehavior: cur | BEHAVIOR];
            let _: () = msg_send![win, setLevel: LEVEL];
            let _: () = msg_send![win, setHasShadow: Bool::NO];
            let _: () = msg_send![win, setHidesOnDeactivate: Bool::NO];
            let _: () = msg_send![win, setCanHide: Bool::NO];
        }
    });
}

pub fn start(app: &AppHandle) {
    apply(app);
    // tao may touch the window level / behaviour again once it is shown; re-assert shortly after.
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1500));
        apply(&app);
    });
}

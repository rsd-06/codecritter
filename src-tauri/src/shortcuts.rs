//! Global shortcuts: Ctrl/Cmd+Alt+P (peek), H (hide/show), S (settings).

use crate::{peek, state, winmgr};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register(app: &AppHandle) {
    let bind = |accel: &'static str, f: fn(&AppHandle)| {
        let r = app.global_shortcut().on_shortcut(accel, move |app, _sc, ev| {
            if ev.state == ShortcutState::Pressed {
                f(app);
            }
        });
        if let Err(e) = r {
            eprintln!("[shortcuts] could not register {accel}: {e}");
        }
    };
    bind("CommandOrControl+Alt+P", |a| peek::set_peek(a, !state::is_peeking(a)));
    bind("CommandOrControl+Alt+H", winmgr::toggle_companion_visible);
    bind("CommandOrControl+Alt+S", winmgr::open_settings);
}

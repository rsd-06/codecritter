//! Debug-build only: `CRITTER_SELFTEST=1 codecritter.exe` drives the tray/context-menu handlers, the
//! drag commands and the display re-clamp from inside the process and prints PASS/FAIL lines to
//! stderr, then exits (code 0 = all passed). Global shortcuts are exercised from outside with
//! SendInput (see MEMORY.md). Never compiled into release builds.

use crate::{scheduler, state, store, tray, winmgr};
use serde_json::json;
use std::{thread, time::Duration};
use tauri::{AppHandle, Manager, PhysicalPosition};

pub fn maybe_start(app: AppHandle) {
    if std::env::var_os("CRITTER_SELFTEST").is_none() {
        return;
    }
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        let mut fails = 0;
        let mut check = |name: &str, ok: bool| {
            eprintln!("[selftest] {} {}", if ok { "PASS" } else { "FAIL" }, name);
            if !ok {
                fails += 1;
            }
        };
        let pause = || thread::sleep(Duration::from_millis(250));

        // character switch
        tray::handle_menu_id(&app, "char:yoda");
        check("menu char:yoda", store::get_ptr(&app, "/character") == json!("yoda"));
        tray::handle_menu_id(&app, "char:stitch");
        check("menu char:stitch", store::get_ptr(&app, "/character") == json!("stitch"));

        // pomodoro start / pause / resume / skip / stop
        tray::handle_menu_id(&app, "pomo:start");
        let phase = |app: &AppHandle| scheduler::pomodoro_state(app);
        check("pomo start -> focus", phase(&app)["phase"] == json!("focus"));
        tray::handle_menu_id(&app, "pomo:pause");
        check("pomo pause", phase(&app)["paused"] == json!(true));
        tray::handle_menu_id(&app, "pomo:resume");
        check("pomo resume", phase(&app)["paused"] == json!(false));
        tray::handle_menu_id(&app, "pomo:skip");
        check("pomo skip -> break", phase(&app)["phase"] == json!("break"));
        tray::handle_menu_id(&app, "pomo:stop");
        check("pomo stop -> idle", phase(&app)["phase"] == json!("idle"));

        // peek / pause reactions / mute / hide-show
        tray::handle_menu_id(&app, "peek");
        pause();
        check("peek on", state::is_peeking(&app));
        tray::handle_menu_id(&app, "peek");
        pause();
        check("peek off", !state::is_peeking(&app));
        tray::handle_menu_id(&app, "pause");
        check("pause reactions on", state::is_paused(&app));
        tray::handle_menu_id(&app, "pause");
        check("pause reactions off", !state::is_paused(&app));
        let before = store::get_ptr(&app, "/sound/enabled");
        tray::handle_menu_id(&app, "mute");
        check("mute flips sound.enabled", store::get_ptr(&app, "/sound/enabled") != before);
        tray::handle_menu_id(&app, "mute");
        check("mute restores", store::get_ptr(&app, "/sound/enabled") == before);
        let visible = |app: &AppHandle| winmgr::overlay(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
        check("overlay visible at start", visible(&app));
        tray::handle_menu_id(&app, "hide");
        pause();
        check("hide", !visible(&app) && state::is_hidden(&app));
        tray::handle_menu_id(&app, "hide");
        pause();
        check("show", visible(&app) && !state::is_hidden(&app));

        // settings window + menu build (used by tray and right-click popup)
        tray::handle_menu_id(&app, "settings");
        thread::sleep(Duration::from_millis(1200));
        let sw = app.get_webview_window(winmgr::SETTINGS);
        check("settings window opens", sw.is_some());
        if let Some(w) = sw {
            let _ = w.destroy();
        }
        check("context/tray menu builds", tray::build_menu(&app).is_ok());

        // drag: cursor delta moves the overlay, position persisted on drag_end
        if let Some(w) = winmgr::overlay(&app) {
            let p0 = w.outer_position().unwrap();
            if let Ok(c) = app.cursor_position() {
                winmgr::drag_start(&app);
                set_cursor((c.x - 120.0) as i32, (c.y - 60.0) as i32);
                thread::sleep(Duration::from_millis(80));
                winmgr::drag_move(&app);
                winmgr::drag_end(&app);
                let p1 = w.outer_position().unwrap();
                check("drag moves overlay", p1.x != p0.x || p1.y != p0.y);
                let saved = store::get_ptr(&app, "/position");
                check(
                    "drag persists position",
                    saved["x"].as_i64() == Some(p1.x as i64) && saved["y"].as_i64() == Some(p1.y as i64),
                );
            } else {
                check("cursor_position available", false);
            }

            // display-removed re-clamp: park the window far off-screen, then re-clamp
            let _ = w.set_position(PhysicalPosition::new(-9000, -9000));
            winmgr::reclamp_overlay(&app);
            let p = w.outer_position().unwrap();
            let on = app
                .monitor_from_point((p.x + 10) as f64, (p.y + 10) as f64)
                .ok()
                .flatten()
                .is_some();
            check("reclamp pulls off-screen overlay back", on);
        }

        eprintln!("[selftest] done, {fails} failure(s)");
        app.exit(if fails == 0 { 0 } else { 1 });
    });
}

#[cfg(windows)]
fn set_cursor(x: i32, y: i32) {
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y);
    }
}

#[cfg(not(windows))]
fn set_cursor(_x: i32, _y: i32) {}

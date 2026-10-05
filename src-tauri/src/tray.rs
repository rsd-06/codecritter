//! System tray + the shared menu (tray and overlay right-click use the same builder).

use crate::{peek, scheduler, state, store, winmgr};
use serde_json::json;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Wry,
};

const TRAY_ID: &str = "main";

fn icon_bytes(character: &str) -> &'static [u8] {
    macro_rules! icons {
        ($c:literal) => {{
            #[cfg(target_os = "macos")]
            {
                include_bytes!(concat!("../../resources/tray/", $c, "Template.png")).as_slice()
            }
            #[cfg(target_os = "windows")]
            {
                include_bytes!(concat!("../../resources/tray/", $c, "-16@2x.png")).as_slice()
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                include_bytes!(concat!("../../resources/tray/", $c, "-32.png")).as_slice()
            }
        }};
    }
    if character == "yoda" {
        icons!("yoda")
    } else {
        icons!("stitch")
    }
}

fn icon_for(app: &AppHandle) -> Option<Image<'static>> {
    let c = store::get_ptr(app, "/character");
    Image::from_bytes(icon_bytes(c.as_str().unwrap_or("stitch"))).ok()
}

/// Same entries as the Electron tray. Item ids are handled in `on_menu_event`.
pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let character = store::get_ptr(app, "/character");
    let character = character.as_str().unwrap_or("stitch");
    let muted = !store::get_ptr(app, "/sound/enabled").as_bool().unwrap_or(true);

    let header = MenuItem::with_id(app, "hdr", "Character", false, None::<&str>)?;
    let stitch = CheckMenuItem::with_id(app, "char:stitch", "Stitch", true, character == "stitch", None::<&str>)?;
    let yoda = CheckMenuItem::with_id(app, "char:yoda", "Yoda", true, character == "yoda", None::<&str>)?;
    let pomodoro = Submenu::with_items(
        app,
        "Pomodoro",
        true,
        &[
            &MenuItem::with_id(app, "pomo:start", "Start", true, None::<&str>)?,
            &MenuItem::with_id(app, "pomo:pause", "Pause", true, None::<&str>)?,
            &MenuItem::with_id(app, "pomo:resume", "Resume", true, None::<&str>)?,
            &MenuItem::with_id(app, "pomo:skip", "Skip phase", true, None::<&str>)?,
            &MenuItem::with_id(app, "pomo:stop", "Stop", true, None::<&str>)?,
        ],
    )?;
    let peek_i = CheckMenuItem::with_id(app, "peek", "Peek mode", true, state::is_peeking(app), None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause reactions", true, state::is_paused(app), None::<&str>)?;
    let mute = CheckMenuItem::with_id(app, "mute", "Mute", true, muted, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide / show companion", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings\u{2026}", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit CodeCritter", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let (s1, s2) = (sep()?, sep()?);
    Menu::with_items(
        app,
        &[&header, &stitch, &yoda, &s1, &pomodoro, &peek_i, &pause, &mute, &hide, &s2, &settings, &quit],
    )
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "char:stitch" => drop(store::update(app, json!({ "character": "stitch" }))),
        "char:yoda" => drop(store::update(app, json!({ "character": "yoda" }))),
        id if id.starts_with("pomo:") => {
            scheduler::pomodoro_cmd(app, &id["pomo:".len()..]);
        }
        "peek" => peek::set_peek(app, !state::is_peeking(app)),
        "pause" => state::set_paused(app, !state::is_paused(app)),
        "mute" => {
            let on = store::get_ptr(app, "/sound/enabled").as_bool().unwrap_or(true);
            store::update(app, json!({ "sound": { "enabled": !on } }));
        }
        "hide" => winmgr::toggle_companion_visible(app),
        "settings" => winmgr::open_settings(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Rebuild the tray menu and icon (call after any state the menu shows has changed).
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    if let Some(img) = icon_for(app) {
        let _ = tray.set_icon(Some(img));
        #[cfg(target_os = "macos")]
        let _ = tray.set_icon_as_template(true);
    }
}

/// Native popup for the overlay's right-click (`show_context_menu` command).
pub fn popup_menu(app: &AppHandle) {
    if let (Some(w), Ok(menu)) = (winmgr::overlay(app), build_menu(app)) {
        let _ = w.popup_menu(&menu);
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    app.on_menu_event(on_menu_event);
    let mut b = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("CodeCritter")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                winmgr::open_settings(tray.app_handle());
            }
        });
    if let Some(img) = icon_for(app) {
        b = b.icon(img);
    }
    #[cfg(target_os = "macos")]
    {
        b = b.icon_as_template(true);
    }
    b.build(app)
}

//! CodeCritter Tauri shell. `run()` owns the module wiring; T2 agents fill module bodies only.

mod autostart;
mod commands;
mod state;
mod store;
mod tray;
mod winmgr;
mod shortcuts;

pub mod agents;
pub mod cursor;
pub mod input;
pub mod peek;
pub mod scheduler;
pub mod sync;

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Second launch just opens the settings window.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            winmgr::open_settings(app);
        }));
    }

    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::set_interactive,
            commands::drag_start,
            commands::drag_move,
            commands::drag_end,
            commands::open_settings,
            commands::show_context_menu,
            commands::pomodoro_cmd,
            commands::pomodoro_state,
            commands::agent_status,
            commands::install_agent,
            commands::uninstall_agent,
            commands::test_event,
            commands::test_reminder,
            commands::export_settings,
            commands::import_settings,
            commands::open_external,
            commands::rebroadcast_settings,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            store::init(&handle);
            winmgr::create_overlay(&handle)?;
            tray::create(&handle)?;
            shortcuts::register(&handle);
            autostart::init(&handle);

            input::start(handle.clone());
            cursor::start(handle.clone());
            peek::start(handle.clone());
            agents::start(handle.clone());
            scheduler::start(handle.clone());
            sync::start(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building CodeCritter")
        .run(|_app, event| {
            // Tray app: closing the settings window must not quit.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

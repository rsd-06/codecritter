//! Per-OS glue that does not belong in the shared modules. Only `macos` exists today (the Linux
//! port lives in its own branch). The macOS module is always compiled so its pure decision functions
//! are unit-tested on every OS; only the FFI inside it is `#[cfg(target_os = "macos")]`.

pub mod macos;

/// State of the permission the global input listener needs: "granted", "denied", or "not-needed"
/// (Windows / Linux). Cheap; safe to call from any thread.
pub fn input_access() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        macos::access::state().as_str()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "not-needed"
    }
}

/// Opens the OS pane where the user grants input access (macOS: Privacy & Security > Input Monitoring).
pub fn open_input_access_settings() {
    #[cfg(target_os = "macos")]
    macos::access::open_settings();
}

/// Called once from `setup` after the overlay exists.
#[allow(unused_variables)]
pub fn start(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::overlay::start(app);
}

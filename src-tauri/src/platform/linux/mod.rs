//! Linux specifics: session detection (X11 / Wayland), X11 fullscreen probe, XDG autostart, install
//! kind (AppImage vs distro package), one-time hints and the optional evdev input backend.

pub mod autostart;
#[cfg(feature = "evdev")]
pub mod evdev;
pub mod fullscreen;
pub mod hints;
pub mod install;
pub mod session;

use tauri::WebviewWindow;

/// Call first thing in `run()`, before GTK / WebKit initialise (they read these variables once).
pub fn early_init() {
    let env = session::Env::from_process();
    if session::should_force_x11(&env) {
        // Native Wayland cannot position windows, keep them on top or report the global cursor; XWayland can.
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // WebKitGTK's DMA-BUF renderer shows a blank / glitchy transparent window on several GPU stacks
    // (notably NVIDIA); the 64x64 pixel canvas does not need it.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// WebKitGTK blocks media without a user gesture; the click-through overlay never gets one, so sounds
/// (HTMLAudio / WebAudio) would stay silent. Lift that restriction for our own webviews.
pub fn tune_webview(win: &WebviewWindow) {
    let _ = win.with_webview(|wv| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(s) = WebViewExt::settings(&wv.inner()) {
            s.set_media_playback_requires_user_gesture(false);
        }
    });
}

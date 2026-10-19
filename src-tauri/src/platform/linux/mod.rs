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

/// The WebKitGTK environment variable that turns the DMA-BUF renderer off.
pub const DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Should CodeCritter turn the WebKitGTK DMA-BUF renderer off?
///
/// Measured on this project's reference host (Ubuntu 22.04, GNOME, X11, WebKitGTK 2.50.4, hybrid
/// Intel UHD + RTX 2050) by watching which render node the `WebKitWebProcess` actually opens:
///
/// | `WEBKIT_DISABLE_DMABUF_RENDERER` | render node in use | overlay |
/// |---|---|---|
/// | unset -> CodeCritter sets `1` | `/dev/dri/renderD129` (NVIDIA) | renders |
/// | `1`                                | `/dev/dri/renderD129` (NVIDIA) | renders |
/// | `0` (DMA-BUF on)                   | `/dev/dri/renderD128` (Intel)   | renders |
///
/// So the workaround is *not* required on that combination, and the two paths even use different
/// GPUs. It stays on anyway: the blank / glitchy transparent surface it exists to avoid could not be
/// reproduced here, and it is reported on other NVIDIA + WebKitGTK stacks. Notably, this table also
/// shows why GPU detection is not a usable gate — on a hybrid laptop `nvidia-smi` being present says
/// nothing about which adapter WebKitGTK ends up rendering on. Narrowing this to "only when NVIDIA"
/// would therefore risk reintroducing the bug on exactly the hybrid configurations that are hard to
/// test, in exchange for a performance cost nobody has measured. Intel/AMD-only machines: NOT
/// VERIFIED, no hardware available.
///
/// The user's own value always wins, which is the documented escape hatch: export
/// `WEBKIT_DISABLE_DMABUF_RENDERER=0` to try the DMA-BUF path (a real way to diagnose a blank window).
pub fn should_disable_dmabuf(current: Option<&std::ffi::OsStr>) -> bool {
    current.is_none()
}

/// Call first thing in `run()`, before GTK / WebKit initialise (they read these variables once).
pub fn early_init() {
    let env = session::Env::from_process();
    if session::should_force_x11(&env) {
        // Native Wayland cannot position windows, keep them on top or report the global cursor; XWayland can.
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // WebKitGTK's DMA-BUF renderer shows a blank / glitchy transparent window on several GPU stacks
    // (notably NVIDIA); the 64x64 pixel canvas does not need it.
    let current = std::env::var_os(DMABUF_ENV);
    if should_disable_dmabuf(current.as_deref()) {
        std::env::set_var(DMABUF_ENV, "1");
    }
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        let kept = current.is_some();
        let why = if kept { "kept" } else { "defaulted" };
        let val = |k: &str| std::env::var(k).unwrap_or_else(|_| "<unset>".into());
        eprintln!(
            "[linux] {DMABUF_ENV}={} ({why}), GDK_BACKEND={}",
            val(DMABUF_ENV),
            val("GDK_BACKEND"),
        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn dmabuf_is_disabled_by_default() {
        assert!(should_disable_dmabuf(None));
    }

    #[test]
    fn the_users_own_value_always_wins() {
        // The documented escape hatch: `WEBKIT_DISABLE_DMABUF_RENDERER=0` opts back into DMA-BUF, and
        // any other explicit value (even an empty one) is left exactly as the user set it.
        assert!(!should_disable_dmabuf(Some(OsStr::new("0"))));
        assert!(!should_disable_dmabuf(Some(OsStr::new("1"))));
        assert!(!should_disable_dmabuf(Some(OsStr::new(""))));
        assert!(!should_disable_dmabuf(Some(OsStr::new("maybe"))));
    }

    #[test]
    fn the_variable_name_is_the_one_webkit_reads() {
        assert_eq!(DMABUF_ENV, "WEBKIT_DISABLE_DMABUF_RENDERER");
    }
}

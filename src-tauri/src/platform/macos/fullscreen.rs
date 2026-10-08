//! Fullscreen-app detection on macOS. Only window BOUNDS, LAYER, ALPHA and OWNER PID are read from
//! `CGWindowListCopyWindowInfo` (no window names / titles, so no Screen Recording permission is needed).
//!
//! A fullscreen Space (green button, F11 in browsers, games, video players) shows one layer-0 window
//! covering the whole display including the menu-bar strip. A zoomed / maximised window always leaves
//! the menu bar uncovered (menu bar auto-hide is the one blind spot: a zoomed window then also
//! covers the display; with the menu bar hidden we accept the false positive, peek is only a hint).
//! All coordinates are CoreGraphics global points (origin = top-left of the main display).

/// (x, y, width, height) in points.
pub type Rect = (f64, f64, f64, f64);

/// Allowed slack (points) between a window frame and the display rect.
pub const TOLERANCE: f64 = 2.0;

#[derive(Clone, Copy, Debug)]
pub struct WinInfo {
    pub pid: i32,
    pub layer: i32,
    pub alpha: f64,
    pub bounds: Rect,
}

/// Pure: does `frame` cover the whole `display` within `tol` points on every side?
pub fn covers(frame: Rect, display: Rect, tol: f64) -> bool {
    frame.0 <= display.0 + tol
        && frame.1 <= display.1 + tol
        && frame.0 + frame.2 >= display.0 + display.2 - tol
        && frame.1 + frame.3 >= display.1 + display.3 - tol
}

/// Pure: the display containing point `p` (falls back to the first = main display).
pub fn display_containing(displays: &[Rect], p: (f64, f64)) -> Option<Rect> {
    displays
        .iter()
        .copied()
        .find(|d| p.0 >= d.0 && p.0 < d.0 + d.2 && p.1 >= d.1 && p.1 < d.1 + d.3)
        .or_else(|| displays.first().copied())
}

/// Pure: the topmost ordinary window (layer 0, visible, non-empty, not ours) from a front-to-back list.
pub fn topmost_window(windows: &[WinInfo], own_pid: i32) -> Option<&WinInfo> {
    windows
        .iter()
        .find(|w| w.layer == 0 && w.alpha > 0.01 && w.pid != own_pid && w.bounds.2 > 1.0 && w.bounds.3 > 1.0)
}

/// Pure verdict. `windows` is front-to-back (the order CGWindowListCopyWindowInfo returns).
/// `front_pid` is the frontmost application (if known): the topmost ordinary window must belong to
/// it, which skips invisible full-screen helper windows of background apps. The verdict only counts
/// when the window fills the display under the overlay (`overlay_pt`); with no overlay point any display counts.
pub fn decide(
    windows: &[WinInfo],
    displays: &[Rect],
    front_pid: Option<i32>,
    own_pid: i32,
    overlay_pt: Option<(f64, f64)>,
) -> bool {
    let Some(top) = topmost_window(windows, own_pid) else { return false };
    if front_pid.is_some_and(|p| p != top.pid) {
        return false;
    }
    let Some(filled) = displays.iter().copied().find(|d| covers(top.bounds, *d, TOLERANCE)) else {
        return false;
    };
    match overlay_pt.and_then(|p| display_containing(displays, p)) {
        Some(o) => o == filled,
        None => true,
    }
}

#[cfg(target_os = "macos")]
mod ffi {
    use std::ffi::c_void;

    pub type CFTypeRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct CGSize {
        pub width: f64,
        pub height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct CGRect {
        pub origin: CGPoint,
        pub size: CGSize,
    }

    pub const K_CF_NUMBER_SINT32: isize = 3;
    pub const K_CF_NUMBER_FLOAT64: isize = 6;
    /// kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
    pub const WINDOW_LIST_OPTIONS: u32 = 1 | 16;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFArrayGetCount(a: CFTypeRef) -> isize;
        pub fn CFArrayGetValueAtIndex(a: CFTypeRef, i: isize) -> CFTypeRef;
        pub fn CFDictionaryGetValue(d: CFTypeRef, k: CFTypeRef) -> CFTypeRef;
        pub fn CFNumberGetValue(n: CFTypeRef, ty: isize, out: *mut c_void) -> bool;
        pub fn CFRelease(r: CFTypeRef);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub static kCGWindowLayer: CFTypeRef;
        pub static kCGWindowBounds: CFTypeRef;
        pub static kCGWindowOwnerPID: CFTypeRef;
        pub static kCGWindowAlpha: CFTypeRef;
        pub fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFTypeRef;
        pub fn CGRectMakeWithDictionaryRepresentation(d: CFTypeRef, out: *mut CGRect) -> bool;
        pub fn CGGetActiveDisplayList(max: u32, out: *mut u32, count: *mut u32) -> i32;
        pub fn CGDisplayBounds(display: u32) -> CGRect;
    }
}

#[cfg(target_os = "macos")]
fn displays() -> Vec<Rect> {
    let mut ids = [0u32; 16];
    let mut n = 0u32;
    // SAFETY: `ids` has room for 16 entries; CoreGraphics writes at most `max` of them and the count.
    let ok = unsafe { ffi::CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut n) } == 0;
    if !ok {
        return Vec::new();
    }
    ids.iter()
        .take(n as usize)
        // SAFETY: plain query on a display id just returned by CoreGraphics.
        .map(|id| unsafe { ffi::CGDisplayBounds(*id) })
        .map(|r| (r.origin.x, r.origin.y, r.size.width, r.size.height))
        .collect()
}

#[cfg(target_os = "macos")]
fn window_list() -> Vec<WinInfo> {
    use ffi::*;
    let mut out = Vec::new();
    // SAFETY: CoreFoundation/CoreGraphics read-only queries; every value is checked for null before use,
    // the array follows the Create rule and is released exactly once, and dictionary values are borrowed.
    unsafe {
        let arr = CGWindowListCopyWindowInfo(WINDOW_LIST_OPTIONS, 0);
        if arr.is_null() {
            return out;
        }
        for i in 0..CFArrayGetCount(arr) {
            let d = CFArrayGetValueAtIndex(arr, i);
            if d.is_null() {
                continue;
            }
            let int = |key: CFTypeRef| -> Option<i32> {
                let n = CFDictionaryGetValue(d, key);
                let mut v = 0i32;
                (!n.is_null() && CFNumberGetValue(n, K_CF_NUMBER_SINT32, &mut v as *mut i32 as *mut _)).then_some(v)
            };
            let (Some(layer), Some(pid)) = (int(kCGWindowLayer), int(kCGWindowOwnerPID)) else { continue };
            let alpha = {
                let n = CFDictionaryGetValue(d, kCGWindowAlpha);
                let mut v = 1.0f64;
                if n.is_null() || !CFNumberGetValue(n, K_CF_NUMBER_FLOAT64, &mut v as *mut f64 as *mut _) {
                    1.0
                } else {
                    v
                }
            };
            let b = CFDictionaryGetValue(d, kCGWindowBounds);
            let mut r = CGRect::default();
            if b.is_null() || !CGRectMakeWithDictionaryRepresentation(b, &mut r) {
                continue;
            }
            out.push(WinInfo {
                pid,
                layer,
                alpha,
                bounds: (r.origin.x, r.origin.y, r.size.width, r.size.height),
            });
        }
        CFRelease(arr);
    }
    out
}

/// pid of the frontmost application (NSWorkspace), if it can be determined.
#[cfg(target_os = "macos")]
fn frontmost_pid() -> Option<i32> {
    use objc2::{msg_send, runtime::{AnyClass, AnyObject}};
    let cls = AnyClass::get(c"NSWorkspace")?;
    // SAFETY: documented AppKit accessors with matching return types; each result is null-checked.
    unsafe {
        let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
        if ws.is_null() {
            return None;
        }
        let app: *mut AnyObject = msg_send![ws, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        (pid > 0).then_some(pid)
    }
}

/// True while a fullscreen app fills the display the overlay is on.
#[cfg(target_os = "macos")]
pub fn active(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let overlay_pt = app.get_webview_window(crate::winmgr::OVERLAY).and_then(|w| {
        let (p, s, sf) = (w.outer_position().ok()?, w.outer_size().ok()?, w.scale_factor().ok()?);
        Some(((p.x as f64 + s.width as f64 / 2.0) / sf, (p.y as f64 + s.height as f64 / 2.0) / sf))
    });
    let (wins, disp, front) = (window_list(), displays(), frontmost_pid());
    let verdict = decide(&wins, &disp, front, std::process::id() as i32, overlay_pt);
    if std::env::var_os("CRITTER_DEBUG").is_some() {
        eprintln!(
            "[critter] peek poll (mac): top={:?} front={front:?} displays={disp:?} overlay_pt={overlay_pt:?} -> fullscreen={verdict}",
            topmost_window(&wins, std::process::id() as i32)
        );
    }
    verdict
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Rect = (0.0, 0.0, 1512.0, 982.0);
    const EXT: Rect = (1512.0, -200.0, 1920.0, 1080.0);
    const OWN: i32 = 100;

    fn win(pid: i32, bounds: Rect) -> WinInfo {
        WinInfo { pid, layer: 0, alpha: 1.0, bounds }
    }

    #[test]
    fn covers_needs_every_edge() {
        assert!(covers(MAIN, MAIN, TOLERANCE));
        assert!(covers((-1.0, -1.0, 1514.0, 984.0), MAIN, TOLERANCE));
        assert!(!covers((0.0, 38.0, 1512.0, 944.0), MAIN, TOLERANCE)); // zoomed: menu bar strip free
        assert!(!covers((0.0, 0.0, 1400.0, 982.0), MAIN, TOLERANCE));
    }

    #[test]
    fn fullscreen_space_window_counts() {
        let w = [win(7, MAIN)];
        assert!(decide(&w, &[MAIN], Some(7), OWN, Some((700.0, 900.0))));
        assert!(decide(&w, &[MAIN], None, OWN, None));
    }

    #[test]
    fn zoomed_or_ordinary_windows_do_not_count() {
        assert!(!decide(&[win(7, (0.0, 38.0, 1512.0, 944.0))], &[MAIN], Some(7), OWN, None));
        assert!(!decide(&[win(7, (100.0, 100.0, 800.0, 600.0))], &[MAIN], Some(7), OWN, None));
        assert!(!decide(&[], &[MAIN], Some(7), OWN, None));
    }

    #[test]
    fn our_own_overlay_and_non_zero_layers_are_ignored() {
        let ours = win(OWN, MAIN);
        let menu = WinInfo { layer: 25, ..win(9, MAIN) }; // status-level windows (menu bar, notifications)
        let small = win(7, (100.0, 100.0, 800.0, 600.0));
        assert!(!decide(&[ours, menu, small], &[MAIN], Some(7), OWN, None));
        // a fullscreen window behind our overlay still counts
        assert!(decide(&[ours, win(7, MAIN)], &[MAIN], Some(7), OWN, None));
    }

    #[test]
    fn invisible_helper_windows_and_background_apps_do_not_count() {
        let ghost = WinInfo { alpha: 0.0, ..win(9, MAIN) };
        assert!(!decide(&[ghost, win(7, (50.0, 50.0, 400.0, 300.0))], &[MAIN], Some(7), OWN, None));
        // frontmost app is 7 but the topmost ordinary window is a background app's fullscreen window
        assert!(!decide(&[win(9, MAIN), win(7, (50.0, 50.0, 400.0, 300.0))], &[MAIN], Some(7), OWN, None));
    }

    #[test]
    fn only_the_overlays_display_counts() {
        let w = [win(7, EXT)];
        let both = [MAIN, EXT];
        assert!(!decide(&w, &both, Some(7), OWN, Some((700.0, 900.0)))); // overlay on the main display
        assert!(decide(&w, &both, Some(7), OWN, Some((2000.0, 300.0)))); // overlay on the external one
        assert!(decide(&w, &both, Some(7), OWN, None));
    }

    #[test]
    fn display_lookup_handles_negative_origins_and_falls_back_to_main() {
        let both = [MAIN, EXT];
        assert_eq!(display_containing(&both, (1600.0, -150.0)), Some(EXT));
        assert_eq!(display_containing(&both, (10.0, 10.0)), Some(MAIN));
        assert_eq!(display_containing(&both, (-5000.0, 0.0)), Some(MAIN));
        assert_eq!(display_containing(&[], (0.0, 0.0)), None);
    }
}

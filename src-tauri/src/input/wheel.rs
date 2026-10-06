//! Windows-only wheel capture. rdev's Windows hook divides the wheel delta by WHEEL_DELTA (120) with
//! INTEGER arithmetic, so precision-touchpad / high-resolution wheel events (deltas of +-15, +-30, ...)
//! all became 0 and horizontal wheels were dropped. This second low-level mouse hook keeps the exact
//! fractional notch count. Only the wheel rotation is read (no positions, no button identities).

use super::aggregator::InputAggregator;
use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    thread,
    time::Instant,
};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_MOUSEHWHEEL, WM_MOUSEWHEEL,
};

/// True once this hook is installed (rdev's lossy wheel events are then ignored).
pub static ACTIVE: AtomicBool = AtomicBool::new(false);
static SINK: OnceLock<(Arc<Mutex<InputAggregator>>, Instant)> = OnceLock::new();

/// Notches (+down) for a raw `mouseData` high word; `horizontal` wheels count +right.
pub fn notches(mouse_data: u32, horizontal: bool) -> f64 {
    let raw = ((mouse_data >> 16) as u16) as i16 as f64 / 120.0;
    if horizontal {
        raw
    } else {
        -raw // WM_MOUSEWHEEL: positive = away from the user (up); the contract is +down
    }
}

unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let msg = wparam.0 as u32;
        if msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL {
            if let Some((agg, t0)) = SINK.get() {
                // SAFETY: for WH_MOUSE_LL with code >= 0, lparam points to a valid MSLLHOOKSTRUCT.
                let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                let n = notches(info.mouseData, msg == WM_MOUSEHWHEEL);
                let now = t0.elapsed().as_secs_f64() * 1000.0;
                agg.lock().wheel_event(n, now);
                crate::scheduler::note_input_activity();
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn start(agg: Arc<Mutex<InputAggregator>>, t0: Instant) {
    let _ = SINK.set((agg, t0));
    let _ = thread::Builder::new().name("critter-wheel-hook".into()).spawn(|| unsafe {
        // SAFETY: a low-level hook needs a message loop on the installing thread; this thread owns one.
        if SetWindowsHookExW(WH_MOUSE_LL, Some(proc), None, 0).is_err() {
            eprintln!("[critter] wheel hook unavailable; falling back to rdev wheel events");
            return;
        }
        ACTIVE.store(true, Ordering::Relaxed);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(delta: i16) -> u32 {
        ((delta as u16 as u32) << 16) | 0x1
    }

    #[test]
    fn keeps_fractional_notches_and_signs() {
        assert_eq!(notches(data(-120), false), 1.0); // wheel toward the user = down = +
        assert_eq!(notches(data(120), false), -1.0);
        assert_eq!(notches(data(-15), false), 0.125);
        assert_eq!(notches(data(30), false), -0.25);
        assert_eq!(notches(data(120), true), 1.0);
        assert_eq!(notches(data(-60), true), -0.5);
    }
}

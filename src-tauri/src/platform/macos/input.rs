//! macOS global input: a listen-only CGEventTap that COUNTS events (key down, clicks, moves, scroll)
//! and never reads key codes or characters. It replaces rdev on macOS (rdev 0.5.3 translates every key
//! press through the Text Input Services APIs off the main thread, which aborts on recent macOS releases).
//!
//! The tap needs the Input Monitoring permission. A supervisor thread polls the permission every 2 s:
//! - denied: nothing is created, `failed` is true (the caller falls back to polling the cursor), the
//!   first time a friendly bubble explains why and the system prompt is shown;
//! - granted: the tap thread starts (no restart needed), `failed` turns false;
//! - changes are pushed to the settings window as `critter:input-access`.

use super::access::{self, Access};
use crate::input::aggregator::InputAggregator;
use crate::winmgr;
use parking_lot::Mutex;
use serde_json::json;
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, AtomicPtr, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

type CFTypeRef = *const c_void;

// CGEventType values
const KEY_DOWN: u32 = 10;
const LEFT_DOWN: u32 = 1;
const RIGHT_DOWN: u32 = 3;
const OTHER_DOWN: u32 = 25;
const MOUSE_MOVED: u32 = 5;
const LEFT_DRAGGED: u32 = 6;
const RIGHT_DRAGGED: u32 = 7;
const OTHER_DRAGGED: u32 = 27;
const SCROLL: u32 = 22;
const TAP_DISABLED_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_USER: u32 = 0xFFFF_FFFF;
// CGEventField
const SCROLL_DELTA_Y: u32 = 11; // kCGScrollWheelEventDeltaAxis1 (lines, + = up)
const SCROLL_DELTA_X: u32 = 12; // kCGScrollWheelEventDeltaAxis2

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

type TapCallback = extern "C" fn(proxy: *mut c_void, ty: u32, event: *mut c_void, user: *mut c_void) -> *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user: *mut c_void,
    ) -> CFTypeRef;
    fn CGEventTapEnable(tap: CFTypeRef, enable: bool);
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: CFTypeRef;
    fn CFMachPortCreateRunLoopSource(allocator: CFTypeRef, port: CFTypeRef, order: isize) -> CFTypeRef;
    fn CFRunLoopGetCurrent() -> CFTypeRef;
    fn CFRunLoopAddSource(rl: CFTypeRef, source: CFTypeRef, mode: CFTypeRef);
    fn CFRunLoopRun();
}

struct Ctx {
    agg: Arc<Mutex<InputAggregator>>,
    t0: Instant,
    tap: AtomicPtr<c_void>,
}

extern "C" fn on_event(_proxy: *mut c_void, ty: u32, event: *mut c_void, user: *mut c_void) -> *mut c_void {
    // SAFETY: `user` is the leaked Box<Ctx> passed to CGEventTapCreate and lives for the whole process.
    let ctx = unsafe { &*(user as *const Ctx) };
    if ty == TAP_DISABLED_TIMEOUT || ty == TAP_DISABLED_USER {
        let tap = ctx.tap.load(Ordering::Acquire);
        if !tap.is_null() {
            // SAFETY: `tap` is the live mach port created by this thread.
            unsafe { CGEventTapEnable(tap as CFTypeRef, true) };
        }
        return event;
    }
    let now = ctx.t0.elapsed().as_secs_f64() * 1000.0;
    crate::scheduler::note_input_activity();
    match ty {
        KEY_DOWN => ctx.agg.lock().key_down(now),
        LEFT_DOWN | RIGHT_DOWN | OTHER_DOWN => ctx.agg.lock().click(now),
        MOUSE_MOVED | LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DRAGGED => {
            // SAFETY: `event` is a valid CGEventRef for the duration of the callback.
            let p = unsafe { CGEventGetLocation(event) };
            ctx.agg.lock().mouse_move(p.x, p.y, now);
        }
        SCROLL => {
            // SAFETY: as above. The contract is + = down, CoreGraphics reports + = up.
            let (dy, dx) = unsafe {
                (CGEventGetIntegerValueField(event, SCROLL_DELTA_Y), CGEventGetIntegerValueField(event, SCROLL_DELTA_X))
            };
            ctx.agg.lock().wheel_event(-(dy as f64) + dx as f64, now);
        }
        _ => {}
    }
    event
}

/// Runs the tap on the current thread until the process exits. Returns Err if the tap could not be created.
fn run_tap(agg: Arc<Mutex<InputAggregator>>, t0: Instant, running: &AtomicBool) -> Result<(), &'static str> {
    let mask: u64 = [KEY_DOWN, LEFT_DOWN, RIGHT_DOWN, OTHER_DOWN, MOUSE_MOVED, LEFT_DRAGGED, RIGHT_DRAGGED, OTHER_DRAGGED, SCROLL]
        .iter()
        .fold(0, |m, t| m | (1u64 << t));
    let ctx: &'static Ctx = Box::leak(Box::new(Ctx { agg, t0, tap: AtomicPtr::new(std::ptr::null_mut()) }));
    // SAFETY: standard CGEventTap setup; `ctx` is 'static; the run loop source is owned by this thread's run loop.
    unsafe {
        // kCGSessionEventTap = 1, kCGHeadInsertEventTap = 0, kCGEventTapOptionListenOnly = 1
        let tap = CGEventTapCreate(1, 0, 1, mask, on_event, ctx as *const Ctx as *mut c_void);
        if tap.is_null() {
            return Err("CGEventTapCreate returned null");
        }
        ctx.tap.store(tap as *mut c_void, Ordering::Release);
        let src = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if src.is_null() {
            return Err("run loop source unavailable");
        }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        running.store(true, Ordering::Release);
        CFRunLoopRun();
    }
    running.store(false, Ordering::Release);
    Ok(())
}

// The overlay fits about 50 characters of a message; the Settings banner carries the full explanation.
const BUBBLE: &str = "Allow Input Monitoring so I feel you type!";

/// First run only: remember (marker file) that the explanation was shown so it is not repeated at every launch.
fn first_prompt_due(app: &AppHandle) -> bool {
    let Ok(dir) = app.path().app_config_dir() else { return true };
    let marker = dir.join(".input-access-explained");
    if marker.exists() {
        return false;
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, b"1");
    true
}

/// Starts the supervisor. The returned flag is true while the tap is not delivering events.
pub fn start(agg: Arc<Mutex<InputAggregator>>, t0: Instant, app: AppHandle) -> Arc<AtomicBool> {
    let failed = Arc::new(AtomicBool::new(true));
    let flag = failed.clone();
    let spawned = thread::Builder::new().name("critter-input-supervisor".into()).spawn(move || {
        let running = Arc::new(AtomicBool::new(false));
        let mut last: Option<Access> = None;
        let mut explained = false;
        let mut last_tap_attempt: Option<Instant> = None;
        loop {
            let now_access = access::state();
            if last != Some(now_access) {
                last = Some(now_access);
                let _ = app.emit("critter:input-access", now_access.as_str());
                eprintln!("[critter] input access: {}", now_access.as_str());
            }
            match now_access {
                Access::Denied => {
                    flag.store(true, Ordering::Relaxed);
                    if !explained {
                        explained = true;
                        if first_prompt_due(&app) {
                            thread::sleep(Duration::from_secs(4)); // let the overlay finish loading
                            access::request(); // system prompt + registers the app in the pane
                            winmgr::emit_overlay(
                                &app,
                                "critter:reminder",
                                json!({ "kind": "message", "text": BUBBLE, "durationMs": 20000 }),
                            );
                        }
                    }
                }
                Access::Granted => {
                    if !running.load(Ordering::Acquire) {
                        let retry_ok = last_tap_attempt.map_or(true, |t| t.elapsed() > Duration::from_secs(10));
                        if retry_ok {
                            last_tap_attempt = Some(Instant::now());
                            let (agg2, run2) = (agg.clone(), running.clone());
                            let _ = thread::Builder::new().name("critter-input-tap".into()).spawn(move || {
                                if let Err(e) = run_tap(agg2, t0, &run2) {
                                    eprintln!("[critter] input tap unavailable: {e}");
                                }
                            });
                        }
                    }
                    flag.store(!running.load(Ordering::Acquire), Ordering::Relaxed);
                }
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
    if spawned.is_err() {
        eprintln!("[critter] input supervisor failed to spawn; cursor-only fallback");
    }
    failed
}

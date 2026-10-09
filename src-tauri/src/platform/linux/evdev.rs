//! OPTIONAL input backend (cargo feature `evdev`, runtime opt-in) that reads `/dev/input/event*` so
//! typing / clicks / scrolling are counted in native Wayland apps too (XRecord only sees X11 clients).
//! Needs read access to the devices (membership of the `input` group). Off by default.
//!
//! Privacy: only the event type and the fact that a key / button went down or the wheel moved are looked
//! at. Key codes are never stored, forwarded or logged, nor are device names.
//!
//! Opt in with `CRITTER_EVDEV=1` in the environment or by creating the file `~/.codecritter/evdev`.

use crate::input::aggregator::InputAggregator;
use parking_lot::Mutex;
use std::{
    fs::File,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Instant,
};

/// Set once at least one device is being read; the rdev hook then skips key / button / wheel events.
pub static ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Keyboard,
    Mouse,
}

/// `struct input_event` is timeval (2 longs) + u16 type + u16 code + i32 value.
const EVENT_SIZE: usize = 2 * std::mem::size_of::<usize>() + 8;
const EV_KEY: u16 = 1;
const EV_REL: u16 = 2;
const REL_HWHEEL: u16 = 6;
const REL_WHEEL: u16 = 8;
const BTN_LEFT: u16 = 0x110;
const BTN_TASK: u16 = 0x117;
/// EV_REP (0x14) is only advertised by real keyboards (not by power buttons / lid switches).
const EV_REP_BIT: u64 = 1 << 0x14;

pub fn requested() -> bool {
    if std::env::var("CRITTER_EVDEV").map_or(false, |v| v == "1") {
        return true;
    }
    dirs::home_dir().map_or(false, |h| h.join(".codecritter").join("evdev").exists())
}

/// Pure: classify the devices listed in `/proc/bus/input/devices` -> `(eventN, kind)`.
pub fn parse_devices(text: &str) -> Vec<(String, Kind)> {
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let mut handlers = "";
        let mut ev: u64 = 0;
        for line in block.lines() {
            if let Some(h) = line.strip_prefix("H: Handlers=") {
                handlers = h;
            } else if let Some(e) = line.strip_prefix("B: EV=") {
                ev = u64::from_str_radix(e.trim(), 16).unwrap_or(0);
            }
        }
        let Some(event) = handlers.split_whitespace().find(|t| t.starts_with("event")) else { continue };
        let words: Vec<&str> = handlers.split_whitespace().collect();
        if words.contains(&"kbd") && ev & EV_REP_BIT != 0 {
            out.push((event.to_string(), Kind::Keyboard));
        } else if words.iter().any(|w| w.starts_with("mouse")) {
            out.push((event.to_string(), Kind::Mouse));
        }
    }
    out
}

/// Pure: what one raw event means for the aggregator.
#[derive(Debug, PartialEq)]
pub enum Action {
    Key,
    Click,
    /// Wheel delta, +down (the contract) in notches.
    Wheel(f64),
    None,
}

pub fn classify(kind: Kind, etype: u16, code: u16, value: i32) -> Action {
    match (kind, etype) {
        (Kind::Keyboard, EV_KEY) if value == 1 => Action::Key,
        (Kind::Mouse, EV_KEY) if value == 1 && (BTN_LEFT..=BTN_TASK).contains(&code) => Action::Click,
        (Kind::Mouse, EV_REL) if code == REL_WHEEL => Action::Wheel(-(value as f64)),
        (Kind::Mouse, EV_REL) if code == REL_HWHEEL => Action::Wheel(value as f64),
        _ => Action::None,
    }
}

pub fn start(agg: Arc<Mutex<InputAggregator>>, t0: Instant) {
    if !requested() {
        return;
    }
    let Ok(text) = std::fs::read_to_string("/proc/bus/input/devices") else {
        eprintln!("[critter] evdev: cannot list input devices");
        return;
    };
    let mut opened = 0;
    for (event, kind) in parse_devices(&text) {
        let Ok(mut f) = File::open(format!("/dev/input/{event}")) else { continue };
        opened += 1;
        let agg = agg.clone();
        let _ = thread::Builder::new().name("critter-evdev".into()).spawn(move || {
            let mut buf = [0u8; EVENT_SIZE];
            while f.read_exact(&mut buf).is_ok() {
                let o = EVENT_SIZE - 8;
                let etype = u16::from_ne_bytes([buf[o], buf[o + 1]]);
                let code = u16::from_ne_bytes([buf[o + 2], buf[o + 3]]);
                let value = i32::from_ne_bytes([buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]]);
                let now = t0.elapsed().as_secs_f64() * 1000.0;
                match classify(kind, etype, code, value) {
                    Action::Key => {
                        crate::scheduler::note_input_activity();
                        agg.lock().key_down(now);
                    }
                    Action::Click => {
                        crate::scheduler::note_input_activity();
                        agg.lock().click(now);
                    }
                    Action::Wheel(d) => {
                        crate::scheduler::note_input_activity();
                        agg.lock().wheel_event(d, now);
                    }
                    Action::None => {}
                }
            }
        });
    }
    if opened > 0 {
        ACTIVE.store(true, Ordering::Relaxed);
        eprintln!("[critter] evdev input backend active ({opened} devices)");
    } else {
        eprintln!("[critter] evdev requested but no readable input devices (join the `input` group and re-login)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "I: Bus=0011 Vendor=0001 Product=0001 Version=ab41\n\
N: Name=\"AT Translated Set 2 keyboard\"\nH: Handlers=sysrq kbd event3 leds\nB: EV=120013\n\n\
I: Bus=0019 Vendor=0000 Product=0001 Version=0000\nN: Name=\"Power Button\"\nH: Handlers=kbd event0\nB: EV=3\n\n\
I: Bus=0003 Vendor=046d Product=c077 Version=0111\nN: Name=\"USB Mouse\"\nH: Handlers=mouse0 event5\nB: EV=17\n";

    #[test]
    fn picks_keyboards_and_mice_only() {
        assert_eq!(
            parse_devices(SAMPLE),
            vec![("event3".to_string(), Kind::Keyboard), ("event5".to_string(), Kind::Mouse)]
        );
    }

    #[test]
    fn classifies_events() {
        assert_eq!(classify(Kind::Keyboard, EV_KEY, 30, 1), Action::Key);
        assert_eq!(classify(Kind::Keyboard, EV_KEY, 30, 0), Action::None); // release
        assert_eq!(classify(Kind::Keyboard, EV_KEY, 30, 2), Action::None); // autorepeat
        assert_eq!(classify(Kind::Mouse, EV_KEY, 0x110, 1), Action::Click);
        assert_eq!(classify(Kind::Mouse, EV_REL, REL_WHEEL, -1), Action::Wheel(1.0)); // wheel down = +
        assert_eq!(classify(Kind::Mouse, EV_REL, 0, 5), Action::None); // pointer motion
    }
}

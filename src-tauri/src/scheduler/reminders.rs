//! Pure reminder scheduling (port of src/main/scheduler/reminders.ts). Time is injected through
//! [`Clock`], idle time and settings are passed to `tick`, effects are returned (no side effects).

use serde_json::Value;
use std::collections::HashMap;

pub const TICK_MS: u64 = 20_000;
pub const GRACE_MS: i64 = 2 * 60_000;
pub const AWAY_AFTER_MS: u64 = 5 * 60_000;
pub const REMINDER_DURATION_MS: u64 = 7000;

const DAY_MS: i64 = 86_400_000;

/// Injectable clock. `local_offset_secs` is the local UTC offset (0 in tests).
pub trait Clock {
    fn now_ms(&self) -> i64;
    fn local_offset_secs(&self, _at_ms: i64) -> i64 {
        0
    }
}

pub struct SystemClock;
impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
    fn local_offset_secs(&self, at_ms: i64) -> i64 {
        use chrono::{Offset, TimeZone};
        chrono::Local
            .timestamp_millis_opt(at_ms)
            .single()
            .map(|d| d.offset().fix().local_minus_utc() as i64)
            .unwrap_or(0)
    }
}

/// Broken-down local time derived from epoch ms + offset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocalTime {
    /// Local days since the epoch.
    pub day: i64,
    pub minute_of_day: i64,
    /// 0 = Sunday.
    pub weekday: i64,
    pub offset_ms: i64,
}

pub fn local_of(clock: &dyn Clock, at_ms: i64) -> LocalTime {
    let offset_ms = clock.local_offset_secs(at_ms) * 1000;
    let l = at_ms + offset_ms;
    let day = l.div_euclid(DAY_MS);
    let minute_of_day = l.rem_euclid(DAY_MS) / 60_000;
    LocalTime { day, minute_of_day, weekday: (day + 4).rem_euclid(7), offset_ms }
}

impl LocalTime {
    /// Epoch ms of today's `minute` (minutes since local midnight).
    pub fn at_minute(&self, minute: i64) -> i64 {
        self.day * DAY_MS + minute * 60_000 - self.offset_ms
    }
}

pub fn parse_hhmm(s: &str) -> Option<i64> {
    let (h, m) = s.trim().split_once(':')?;
    let digits = |x: &str| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit());
    if !digits(h) || !digits(m) || h.len() > 2 || m.len() != 2 {
        return None;
    }
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// True when `minute_of_day` is inside [from, to). Handles windows crossing midnight.
pub fn in_dnd_window(minute_of_day: i64, from: &str, to: &str) -> bool {
    match (parse_hhmm(from), parse_hhmm(to)) {
        (Some(a), Some(b)) if a != b => {
            if a < b {
                minute_of_day >= a && minute_of_day < b
            } else {
                minute_of_day >= a || minute_of_day < b
            }
        }
        _ => false,
    }
}

pub fn is_dnd_active(settings: &Value, l: &LocalTime) -> bool {
    let d = &settings["dnd"];
    d["enabled"].as_bool().unwrap_or(false)
        && in_dnd_window(l.minute_of_day, d["from"].as_str().unwrap_or(""), d["to"].as_str().unwrap_or(""))
}

#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    /// `kind` is a ReminderKind string; text is empty for stretch/water (the overlay picks lines).
    Fire { kind: &'static str, text: String, duration_ms: u64 },
    /// A 'once' message fired: disable it in the store.
    DisableMessage(String),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Interval {
    Stretch,
    Water,
}
const INTERVALS: [(Interval, &str); 2] = [(Interval::Stretch, "stretch"), (Interval::Water, "water")];

#[derive(Default)]
pub struct ReminderEngine {
    due: HashMap<Interval, Option<i64>>,
    pending: HashMap<Interval, bool>,
    cfg_key: HashMap<Interval, String>,
    fired_on: HashMap<String, i64>, // message id -> local day
}

fn every_ms(settings: &Value, key: &str) -> i64 {
    settings["reminders"][key]["everyMin"].as_f64().unwrap_or(1.0).max(1.0) as i64 * 60_000
}

impl ReminderEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Re-read settings: restart interval timers whose config changed.
    pub fn sync_intervals(&mut self, now: i64, settings: &Value) {
        for (k, name) in INTERVALS {
            let c = &settings["reminders"][name];
            let enabled = c["enabled"].as_bool().unwrap_or(false);
            let key = format!("{}:{}", enabled, c["everyMin"]);
            if self.cfg_key.get(&k) == Some(&key) {
                continue;
            }
            self.cfg_key.insert(k, key);
            self.pending.insert(k, false);
            self.due.insert(k, if enabled { Some(now + every_ms(settings, name)) } else { None });
        }
    }

    /// Call every ~20 s. Wall-clock based so drift / sleep cannot skip or double fire.
    pub fn tick(&mut self, clock: &dyn Clock, idle_ms: u64, settings: &Value) -> Vec<Effect> {
        let now = clock.now_ms();
        let l = local_of(clock, now);
        let dnd = is_dnd_active(settings, &l);
        let away = idle_ms > AWAY_AFTER_MS;
        let mut out = Vec::new();

        for (k, name) in INTERVALS {
            let Some(due) = self.due.get(&k).copied().flatten() else { continue };
            let every = every_ms(settings, name);
            if now >= due {
                self.pending.insert(k, true);
            }
            if !self.pending.get(&k).copied().unwrap_or(false) {
                continue;
            }
            if dnd {
                self.pending.insert(k, false);
                self.due.insert(k, Some(now + every));
                continue;
            }
            if away {
                continue; // postponed; fires on return
            }
            self.pending.insert(k, false);
            self.due.insert(k, Some(now + every));
            let kind = if k == Interval::Stretch { "stretch" } else { "water" };
            out.push(Effect::Fire { kind, text: String::new(), duration_ms: REMINDER_DURATION_MS });
        }

        self.tick_messages(settings, now, &l, dnd, &mut out);
        out
    }

    fn tick_messages(&mut self, settings: &Value, now: i64, l: &LocalTime, dnd: bool, out: &mut Vec<Effect>) {
        self.fired_on.retain(|_, d| *d == l.day);
        let Some(msgs) = settings["messages"].as_array() else { return };
        for m in msgs {
            if !m["enabled"].as_bool().unwrap_or(false) {
                continue;
            }
            let repeat = m["repeat"].as_str().unwrap_or("daily");
            if repeat == "weekdays" && !(1..=5).contains(&l.weekday) {
                continue;
            }
            let Some(min) = parse_hhmm(m["time"].as_str().unwrap_or("")) else { continue };
            let sched = l.at_minute(min);
            if now < sched || now - sched > GRACE_MS {
                continue;
            }
            let id = m["id"].as_str().unwrap_or("").to_string();
            if self.fired_on.get(&id) == Some(&l.day) {
                continue;
            }
            self.fired_on.insert(id.clone(), l.day);
            if dnd {
                continue; // missed during DND: do not fire later
            }
            let text = m["text"].as_str().filter(|t| !t.is_empty()).unwrap_or("Reminder").to_string();
            out.push(Effect::Fire { kind: "message", text, duration_ms: REMINDER_DURATION_MS });
            if repeat == "once" {
                out.push(Effect::DisableMessage(id));
            }
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    pub struct Fake(pub Cell<i64>);
    impl Clock for Fake {
        fn now_ms(&self) -> i64 {
            self.0.get()
        }
    }
    const MIN: i64 = 60_000;
    /// 2024-01-01 (Monday) 00:00 UTC.
    const MON: i64 = 1_704_067_200_000;
    fn at(h: i64, m: i64) -> i64 {
        MON + (h * 60 + m) * MIN
    }
    fn settings() -> Value {
        json!({
            "reminders": {"stretch": {"enabled": true, "everyMin": 30}, "water": {"enabled": false, "everyMin": 20}},
            "messages": [], "dnd": {"enabled": false, "from": "22:00", "to": "07:00"}
        })
    }
    fn kinds(e: &[Effect]) -> Vec<&'static str> {
        e.iter().filter_map(|x| if let Effect::Fire { kind, .. } = x { Some(*kind) } else { None }).collect()
    }

    #[test]
    fn hhmm_and_dnd_midnight() {
        assert_eq!(parse_hhmm("7:05"), Some(425));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("ab"), None);
        assert!(in_dnd_window(23 * 60, "22:00", "07:00"));
        assert!(in_dnd_window(60, "22:00", "07:00"));
        assert!(!in_dnd_window(12 * 60, "22:00", "07:00"));
        assert!(!in_dnd_window(7 * 60, "22:00", "07:00"));
        assert!(in_dnd_window(12 * 60, "09:00", "17:00"));
        assert!(!in_dnd_window(17 * 60, "09:00", "17:00"));
        assert!(!in_dnd_window(5, "10:00", "10:00"));
    }

    #[test]
    fn interval_fires_and_reschedules_and_resets_on_change() {
        let clock = Fake(Cell::new(at(10, 0)));
        let mut s = settings();
        let mut e = ReminderEngine::new();
        e.sync_intervals(clock.now_ms(), &s);
        clock.0.set(at(10, 29));
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(10, 30));
        assert_eq!(kinds(&e.tick(&clock, 0, &s)), vec!["stretch"]);
        clock.0.set(at(10, 59));
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(11, 0));
        assert_eq!(kinds(&e.tick(&clock, 0, &s)), vec!["stretch"]);
        // change interval to 5 min: timer restarts from now
        s["reminders"]["stretch"]["everyMin"] = json!(5);
        e.sync_intervals(clock.now_ms(), &s);
        clock.0.set(at(11, 4));
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(11, 5));
        assert_eq!(kinds(&e.tick(&clock, 0, &s)), vec!["stretch"]);
        // disabling stops it
        s["reminders"]["stretch"]["enabled"] = json!(false);
        e.sync_intervals(clock.now_ms(), &s);
        clock.0.set(at(13, 0));
        assert!(e.tick(&clock, 0, &s).is_empty());
    }

    #[test]
    fn dnd_drops_occurrence() {
        let clock = Fake(Cell::new(at(21, 0)));
        let mut s = settings();
        s["dnd"]["enabled"] = json!(true);
        let mut e = ReminderEngine::new();
        e.sync_intervals(clock.now_ms(), &s);
        clock.0.set(at(22, 30));
        assert!(e.tick(&clock, 0, &s).is_empty()); // due at 21:30 but in DND: dropped, next 23:00
        clock.0.set(at(22, 59));
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(23, 0));
        assert!(e.tick(&clock, 0, &s).is_empty()); // dropped again (still DND), next 23:30
        // DND over: fires only at the next scheduled occurrence, nothing queued from the night
        s["dnd"]["enabled"] = json!(false);
        clock.0.set(at(23, 29));
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(23, 30));
        assert_eq!(kinds(&e.tick(&clock, 0, &s)), vec!["stretch"]);
    }

    #[test]
    fn idle_postpones_and_fires_on_return() {
        let clock = Fake(Cell::new(at(10, 0)));
        let s = settings();
        let mut e = ReminderEngine::new();
        e.sync_intervals(clock.now_ms(), &s);
        clock.0.set(at(10, 31));
        assert!(e.tick(&clock, AWAY_AFTER_MS + 1, &s).is_empty());
        clock.0.set(at(11, 15));
        assert!(e.tick(&clock, AWAY_AFTER_MS + 1, &s).is_empty());
        clock.0.set(at(11, 16));
        assert_eq!(kinds(&e.tick(&clock, 1000, &s)), vec!["stretch"]);
        clock.0.set(at(11, 17));
        assert!(e.tick(&clock, 1000, &s).is_empty());
    }

    fn msg(id: &str, time: &str, repeat: &str) -> Value {
        json!({"id": id, "time": time, "text": "Standup", "repeat": repeat, "enabled": true})
    }

    #[test]
    fn messages_once_daily_weekdays() {
        let clock = Fake(Cell::new(at(8, 59)));
        let mut s = settings();
        s["reminders"]["stretch"]["enabled"] = json!(false);
        s["messages"] = json!([msg("a", "09:00", "once"), msg("b", "09:00", "daily"), msg("c", "09:00", "weekdays")]);
        let mut e = ReminderEngine::new();
        e.sync_intervals(clock.now_ms(), &s);
        assert!(e.tick(&clock, 0, &s).is_empty());
        clock.0.set(at(9, 0));
        let out = e.tick(&clock, 0, &s);
        assert_eq!(kinds(&out), vec!["message", "message", "message"]);
        assert!(out.contains(&Effect::DisableMessage("a".into())));
        assert!(matches!(&out[0], Effect::Fire { text, .. } if text == "Standup"));
        // no double fire within the grace window
        clock.0.set(at(9, 1));
        assert!(e.tick(&clock, 0, &s).is_empty());
        // next day (Tuesday): daily + weekdays + (still enabled in this fake) once fire again
        clock.0.set(at(9, 0) + 24 * 60 * MIN);
        assert_eq!(kinds(&e.tick(&clock, 0, &s)).len(), 3);
    }

    #[test]
    fn messages_grace_weekend_and_dnd() {
        let mut s = settings();
        s["reminders"]["stretch"]["enabled"] = json!(false);
        s["messages"] = json!([msg("b", "09:00", "daily")]);
        let mut e = ReminderEngine::new();
        // 3 minutes late: beyond the 2 min grace
        let clock = Fake(Cell::new(at(9, 3)));
        assert!(e.tick(&clock, 0, &s).is_empty());
        // exactly 2 minutes late is still inside the grace window
        clock.0.set(at(9, 2));
        assert_eq!(kinds(&e.tick(&clock, 0, &s)).len(), 1);
        // weekdays on Saturday (2024-01-06) do not fire
        let sat = MON + 5 * 24 * 60 * MIN;
        s["messages"] = json!([msg("c", "09:00", "weekdays")]);
        clock.0.set(sat + 9 * 60 * MIN);
        assert!(e.tick(&clock, 0, &s).is_empty());
        // DND swallows the message and does not fire it later
        s["messages"] = json!([msg("d", "23:00", "once")]);
        s["dnd"] = json!({"enabled": true, "from": "22:00", "to": "07:00"});
        clock.0.set(at(23, 0));
        assert!(e.tick(&clock, 0, &s).is_empty());
        s["dnd"]["enabled"] = json!(false);
        clock.0.set(at(23, 1));
        assert!(e.tick(&clock, 0, &s).is_empty());
    }

    #[test]
    fn local_offset_applies() {
        struct Off(i64);
        impl Clock for Off {
            fn now_ms(&self) -> i64 {
                self.0
            }
            fn local_offset_secs(&self, _: i64) -> i64 {
                3600
            }
        }
        let l = local_of(&Off(at(23, 30)), at(23, 30));
        assert_eq!(l.minute_of_day, 30);
        assert_eq!(l.weekday, 2); // Tuesday locally
        assert_eq!(l.at_minute(30), at(23, 30));
    }
}

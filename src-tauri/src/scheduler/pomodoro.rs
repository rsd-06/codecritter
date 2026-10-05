//! Pomodoro engine (port of src/main/scheduler/pomodoro.ts). Pure: time is passed in, effects returned.

use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Focus,
    Break,
    LongBreak,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Focus => "focus",
            Phase::Break => "break",
            Phase::LongBreak => "longBreak",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cfg {
    pub focus_min: i64,
    pub break_min: i64,
    pub long_break_min: i64,
    pub cycles_before_long: i64,
}

impl Cfg {
    pub fn from_settings(s: &Value) -> Cfg {
        let p = &s["pomodoro"];
        let g = |k: &str, d: i64| p[k].as_f64().map(|v| v as i64).unwrap_or(d);
        Cfg {
            focus_min: g("focusMin", 25),
            break_min: g("breakMin", 5),
            long_break_min: g("longBreakMin", 15),
            cycles_before_long: g("cyclesBeforeLong", 4),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub phase: Phase,
    pub ends_at: Option<i64>,
    pub cycle: i64,
    pub paused: bool,
    pub remaining_ms: i64,
}

impl State {
    pub const IDLE: State = State { phase: Phase::Idle, ends_at: None, cycle: 0, paused: false, remaining_ms: 0 };

    pub fn to_json(&self) -> Value {
        json!({
            "phase": self.phase.as_str(),
            "endsAt": self.ends_at,
            "cycle": self.cycle,
            "paused": self.paused,
            "remainingMs": self.remaining_ms,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    State(State),
    /// ReminderKind string + duration (text is left empty, the overlay picks the line).
    Reminder { kind: &'static str, duration_ms: u64 },
}

pub struct PomodoroEngine {
    state: State,
}

impl Default for PomodoroEngine {
    fn default() -> Self {
        Self { state: State::IDLE }
    }
}

fn duration(cfg: &Cfg, phase: Phase) -> i64 {
    let min = match phase {
        Phase::Focus => cfg.focus_min,
        Phase::Break => cfg.break_min,
        _ => cfg.long_break_min,
    };
    min.max(1) * 60_000
}

impl PomodoroEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.state.phase != Phase::Idle && !self.state.paused
    }

    pub fn state(&self, now: i64) -> State {
        let mut s = self.state.clone();
        if s.phase != Phase::Idle && !s.paused {
            if let Some(e) = s.ends_at {
                s.remaining_ms = (e - now).max(0);
            }
        }
        s
    }

    fn push(&self, now: i64, out: &mut Vec<Effect>) {
        out.push(Effect::State(self.state(now)));
    }

    fn enter(&mut self, phase: Phase, cycle: i64, now: i64, cfg: &Cfg, out: &mut Vec<Effect>) {
        let ms = duration(cfg, phase);
        self.state = State { phase, cycle, paused: false, ends_at: Some(now + ms), remaining_ms: ms };
        out.push(Effect::Reminder {
            kind: if phase == Phase::Focus { "pomodoro-focus" } else { "pomodoro-break" },
            duration_ms: 6000,
        });
        self.push(now, out);
    }

    fn finish(&mut self, now: i64, out: &mut Vec<Effect>) {
        self.state = State::IDLE;
        out.push(Effect::Reminder { kind: "pomodoro-done", duration_ms: 8000 });
        self.push(now, out);
    }

    fn next(&mut self, now: i64, cfg: &Cfg, out: &mut Vec<Effect>) {
        let (phase, cycle) = (self.state.phase, self.state.cycle);
        let every = cfg.cycles_before_long.max(1);
        match phase {
            Phase::Focus => {
                let p = if cycle % every == 0 { Phase::LongBreak } else { Phase::Break };
                self.enter(p, cycle, now, cfg, out)
            }
            Phase::Break => self.enter(Phase::Focus, cycle + 1, now, cfg, out),
            Phase::LongBreak => self.finish(now, out),
            Phase::Idle => {}
        }
    }

    /// Call about once a second. Advances the phase at `endsAt`, otherwise pushes the running state.
    pub fn tick(&mut self, now: i64, cfg: &Cfg) -> Vec<Effect> {
        let mut out = Vec::new();
        let s = &self.state;
        if s.phase == Phase::Idle || s.paused {
            return out;
        }
        match s.ends_at {
            Some(e) if now >= e => self.next(now, cfg, &mut out),
            Some(_) => self.push(now, &mut out),
            None => {}
        }
        out
    }

    pub fn start(&mut self, now: i64, cfg: &Cfg) -> Vec<Effect> {
        let mut out = Vec::new();
        if self.state.phase == Phase::Idle {
            self.enter(Phase::Focus, 1, now, cfg, &mut out);
        }
        out
    }

    pub fn pause(&mut self, now: i64) -> Vec<Effect> {
        let mut out = Vec::new();
        let s = &self.state;
        if s.phase == Phase::Idle || s.paused {
            return out;
        }
        if let Some(e) = s.ends_at {
            self.state.remaining_ms = (e - now).max(0);
            self.state.paused = true;
            self.state.ends_at = None;
            self.push(now, &mut out);
        }
        out
    }

    pub fn resume(&mut self, now: i64) -> Vec<Effect> {
        let mut out = Vec::new();
        if self.state.phase == Phase::Idle || !self.state.paused {
            return out;
        }
        self.state.paused = false;
        self.state.ends_at = Some(now + self.state.remaining_ms);
        self.push(now, &mut out);
        out
    }

    pub fn skip(&mut self, now: i64, cfg: &Cfg) -> Vec<Effect> {
        let mut out = Vec::new();
        self.next(now, cfg, &mut out);
        out
    }

    pub fn stop(&mut self, now: i64) -> Vec<Effect> {
        let mut out = Vec::new();
        if self.state.phase != Phase::Idle {
            self.state = State::IDLE;
            self.push(now, &mut out);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    const CFG: Cfg = Cfg { focus_min: 25, break_min: 5, long_break_min: 15, cycles_before_long: 2 };

    fn reminders(e: &[Effect]) -> Vec<&'static str> {
        e.iter().filter_map(|x| if let Effect::Reminder { kind, .. } = x { Some(*kind) } else { None }).collect()
    }
    fn last_state(e: &[Effect]) -> State {
        e.iter().rev().find_map(|x| if let Effect::State(s) = x { Some(s.clone()) } else { None }).unwrap()
    }

    #[test]
    fn full_cycle_with_long_break_and_done() {
        let mut p = PomodoroEngine::new();
        let mut t = 1_000_000;
        let e = p.start(t, &CFG);
        assert_eq!(reminders(&e), vec!["pomodoro-focus"]);
        let s = last_state(&e);
        assert_eq!((s.phase, s.cycle, s.ends_at), (Phase::Focus, 1, Some(t + 25 * MIN)));
        // running tick pushes state, no reminder
        t += 1000;
        let e = p.tick(t, &CFG);
        assert!(reminders(&e).is_empty());
        assert_eq!(last_state(&e).remaining_ms, 25 * MIN - 1000);
        // focus 1 -> short break
        t = 1_000_000 + 25 * MIN;
        let e = p.tick(t, &CFG);
        assert_eq!(reminders(&e), vec!["pomodoro-break"]);
        assert_eq!(last_state(&e).phase, Phase::Break);
        // break -> focus round 2
        t += 5 * MIN;
        let e = p.tick(t, &CFG);
        assert_eq!(reminders(&e), vec!["pomodoro-focus"]);
        assert_eq!((last_state(&e).phase, last_state(&e).cycle), (Phase::Focus, 2));
        // focus 2 -> long break (cyclesBeforeLong = 2)
        t += 25 * MIN;
        let e = p.tick(t, &CFG);
        assert_eq!(last_state(&e).phase, Phase::LongBreak);
        assert_eq!(last_state(&e).remaining_ms, 15 * MIN);
        // long break end -> idle + done
        t += 15 * MIN;
        let e = p.tick(t, &CFG);
        assert_eq!(reminders(&e), vec!["pomodoro-done"]);
        assert_eq!(last_state(&e), State::IDLE);
        assert!(p.tick(t + 1000, &CFG).is_empty());
        assert!(!p.is_running());
    }

    #[test]
    fn pause_resume_skip_stop() {
        let mut p = PomodoroEngine::new();
        let t = 5_000;
        p.start(t, &CFG);
        let e = p.pause(t + 10 * MIN);
        let s = last_state(&e);
        assert!(s.paused);
        assert_eq!((s.ends_at, s.remaining_ms), (None, 15 * MIN));
        // paused: ticks are silent and time does not elapse
        assert!(p.tick(t + 60 * MIN, &CFG).is_empty());
        assert!(p.pause(t + 61 * MIN).is_empty());
        let e = p.resume(t + 70 * MIN);
        let s = last_state(&e);
        assert!(!s.paused);
        assert_eq!(s.ends_at, Some(t + 85 * MIN));
        // skip focus -> break, skip break -> focus 2
        let e = p.skip(t + 71 * MIN, &CFG);
        assert_eq!(last_state(&e).phase, Phase::Break);
        let e = p.skip(t + 71 * MIN, &CFG);
        assert_eq!((last_state(&e).phase, last_state(&e).cycle), (Phase::Focus, 2));
        // stop -> idle, no reminder; stop/pause/resume/skip when idle are no-ops
        let e = p.stop(t + 72 * MIN);
        assert!(reminders(&e).is_empty());
        assert_eq!(last_state(&e), State::IDLE);
        assert!(p.stop(0).is_empty() && p.pause(0).is_empty() && p.resume(0).is_empty() && p.skip(0, &CFG).is_empty());
        // start is ignored while running
        p.start(0, &CFG);
        assert!(p.start(1, &CFG).is_empty());
    }

    #[test]
    fn json_shape_matches_ts() {
        let j = State::IDLE.to_json();
        assert_eq!(j, json!({"phase":"idle","endsAt":null,"cycle":0,"paused":false,"remainingMs":0}));
        let c = Cfg::from_settings(&json!({"pomodoro":{"focusMin":50,"breakMin":10,"longBreakMin":30,"cyclesBeforeLong":3}}));
        assert_eq!((c.focus_min, c.cycles_before_long), (50, 3));
    }
}

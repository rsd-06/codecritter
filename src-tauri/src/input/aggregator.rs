//! Pure input aggregator. Stores only timestamps/counts, NEVER key identities. Fixed ring buffers,
//! so no allocation on the event hot path. Times are milliseconds (any monotonic origin).

const KEY_WINDOW_MS: f64 = 1000.0;
const BURST_MS: f64 = 150.0;
const MOUSE_WINDOW_MS: f64 = 200.0;
const RING: usize = 512;
const CLICK_RING: usize = 64;

/// Mirrors the TS `InputSample` (serialised camelCase by the caller).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub keys_per_sec: u32,
    pub key_burst: bool,
    pub scroll_delta: f64,
    pub mouse_speed: f64,
    /// Mouse button presses in the last second (a count only; which button is never recorded).
    pub clicks_per_sec: u32,
    pub idle_ms: f64,
}

pub struct InputAggregator {
    keys: [f64; RING],
    key_head: usize,
    key_count: usize,
    wheel: f64,
    clicks: [f64; CLICK_RING],
    click_head: usize,
    click_count: usize,
    last_input: f64,
    last_xy: Option<(f64, f64)>,
    mt: [f64; RING],
    md: [f64; RING],
    m_head: usize,
    m_count: usize,
    last_emit: Option<Sample>,
    last_emit_at: f64,
    heartbeat_ms: f64,
    idle_heartbeat_ms: f64,
}

impl InputAggregator {
    pub fn new(now: f64, heartbeat_ms: f64, idle_heartbeat_ms: f64) -> Self {
        Self {
            keys: [0.0; RING],
            key_head: 0,
            key_count: 0,
            wheel: 0.0,
            clicks: [0.0; CLICK_RING],
            click_head: 0,
            click_count: 0,
            last_input: now,
            last_xy: None,
            mt: [0.0; RING],
            md: [0.0; RING],
            m_head: 0,
            m_count: 0,
            last_emit: None,
            last_emit_at: f64::NEG_INFINITY,
            heartbeat_ms,
            idle_heartbeat_ms,
        }
    }

    pub fn key_down(&mut self, now: f64) {
        self.keys[self.key_head] = now;
        self.key_head = (self.key_head + 1) % RING;
        if self.key_count < RING {
            self.key_count += 1;
        }
        self.last_input = now;
    }

    pub fn click(&mut self, now: f64) {
        self.clicks[self.click_head] = now;
        self.click_head = (self.click_head + 1) % CLICK_RING;
        if self.click_count < CLICK_RING {
            self.click_count += 1;
        }
        self.last_input = now;
    }

    pub fn wheel_event(&mut self, rotation: f64, now: f64) {
        self.wheel += rotation;
        self.last_input = now;
    }

    pub fn mouse_move(&mut self, x: f64, y: f64, now: f64) {
        if let Some((lx, ly)) = self.last_xy {
            let d = (x - lx).hypot(y - ly);
            if d > 0.0 {
                self.mt[self.m_head] = now;
                self.md[self.m_head] = d;
                self.m_head = (self.m_head + 1) % RING;
                if self.m_count < RING {
                    self.m_count += 1;
                }
                self.last_input = now;
            }
        }
        self.last_xy = Some((x, y));
    }

    /// Current aggregate view. Consumes the wheel accumulator.
    pub fn sample(&mut self, now: f64) -> Sample {
        let mut kps = 0u32;
        let mut burst = false;
        for i in 0..self.key_count {
            let age = now - self.keys[(self.key_head + RING - 1 - i) % RING];
            if age > KEY_WINDOW_MS {
                break;
            }
            kps += 1;
            if age <= BURST_MS {
                burst = true;
            }
        }
        let mut cps = 0u32;
        for i in 0..self.click_count {
            let age = now - self.clicks[(self.click_head + CLICK_RING - 1 - i) % CLICK_RING];
            if age > KEY_WINDOW_MS {
                break;
            }
            cps += 1;
        }
        let mut dist = 0.0;
        for i in 0..self.m_count {
            let idx = (self.m_head + RING - 1 - i) % RING;
            if now - self.mt[idx] > MOUSE_WINDOW_MS {
                break;
            }
            dist += self.md[idx];
        }
        let scroll_delta = self.wheel;
        self.wheel = 0.0;
        Sample {
            keys_per_sec: kps,
            key_burst: burst,
            scroll_delta,
            mouse_speed: (dist * 1000.0 / MOUSE_WINDOW_MS).round(),
            clicks_per_sec: cps,
            idle_ms: (now - self.last_input).max(0.0),
        }
    }

    /// A sample to send, or None when there is nothing to say. Sends on change (idleMs excluded), then
    /// a slow heartbeat so the renderer can extrapolate idleMs: `heartbeat_ms` while recently active,
    /// `idle_heartbeat_ms` once quiet.
    pub fn tick(&mut self, now: f64) -> Option<Sample> {
        let s = self.sample(now);
        let quiet = s.keys_per_sec == 0 && s.clicks_per_sec == 0 && s.scroll_delta == 0.0 && s.mouse_speed == 0.0 && !s.key_burst;
        let changed = match &self.last_emit {
            None => true,
            Some(p) => {
                p.keys_per_sec != s.keys_per_sec
                    || p.key_burst != s.key_burst
                    || s.scroll_delta != 0.0
                    || p.scroll_delta != 0.0
                    || p.mouse_speed != s.mouse_speed
                    || p.clicks_per_sec != s.clicks_per_sec
            }
        };
        let hb = if quiet && s.idle_ms > 5000.0 { self.idle_heartbeat_ms } else { self.heartbeat_ms };
        if changed || now - self.last_emit_at >= hb {
            self.last_emit = Some(s);
            self.last_emit_at = now;
            return Some(s);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agg() -> InputAggregator {
        InputAggregator::new(0.0, 1000.0, 10000.0)
    }

    #[test]
    fn counts_keys_per_second_and_flags_burst() {
        let mut a = agg();
        let mut t = 0.0;
        while t < 1000.0 {
            a.key_down(t);
            t += 100.0;
        }
        let s = a.sample(1100.0);
        assert_eq!(s.keys_per_sec, 9);
        assert!(!s.key_burst);
        a.key_down(1050.0);
        assert!(a.sample(1100.0).key_burst);
        assert_eq!(a.sample(2500.0).keys_per_sec, 0);
    }

    #[test]
    fn sums_wheel_since_last_sample() {
        let mut a = agg();
        a.wheel_event(3.0, 10.0);
        a.wheel_event(-1.0, 20.0);
        assert_eq!(a.sample(30.0).scroll_delta, 2.0);
        assert_eq!(a.sample(40.0).scroll_delta, 0.0);
    }

    #[test]
    fn small_precision_touchpad_deltas_accumulate_not_round_away() {
        let mut a = agg();
        for i in 0..8 {
            a.wheel_event(0.125, i as f64 * 5.0); // +-15 / 120
        }
        assert!((a.sample(100.0).scroll_delta - 1.0).abs() < 1e-9);
        a.wheel_event(-0.25, 110.0);
        assert!(a.sample(150.0).scroll_delta < 0.0);
    }

    #[test]
    fn a_short_scroll_burst_is_emitted_once_then_a_zero_follows() {
        let mut a = agg();
        assert!(a.tick(0.0).is_some());
        a.wheel_event(0.125, 120.0);
        let s = a.tick(150.0).expect("scroll emits");
        assert!(s.scroll_delta > 0.0);
        let z = a.tick(250.0).expect("the return to zero emits so the brain sees it ended");
        assert_eq!(z.scroll_delta, 0.0);
        assert!(a.tick(350.0).is_none());
    }

    #[test]
    fn counts_clicks_in_the_last_second_and_emits_on_change() {
        let mut a = agg();
        assert!(a.tick(0.0).is_some());
        for i in 0..6 {
            a.click(100.0 + i as f64 * 100.0);
        }
        assert_eq!(a.sample(700.0).clicks_per_sec, 6);
        assert!(a.tick(700.0).is_some());
        assert_eq!(a.sample(1250.0).clicks_per_sec, 4);
        assert_eq!(a.sample(3000.0).clicks_per_sec, 0);
    }

    #[test]
    fn mouse_speed_over_200ms_and_decays() {
        let mut a = agg();
        a.mouse_move(0.0, 0.0, 0.0);
        a.mouse_move(30.0, 40.0, 100.0);
        assert_eq!(a.sample(150.0).mouse_speed, 250.0);
        assert_eq!(a.sample(500.0).mouse_speed, 0.0);
    }

    #[test]
    fn tracks_idle_ms() {
        let mut a = agg();
        a.key_down(100.0);
        assert_eq!(a.sample(600.0).idle_ms, 500.0);
    }

    #[test]
    fn emits_on_change_silent_when_quiet_slow_heartbeat_when_idle() {
        let mut a = agg();
        assert!(a.tick(0.0).is_some());
        assert!(a.tick(100.0).is_none());
        a.key_down(150.0);
        assert!(a.tick(200.0).is_some());
        assert!(a.tick(300.0).is_none());
        assert!(a.tick(1300.0).is_some());
        assert!(a.tick(2000.0).is_none());
        assert!(a.tick(6500.0).is_none());
        assert!(a.tick(11400.0).is_some());
    }

    #[test]
    fn ring_wraps_without_panic() {
        let mut a = agg();
        for i in 0..2000 {
            a.key_down(i as f64);
            a.mouse_move(i as f64, 0.0, i as f64);
        }
        assert!(a.sample(2000.0).keys_per_sec <= 512);
    }
}

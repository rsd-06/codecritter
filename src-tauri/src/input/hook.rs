//! rdev listener thread. The callback only touches the aggregator (a few stores under a mutex);
//! key identities are never read, only the fact that a key went down.

use super::aggregator::InputAggregator;
use parking_lot::Mutex;
use rdev::EventType;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Instant,
};

/// Starts the listener; the returned flag becomes true if the hook could not start / died.
pub fn start(agg: Arc<Mutex<InputAggregator>>, t0: Instant) -> Arc<AtomicBool> {
    let failed = Arc::new(AtomicBool::new(false));
    let flag = failed.clone();
    let spawned = thread::Builder::new().name("critter-input-hook".into()).spawn(move || {
        let res = rdev::listen(move |ev| {
            let now = t0.elapsed().as_secs_f64() * 1000.0;
            if !matches!(ev.event_type, EventType::KeyRelease(_) | EventType::ButtonRelease(_)) {
                crate::scheduler::note_input_activity();
            }
            match ev.event_type {
                EventType::KeyPress(_) => agg.lock().key_down(now),
                // rdev: positive delta_y = wheel up; the contract is +down.
                EventType::Wheel { delta_y, .. } => agg.lock().wheel_event(-(delta_y as f64), now),
                EventType::MouseMove { x, y } => agg.lock().mouse_move(x, y, now),
                _ => {}
            }
        });
        let why = match res {
            Ok(()) => "listener returned".to_string(),
            Err(e) => format!("{e:?}"),
        };
        eprintln!("[critter] input hook unavailable ({why}); cursor-only fallback");
        flag.store(true, Ordering::Relaxed);
    });
    if spawned.is_err() {
        eprintln!("[critter] input hook thread failed to spawn; cursor-only fallback");
        failed.store(true, Ordering::Relaxed);
    }
    failed
}

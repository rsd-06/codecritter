//! OS-specific glue kept out of the shared modules. Only Linux has code here today.

#[cfg(target_os = "linux")]
pub mod linux;

/// True while the optional evdev input backend (Linux, `evdev` feature, opted in) is delivering counts;
/// the rdev hook then ignores key / button / wheel events so nothing is counted twice.
pub fn evdev_active() -> bool {
    #[cfg(all(target_os = "linux", feature = "evdev"))]
    {
        linux::evdev::ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(all(target_os = "linux", feature = "evdev")))]
    {
        false
    }
}

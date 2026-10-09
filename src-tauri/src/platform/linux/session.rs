//! Session / backend detection. Pure functions over an `Env` snapshot so they are unit-testable.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Session {
    X11,
    Wayland,
    Unknown,
}

#[derive(Clone, Debug, Default)]
pub struct Env {
    pub xdg_session_type: Option<String>,
    pub wayland_display: Option<String>,
    pub display: Option<String>,
    pub gdk_backend: Option<String>,
    /// `CRITTER_WAYLAND=1`: the user wants the native Wayland backend (limited: no positioning / always-on-top).
    pub critter_wayland: bool,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

impl Env {
    pub fn from_process() -> Env {
        Env {
            xdg_session_type: var("XDG_SESSION_TYPE"),
            wayland_display: var("WAYLAND_DISPLAY"),
            display: var("DISPLAY"),
            gdk_backend: var("GDK_BACKEND"),
            critter_wayland: var("CRITTER_WAYLAND").map_or(false, |v| v != "0"),
        }
    }
}

/// The desktop session type (not the GDK backend we end up using).
pub fn session(env: &Env) -> Session {
    match env.xdg_session_type.as_deref() {
        Some("wayland") => Session::Wayland,
        Some("x11") => Session::X11,
        _ if env.wayland_display.is_some() => Session::Wayland,
        _ if env.display.is_some() => Session::X11,
        _ => Session::Unknown,
    }
}

/// Run GTK through XWayland: only when a Wayland session also offers an X display, the user did not pick a
/// backend (GDK_BACKEND) and did not opt in to native Wayland (CRITTER_WAYLAND=1).
pub fn should_force_x11(env: &Env) -> bool {
    !env.critter_wayland && env.gdk_backend.is_none() && env.wayland_display.is_some() && env.display.is_some()
}

pub fn current() -> Session {
    session(&Env::from_process())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(t: Option<&str>, w: Option<&str>, d: Option<&str>) -> Env {
        Env {
            xdg_session_type: t.map(String::from),
            wayland_display: w.map(String::from),
            display: d.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn detects_session_type() {
        assert_eq!(session(&env(Some("wayland"), Some("wayland-0"), Some(":0"))), Session::Wayland);
        assert_eq!(session(&env(Some("x11"), None, Some(":0"))), Session::X11);
        assert_eq!(session(&env(None, Some("wayland-0"), None)), Session::Wayland);
        assert_eq!(session(&env(None, None, Some(":1"))), Session::X11);
        assert_eq!(session(&env(None, None, None)), Session::Unknown);
    }

    #[test]
    fn forces_xwayland_only_when_sensible() {
        assert!(should_force_x11(&env(Some("wayland"), Some("wayland-0"), Some(":0"))));
        assert!(!should_force_x11(&env(Some("x11"), None, Some(":0"))));
        // no XWayland available: nothing to fall back to
        assert!(!should_force_x11(&env(Some("wayland"), Some("wayland-0"), None)));
        let mut e = env(Some("wayland"), Some("wayland-0"), Some(":0"));
        e.critter_wayland = true;
        assert!(!should_force_x11(&e));
        let mut e = env(Some("wayland"), Some("wayland-0"), Some(":0"));
        e.gdk_backend = Some("wayland".into());
        assert!(!should_force_x11(&e));
    }
}

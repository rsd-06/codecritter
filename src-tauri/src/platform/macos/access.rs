//! Input Monitoring permission (needed by the listen-only CGEventTap in `input`). The tap only ever
//! counts events; key codes are never read. Checking the permission is a plain query and never prompts.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    Granted,
    Denied,
}

impl Access {
    pub fn as_str(self) -> &'static str {
        match self {
            Access::Granted => "granted",
            Access::Denied => "denied",
        }
    }
}

/// System Settings deep link for Privacy & Security > Input Monitoring (works on macOS 13+).
pub const SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";

#[cfg(target_os = "macos")]
mod ffi {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightListenEventAccess() -> bool;
        pub fn CGRequestListenEventAccess() -> bool;
    }
}

/// Current permission. Never prompts.
#[cfg(target_os = "macos")]
pub fn state() -> Access {
    // SAFETY: argument-free CoreGraphics query.
    if unsafe { ffi::CGPreflightListenEventAccess() } {
        Access::Granted
    } else {
        Access::Denied
    }
}

/// Shows the system prompt (once per app identity; afterwards macOS only lists the app in the pane)
/// and registers CodeCritter in the Input Monitoring list so the user can just flip the switch.
#[cfg(target_os = "macos")]
pub fn request() {
    // SAFETY: argument-free CoreGraphics call; the return value only says whether access is already granted.
    let _ = unsafe { ffi::CGRequestListenEventAccess() };
}

#[cfg(target_os = "macos")]
pub fn open_settings() {
    if let Err(e) = std::process::Command::new("open").arg(SETTINGS_URL).spawn() {
        eprintln!("[macos] could not open System Settings: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_match_the_ts_contract() {
        assert_eq!(Access::Granted.as_str(), "granted");
        assert_eq!(Access::Denied.as_str(), "denied");
        assert!(SETTINGS_URL.starts_with("x-apple.systempreferences:"));
        assert!(SETTINGS_URL.ends_with("Privacy_ListenEvent"));
    }
}

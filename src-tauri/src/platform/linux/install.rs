//! How this copy was installed. AppImages can self-update; distro packages (.deb / .rpm / AUR) cannot.
//!
//! The releases page shown to the user is NOT duplicated here: `updater::RELEASES_PAGE` is the single
//! source of truth, and it matches `plugins.updater.endpoints` in tauri.conf.json.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallKind {
    AppImage,
    Package,
}

/// Pure: the AppImage runtime exports `APPIMAGE` (path of the .AppImage file).
pub fn kind_from(appimage_env: Option<&str>) -> InstallKind {
    match appimage_env {
        Some(p) if !p.is_empty() => InstallKind::AppImage,
        _ => InstallKind::Package,
    }
}

pub fn kind() -> InstallKind {
    kind_from(std::env::var("APPIMAGE").ok().as_deref())
}

/// Whether the in-app updater may download + install (AppImage only).
pub fn can_self_update() -> bool {
    kind() == InstallKind::AppImage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appimage_detected_by_env() {
        assert_eq!(kind_from(Some("/home/u/CodeCritter.AppImage")), InstallKind::AppImage);
        assert_eq!(kind_from(Some("")), InstallKind::Package);
        assert_eq!(kind_from(None), InstallKind::Package);
    }

    /// Only an AppImage may replace itself; everything else is the package manager's job. Drives
    /// `updater::status().manualInstall`, so the two must never disagree.
    #[test]
    fn self_update_is_appimage_only() {
        assert!(!can_self_update_for(None));
        assert!(!can_self_update_for(Some("")));
        assert!(can_self_update_for(Some("/opt/CodeCritter.AppImage")));
    }

    fn can_self_update_for(appimage: Option<&str>) -> bool {
        kind_from(appimage) == InstallKind::AppImage
    }
}

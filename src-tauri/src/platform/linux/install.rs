//! How this copy was installed. AppImages can self-update; distro packages (.deb / .rpm / AUR) cannot.

pub const RELEASES_URL: &str = "https://github.com/rsd-06/codecritter/releases/latest";

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
}

//! XDG autostart: `~/.config/autostart/codecritter.desktop`. Written by hand (the plugin's Linux path
//! points at the AppImage mount, which changes every run).

use std::path::{Path, PathBuf};

const FILE: &str = "codecritter.desktop";

/// Quote one argument for a .desktop `Exec=` line (Desktop Entry spec, "The Exec key").
pub fn quote_exec_arg(arg: &str) -> String {
    let mut out = String::from("\"");
    for c in arg.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The program to start at login: the .AppImage file when running from one, else this executable.
pub fn exec_target(appimage: Option<&str>, current_exe: &Path) -> String {
    match appimage {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => current_exe.to_string_lossy().into_owned(),
    }
}

pub fn desktop_entry(exec_path: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=CodeCritter\nComment=Pixel desktop companion for developers\n\
         Exec={}\nIcon=codecritter\nTerminal=false\nCategories=Development;\nX-GNOME-Autostart-enabled=true\n\
         X-GNOME-Autostart-Delay=5\n",
        quote_exec_arg(exec_path)
    )
}

fn entry_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("autostart").join(FILE))
}

pub fn apply(enabled: bool) {
    let Some(path) = entry_path() else { return };
    if !enabled {
        let _ = std::fs::remove_file(&path);
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let want = desktop_entry(&exec_target(std::env::var("APPIMAGE").ok().as_deref(), &exe));
    if std::fs::read_to_string(&path).map_or(false, |cur| cur == want) {
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&path, want) {
        eprintln!("[autostart] {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_quoting_escapes_specials() {
        assert_eq!(quote_exec_arg("/opt/Code Critter/app"), "\"/opt/Code Critter/app\"");
        assert_eq!(quote_exec_arg("a\"b$c`d\\e%f"), "\"a\\\"b\\$c\\`d\\\\e%%f\"");
    }

    #[test]
    fn appimage_path_wins_over_current_exe() {
        let exe = Path::new("/tmp/.mount_x/usr/bin/codecritter");
        assert_eq!(exec_target(Some("/home/u/CC.AppImage"), exe), "/home/u/CC.AppImage");
        assert_eq!(exec_target(None, exe), "/tmp/.mount_x/usr/bin/codecritter");
    }

    #[test]
    fn entry_has_required_keys() {
        let e = desktop_entry("/usr/bin/codecritter");
        assert!(e.starts_with("[Desktop Entry]\n"));
        assert!(e.contains("Type=Application\n"));
        assert!(e.contains("Exec=\"/usr/bin/codecritter\"\n"));
        assert!(e.contains("Terminal=false\n"));
    }
}

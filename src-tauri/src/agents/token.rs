//! Shared secret + port file under `<home>/.codecritter` (same files/format as the Electron app).

use rand::{rngs::OsRng, RngCore};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `<home>/.codecritter`
pub fn critter_dir(home: &Path) -> PathBuf {
    home.join(".codecritter")
}

pub fn token_path(home: &Path) -> PathBuf {
    critter_dir(home).join("token")
}

pub fn port_path(home: &Path) -> PathBuf {
    critter_dir(home).join("port")
}

fn read_trimmed(path: &Path) -> Option<String> {
    let s = fs::read_to_string(path).ok()?;
    let s = s.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn write_private(path: &Path, content: &str) -> std::io::Result<()> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(content.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Returns the token, creating `<home>/.codecritter/token` (32 random bytes, hex, mode 0600
/// where the OS supports it) when missing or empty.
pub fn ensure_token(home: &Path) -> std::io::Result<String> {
    if let Some(t) = read_trimmed(&token_path(home)) {
        return Ok(t);
    }
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    fs::create_dir_all(critter_dir(home))?;
    write_private(&token_path(home), &format!("{token}\n"))?;
    Ok(token)
}

/// Records the port the server actually bound (may differ from the default after fallback).
pub fn write_port_file(port: u16, home: &Path) -> std::io::Result<()> {
    fs::create_dir_all(critter_dir(home))?;
    write_private(&port_path(home), &format!("{port}\n"))
}

#[derive(Debug, PartialEq, Eq)]
pub struct CritterConfig {
    pub token: Option<String>,
    pub port: Option<u16>,
}

pub fn read_config(home: &Path) -> CritterConfig {
    let token = read_trimmed(&token_path(home));
    let port = read_trimmed(&port_path(home))
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n > 0 && *n < 65536)
        .map(|n| n as u16);
    CritterConfig { token, port }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::testutil::TempDir;

    #[test]
    fn creates_64_hex_token_and_reuses_it() {
        let home = TempDir::new("token");
        let t = ensure_token(home.path()).unwrap();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(ensure_token(home.path()).unwrap(), t);
        assert_eq!(fs::read_to_string(token_path(home.path())).unwrap().trim(), t);
    }

    #[cfg(unix)]
    #[test]
    fn uses_mode_0600_on_posix() {
        use std::os::unix::fs::PermissionsExt;
        let home = TempDir::new("token-mode");
        ensure_token(home.path()).unwrap();
        let m = fs::metadata(token_path(home.path())).unwrap().permissions().mode() & 0o777;
        assert_eq!(m, 0o600);
    }

    #[test]
    fn regenerates_when_file_is_empty() {
        let home = TempDir::new("token-empty");
        ensure_token(home.path()).unwrap();
        fs::write(token_path(home.path()), "  \n").unwrap();
        assert_eq!(ensure_token(home.path()).unwrap().len(), 64);
    }

    #[test]
    fn read_config_reads_token_and_port_tolerating_absence() {
        let home = TempDir::new("token-cfg");
        assert_eq!(read_config(home.path()), CritterConfig { token: None, port: None });
        let t = ensure_token(home.path()).unwrap();
        write_port_file(47627, home.path()).unwrap();
        assert_eq!(read_config(home.path()), CritterConfig { token: Some(t), port: Some(47627) });
        fs::write(port_path(home.path()), "garbage").unwrap();
        assert_eq!(read_config(home.path()).port, None);
        fs::write(port_path(home.path()), "70000").unwrap();
        assert_eq!(read_config(home.path()).port, None);
    }
}

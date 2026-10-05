//! Settings export/import + sync-folder mirroring (port of src/main/sync.ts).
//! The synced file (`<folder>/codecritter-settings.json`) excludes position, syncFolder and agents.token;
//! import/pull keeps those (and agents.port) local. A background thread (500 ms loop, no busy wait)
//! debounces writes by 2 s and polls the file's mtime every 2 s; our own writes are ignored by content hash.

use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub const SYNC_FILE: &str = "codecritter-settings.json";
const WRITE_DEBOUNCE: Duration = Duration::from_secs(2);
const POLL_EVERY: Duration = Duration::from_secs(2);

/// Settings that travel between machines: everything except machine-local bits.
pub fn to_syncable(s: &Value) -> Value {
    let mut o = s.clone();
    o["position"] = Value::Null;
    o["syncFolder"] = Value::Null;
    if let Some(a) = o.get_mut("agents").and_then(Value::as_object_mut) {
        a.insert("token".into(), json!(""));
    }
    o
}

pub fn serialize_syncable(s: &Value) -> String {
    serde_json::to_string_pretty(&to_syncable(s)).unwrap_or_default()
}

pub fn hash_text(t: &str) -> u64 {
    let mut h = DefaultHasher::new();
    t.hash(&mut h);
    h.finish()
}

/// Merge imported JSON text onto `current`, keeping position/token/syncFolder/port local.
pub fn merge_imported(text: &str, current: &Value) -> Option<Value> {
    // Editors / PowerShell often save UTF-8 with a BOM; serde_json rejects it.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let raw: Value = serde_json::from_str(text).ok()?;
    if !raw.is_object() {
        return None;
    }
    let mut next = crate::store::load_from(raw);
    next["position"] = current["position"].clone();
    next["syncFolder"] = current["syncFolder"].clone();
    next["agents"]["token"] = current["agents"]["token"].clone();
    next["agents"]["port"] = current["agents"]["port"].clone();
    Some(next)
}

/// Folder mirroring state machine (no threads, no tauri: unit-testable).
#[derive(Default)]
pub struct Core {
    folder: Option<PathBuf>,
    last_hash: Option<u64>,
}

impl Core {
    pub fn file(&self) -> Option<PathBuf> {
        self.folder.as_ref().map(|f| f.join(SYNC_FILE))
    }

    /// Write our settings unless identical to the last text written/seen. Returns true if written.
    pub fn write_now(&mut self, settings: &Value) -> bool {
        let Some(file) = self.file() else { return false };
        let text = serialize_syncable(settings);
        let h = hash_text(&text);
        if self.last_hash == Some(h) {
            return false;
        }
        self.last_hash = Some(h); // set first so our own fs change is ignored
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, &text).and_then(|_| std::fs::rename(&tmp, &file)).is_err() {
            self.last_hash = None;
            return false;
        }
        true
    }

    /// Settings to apply from file `text`, or None (own write, unchanged, or invalid).
    pub fn pull(&mut self, text: &str, current: &Value) -> Option<Value> {
        let h = hash_text(text);
        if self.last_hash == Some(h) {
            return None;
        }
        self.last_hash = Some(h);
        let next = merge_imported(text, current)?;
        if serialize_syncable(&next) == serialize_syncable(current) {
            return None;
        }
        Some(next)
    }

    /// (Re)point at a folder (None stops). Pulls an existing file first, else writes ours.
    pub fn set_folder(&mut self, folder: Option<PathBuf>, current: &Value) -> Option<Value> {
        self.folder = folder;
        self.last_hash = None;
        let file = self.file()?;
        if std::fs::create_dir_all(file.parent()?).is_err() {
            return None;
        }
        match std::fs::read_to_string(&file) {
            Ok(t) => self.pull(&t, current),
            Err(_) => {
                self.write_now(current);
                None
            }
        }
    }
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

struct Runtime {
    core: Core,
    write_due: Option<Instant>,
    last_mtime: Option<SystemTime>,
    last_poll: Instant,
}

static RT: OnceLock<Mutex<Runtime>> = OnceLock::new();

fn rt() -> &'static Mutex<Runtime> {
    RT.get_or_init(|| {
        Mutex::new(Runtime { core: Core::default(), write_due: None, last_mtime: None, last_poll: Instant::now() })
    })
}

fn configured_folder(app: &AppHandle) -> Option<PathBuf> {
    crate::store::get_ptr(app, "/syncFolder")
        .as_str()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// One loop iteration: re-point on folder change, flush debounced write, poll mtime. Applies outside the lock.
fn step(app: &AppHandle) {
    let want = configured_folder(app);
    let mut apply: Option<Value> = None;
    {
        let mut r = rt().lock();
        if r.core.folder != want {
            let cur = crate::store::get(app);
            apply = r.core.set_folder(want, &cur);
            r.write_due = None;
            r.last_mtime = r.core.file().and_then(|f| mtime(&f));
        } else if r.core.folder.is_some() {
            if r.write_due.is_some_and(|d| Instant::now() >= d) {
                r.write_due = None;
                let cur = crate::store::get(app);
                if r.core.write_now(&cur) {
                    r.last_mtime = r.core.file().and_then(|f| mtime(&f));
                }
            }
            if r.last_poll.elapsed() >= POLL_EVERY {
                r.last_poll = Instant::now();
                if let Some(file) = r.core.file() {
                    let m = mtime(&file);
                    if m != r.last_mtime {
                        r.last_mtime = m;
                        if let Ok(t) = std::fs::read_to_string(&file) {
                            let cur = crate::store::get(app);
                            apply = r.core.pull(&t, &cur);
                        }
                    }
                }
            }
        }
    }
    if let Some(next) = apply {
        crate::store::update(app, next);
    }
}

/// Start the sync-folder watcher thread for `settings.syncFolder`.
pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("sync".into())
        .spawn(move || loop {
            step(&app);
            std::thread::sleep(Duration::from_millis(500));
        })
        .ok();
}

/// Called by `store::update` on every settings change: schedule a debounced push to the folder.
pub fn on_settings_changed(_app: &AppHandle) {
    let mut r = rt().lock();
    if r.core.folder.is_some() {
        r.write_due = Some(Instant::now() + WRITE_DEBOUNCE);
    }
}

/// Ask for a save path, write settings, return the path. Called from a blocking thread. None = cancelled.
pub fn export(app: &AppHandle) -> Option<String> {
    let path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(SYNC_FILE)
        .blocking_save_file()?
        .into_path()
        .ok()?;
    let text = serialize_syncable(&crate::store::get(app));
    std::fs::write(&path, text).ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// Ask for a file, validate, apply via `store::update`. false = cancelled/invalid.
pub fn import(app: &AppHandle) -> bool {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(path) else { return false };
    match merge_imported(&text, &crate::store::get(app)) {
        Some(next) => {
            crate::store::update(app, next);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Value {
        crate::store::load_from(Value::Null)
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("critter-sync-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn strips_machine_local_data() {
        let mut s = base();
        s["position"] = json!({"displayId": 1, "x": 5, "y": 6});
        s["agents"]["token"] = json!("secret");
        s["syncFolder"] = json!("C:/x");
        let out: Value = serde_json::from_str(&serialize_syncable(&s)).unwrap();
        assert!(out["position"].is_null());
        assert_eq!(out["agents"]["token"], "");
        assert!(out["syncFolder"].is_null());
        assert_eq!(out["userName"], s["userName"]);
    }

    #[test]
    fn merge_keeps_local_and_rejects_junk() {
        let mut cur = base();
        cur["position"] = json!({"displayId": 0, "x": 1, "y": 2});
        cur["agents"]["token"] = json!("mine");
        cur["agents"]["port"] = json!(50000);
        cur["syncFolder"] = json!("D:/sync");
        let mut remote = base();
        remote["userName"] = json!("Remote");
        remote["agents"]["port"] = json!(1234);
        let m = merge_imported(&remote.to_string(), &cur).unwrap();
        assert_eq!(m["userName"], "Remote");
        assert_eq!(m["position"], cur["position"]);
        assert_eq!(m["agents"]["token"], "mine");
        assert_eq!(m["agents"]["port"], 50000);
        assert_eq!(m["syncFolder"], "D:/sync");
        assert!(merge_imported("nope", &cur).is_none());
        // a UTF-8 BOM (Notepad, PowerShell Set-Content -Encoding UTF8) must not break the import
        let bom = format!("\u{feff}{}", remote);
        assert_eq!(merge_imported(&bom, &cur).unwrap()["userName"], m["userName"]);
        assert!(merge_imported("[1]", &cur).is_none());
    }

    #[test]
    fn own_write_is_not_applied_back() {
        let dir = tmpdir("own");
        let mut cur = base();
        let mut c = Core::default();
        assert!(c.set_folder(Some(dir.clone()), &cur).is_none()); // no file -> we write ours
        assert!(dir.join(SYNC_FILE).exists());
        cur["userName"] = json!("Changed");
        assert!(c.write_now(&cur));
        assert!(!c.write_now(&cur)); // unchanged -> no rewrite
        let text = std::fs::read_to_string(dir.join(SYNC_FILE)).unwrap();
        assert!(c.pull(&text, &cur).is_none()); // fs event for our own write ignored by hash
        let disk: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(disk["userName"], "Changed");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn external_change_applied_once_and_existing_file_pulled() {
        let dir = tmpdir("ext");
        let mut remote = base();
        remote["userName"] = json!("Elsewhere");
        remote["position"] = json!({"displayId": 9, "x": 9, "y": 9});
        std::fs::write(dir.join(SYNC_FILE), serde_json::to_string(&remote).unwrap()).unwrap();
        let mut cur = base();
        cur["syncFolder"] = json!(dir.to_string_lossy());
        let mut c = Core::default();
        let applied = c.set_folder(Some(dir.clone()), &cur).expect("pulled existing file");
        assert_eq!(applied["userName"], "Elsewhere");
        assert!(applied["position"].is_null()); // local position kept (null here)
        cur = applied;
        // a later external edit applies once; the same text again does not
        let mut r2 = remote.clone();
        r2["userName"] = json!("Again");
        let t2 = serde_json::to_string(&r2).unwrap();
        let a = c.pull(&t2, &cur).expect("applied");
        assert_eq!(a["userName"], "Again");
        assert!(c.pull(&t2, &a).is_none());
        // junk is ignored
        assert!(c.pull("{not json", &a).is_none());
        // identical-settings text (different formatting) is not applied
        let same = serde_json::to_string(&to_syncable(&a)).unwrap().replace(",\"", ", \"");
        assert!(c.pull(&same, &a).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}

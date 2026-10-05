# Tauri port plan (v0.2)

Goal: replace the Electron shell (src/main, src/preload) with a Tauri v2 Rust shell to cut memory
(target: < 100 MB total working set on Windows, installer < 15 MB) with **zero renderer changes beyond
the bridge**. The TS contract in `src/shared/types.ts` (OverlayBridge, SettingsBridge, Settings, events)
is unchanged and remains binding. Electron code is preserved at git tag `electron-final`.

## Toolchain
Rust stable (RUSTUP_HOME=D:\dev-tools\rustup, CARGO_HOME=D:\dev-tools\cargo, on user PATH), MSVC Build
Tools present. Set CARGO_TARGET_DIR=D:\dev-cache\cargo-target for every cargo/tauri command (keeps the
repo and C: small). `@tauri-apps/cli` + `@tauri-apps/api` + plugins as npm devDeps/deps.

## Layout
```
src-tauri/
  Cargo.toml, tauri.conf.json, build.rs, capabilities/default.json, icons/ (from build/)
  src/main.rs            # thin: codecritter_lib::run()
  src/lib.rs             # builder: plugins, state, windows, tray, setup — owns module wiring
  src/state.rs           # AppState { settings: RwLock<Value>, paused, peeking, pomodoro handle ... }
  src/store.rs           # settings JSON in app_config_dir; deep-merge with embedded defaults.json; validate; emit
  src/windows.rs         # overlay (transparent, no decorations, always_on_top, skip_taskbar, focusable false,
                         #   shadow false) + settings window (lazy, destroyed on close); positioning/drag/scale
  src/tray.rs, src/shortcuts.rs, src/autostart.rs
  src/input/{mod,aggregator,hook}.rs   # rdev listener thread → aggregator (counts only) → emit critter:input
  src/cursor.rs          # adaptive poll (30 Hz near / 4 Hz far / off when hidden/peeking) → emit critter:cursor
  src/peek.rs            # Windows SHQueryUserNotificationState (windows crate); mac/linux: none for now
  src/agents/{mod,server,token,hookcmd}.rs + agents/installers/*.rs   # tiny_http loopback server, installers
  src/scheduler/{mod,reminders,pomodoro}.rs  # 1 s tick thread; pure logic w/ injectable clock + unit tests
  src/sync.rs            # export/import + sync folder (notify crate or 2 s mtime poll)
src/renderer/tauri-bridge.ts  # implements OverlayBridge + SettingsBridge with @tauri-apps/api (invoke/listen)
src/shared/defaults.json      # generated from defaults.ts by `npm run gen:defaults`; embedded via include_str!
```

## Bridge mapping (renderer ↔ Rust)
- Events Rust→webview use the existing IPC channel names from `src/shared/ipc.ts` as Tauri event names
  (replace ':' with '/' if Tauri rejects ':' — record in MEMORY.md). Payloads identical to TS types (serde camelCase).
- Commands webview→Rust: snake_case commands named after the IPC keys: `get_settings`, `set_settings(patch)`,
  `set_interactive(on)`, `drag_start`, `drag_move(dx,dy)`, `drag_end`, `open_settings`, `show_context_menu`,
  `pomodoro_cmd(cmd)`, `pomodoro_state`, `agent_status`, `install_agent(id)`, `uninstall_agent(id)`,
  `test_event(type)`, `test_reminder(kind)`, `export_settings`, `import_settings`.
- `getBridge()` order: `window.__TAURI_INTERNALS__` → TauriBridge; `window.critter` (Electron, legacy) → it; else MockBridge.

## Click-through (important difference)
Tauri's `set_ignore_cursor_events(true)` does not forward mouse moves to the page, so the renderer must
hit-test from **CursorSample** (screen coords + window bounds, already provided) instead of DOM pointermove:
when the cursor is over an opaque pixel → `set_interactive(true)`; otherwise false. While interactive, DOM
pointer events work normally (drag, right-click, petting). Cursor polling runs at 30 Hz while within 400 px.

## Phases
- T1 Foundation (1 agent): scaffold, all crate deps + module stubs with final signatures, store, windows,
  bridge, tray, shortcuts, autostart, overlay renders and is click-through w/ cursor hit-test. Memory measured.
- T2 (3 parallel agents, each owns only its module dirs): T2a input+cursor+peek · T2b agents server+installers
  (port TS tests to Rust tests) · T2c scheduler+pomodoro+sync.
- T3 Ship: tauri bundler (NSIS + MSI win, dmg mac, AppImage+deb linux), icons, CI (cargo test + npm test on 3
  OSes, Linux needs libwebkit2gtk-4.1-dev etc.), release workflow (tauri-action, draft), delete src/main +
  src/preload + Electron deps after parity, README/CONTRIBUTING/PLAN updates, final metrics.

## Module signatures (final, T1)
T2 agents fill bodies only; `lib.rs`, `store.rs`, `commands.rs`, `Cargo.toml` are T1-owned. Deps for every
module are already in `Cargo.toml` (rdev, tiny_http, rand, parking_lot, dirs, toml_edit, chrono,
`notify` via feature `notify-watch`, `windows` crate on Windows).

```rust
input::start(app: AppHandle)                       // T2a  src/input/mod.rs (+ aggregator.rs, hook.rs)
cursor::start(app: AppHandle)                      // T2a  src/cursor.rs (T1 has a minimal working poller)
peek::start(app: AppHandle)                        // T2a  src/peek.rs
peek::set_peek(app: &AppHandle, on: bool)          //      flips state, emits critter:peek, refreshes tray
agents::start(app: AppHandle)                      // T2b  src/agents/mod.rs (+ server, token, hookcmd, installers/)
agents::restart(app: &AppHandle)                   //      called by store::update when agents.enabled/port change
agents::status_all() -> serde_json::Value          //      { id: { installed, path } }
agents::install(id: &str) -> (bool, String)
agents::uninstall(id: &str) -> (bool, String)
scheduler::start(app: AppHandle)                   // T2c  src/scheduler/mod.rs (+ reminders, pomodoro)
scheduler::on_settings_changed(app: &AppHandle)    //      reminders/pomodoro/messages/dnd changed
scheduler::pomodoro_cmd(app: &AppHandle, cmd: &str) -> serde_json::Value   // start|pause|resume|skip|stop -> PomodoroState
scheduler::pomodoro_state(app: &AppHandle) -> serde_json::Value
scheduler::test_reminder(app: &AppHandle, kind: &str)
sync::start(app: AppHandle)                        // T2c  src/sync.rs
sync::on_settings_changed(app: &AppHandle)         //      EXTRA hook (not in the original plan), called on every settings change
sync::export(app: &AppHandle) -> Option<String>    //      blocking dialog inside; runs on a blocking thread
sync::import(app: &AppHandle) -> bool
```

Helpers available to modules: `crate::store::{get, get_ptr(app,"/peek/edge"), scale, update(app, patch)}` (update
persists, emits `critter:settings` to all windows and runs the hooks above), `crate::winmgr::{emit_overlay,
overlay, set_peek_position, open_settings, toggle_companion_visible}`, `crate::state::{is_paused, is_peeking,
is_hidden, set_paused}` and `AppState` via `app.state::<AppState>()`.

### Decisions / deviations recorded in T1
- **Event names:** Tauri v2 allows alphanumerics, `-`, `/`, `:` and `_`, so the IPC names (`critter:input`,
  `critter:cursor`, `critter:agent`, `critter:reminder`, `critter:pomodoro`, `critter:settings`, `critter:peek`)
  are used UNCHANGED (verified at runtime: cursor + settings events reach the overlay). Payloads are camelCase JSON
  matching `src/shared/types.ts`. `app.emit` reaches every window, `winmgr::emit_overlay` only the overlay.
- **CursorSample is in PHYSICAL screen pixels** (x, y, winX, winY, winW, winH from `outer_position/outer_size`).
  The renderer converts with `winW / innerWidth`, so no devicePixelRatio is needed. `cursor::start` must keep
  sampling while reactions are paused (the overlay hit-tests click-through from it); only stop when hidden.
- **Commands:** arg names in JS are camelCase (`{ patch }`, `{ on }`, `{ cmd }`, `{ id }`, `{ dx, dy }`), and
  `test_event` takes `{ kind }` (`type` is a Rust keyword). Extra commands: `open_external(url)` (https only, used by
  `window.open` in settings), `rebroadcast_settings`.
- **`windows.rs` is `winmgr.rs`**: a module called `windows` would shadow the `windows` crate used by peek.rs.
- **settings.position** stores PHYSICAL px with `displayId` always 0 (no stable monitor ids in Tauri); on restore the
  point is mapped to the monitor containing it and clamped to its work area. Window opacity is applied by the
  renderer (canvas CSS opacity); Tauri has no window-opacity API.
- Extra plugins beyond the plan: `tauri-plugin-single-instance` (2nd launch opens settings) and
  `tauri-plugin-opener` (external links). Autostart applies in release builds only.
- Webview memory flags: `winmgr::WEBVIEW2_ARGS` (Windows) disables the GPU process, limits renderers to 1, etc.

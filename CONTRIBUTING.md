# Contributing to CodeCritter

Thanks for helping! This is a small, friendly project. Bug reports, new characters, agent integrations and docs fixes are all welcome.

## Finding something to work on

- Look for issues labelled [`good first issue`](https://github.com/rsd-06/codecritter/labels/good%20first%20issue) or [`help wanted`](https://github.com/rsd-06/codecritter/labels/help%20wanted).
- Ideas and questions go in [Discussions](https://github.com/rsd-06/codecritter/discussions).
- Comment on an issue before starting so nobody duplicates work.
- Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Dev setup

Requirements: Node 22+, npm, Git, and a stable Rust toolchain ([rustup](https://rustup.rs)) plus the [Tauri platform prerequisites](https://tauri.app/start/prerequisites/) (MSVC Build Tools + WebView2 on Windows, Xcode CLT on macOS, `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev libxtst-dev` on Debian/Ubuntu). Python 3.10+ is only needed to regenerate image assets.

```sh
git clone https://github.com/rsd-06/codecritter.git
cd codecritter
npm ci
npm run dev        # tauri dev (first run compiles the Rust crate, a few minutes)
```

Disk tip: Rust build output is large (several GB with debug + release). Keep it out of the repo and off a tight system drive by setting `CARGO_TARGET_DIR` (for example `D:\dev-cache\cargo-target`), and `RUSTUP_HOME` / `CARGO_HOME` if you want the toolchain elsewhere. Also point `npm_config_cache` and `TEMP`/`TMP` somewhere roomy if C: is small (the repo ships no `.npmrc`). Never install anything globally.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `tauri dev`: the app with hot reload (Vite on :5175 + Rust shell) |
| `npm run playground` | The overlay in a plain browser with a mock bridge and buttons for every event (http://localhost:5174/playground/index.html); `/playground/gallery.html` shows expressions, poses, paws and props |
| `npm test` | Vitest unit tests (`npm run test:watch` for watch mode) |
| `npm run test:rust` | `cargo test` for the Rust shell (agents, installers, scheduler, input, sync) |
| `npm run typecheck` | `tsc` for node and web projects |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Front-end bundle only (`gen:defaults` + Vite into `dist-tauri/`) |
| `npm run dist` | `tauri build`: release exe + installers (NSIS and MSI on Windows) under `$CARGO_TARGET_DIR/release/bundle` |
| `npm run gen:defaults` | Regenerate `src/shared/defaults.json` (embedded by Rust) from `defaults.ts`; a test fails if it is stale |
| `npm run sprites:export` | Render every character frame to `tools/out/` using the real engine (Node, no browser) |
| `python tools/make_icons.py` | From the export: icons, tray PNGs, README gallery and GIFs (use `.venv`, needs Pillow) |

Before opening a PR run `npm run typecheck && npm test && npm run lint && npm run build && npm run test:rust`. `cargo test` needs the built front end (`dist-tauri/`), so run `npm run build` first.

Debug builds also have a self-test: `CRITTER_SELFTEST=1 codecritter.exe` (debug build, throwaway `APPDATA`/`USERPROFILE`) drives the tray/context-menu handlers, drag and the display re-clamp and prints PASS/FAIL.

## Architecture in five minutes

The binding contracts live in [docs/PLAN.md](docs/PLAN.md) (section 4 is the contract for `src/shared`); the Rust shell design is in [docs/TAURI_PLAN.md](docs/TAURI_PLAN.md). In short:

- `src-tauri/` - the Rust shell (Tauri 2): `winmgr.rs` (overlay + settings windows, drag, display re-clamp), `tray.rs` (tray and right-click menu), `shortcuts.rs`, `store.rs` (settings JSON), `input/` (rdev hook -> aggregated counts only), `cursor.rs`, `peek.rs`, `agents/` (loopback HTTP server, token, hook command, per-agent installers), `scheduler/` (reminders and Pomodoro), `sync.rs`, `commands.rs` (the webview-callable commands). Unit tests live next to the code (`cargo test`).
- `src/renderer/overlay` - the canvas app. `engine/` (pixel renderer, rig compiler, expressions, particles, bubbles, sound, scheduler), `characters/` (Stitch, Yoda rigs), `behavior/` (a pure, unit-tested state machine plus the driver that glues it to the engine). Only `bridge.ts` / `tauri-bridge.ts` touch Tauri, so the overlay runs in a browser (playground).
- `src/renderer/settings` - the React settings UI.
- `src/shared` - the TypeScript contract (types, IPC names, defaults).
- `bin/critter-hook.mjs` - the zero-dependency CLI that agent hooks call (bundled as a Tauri resource).
- `tools/` - asset pipeline (`sprite-export.ts`, `make_icons.py`, `gen-defaults.mjs`).

Rules of the road:

- Renderers never import Node or Tauri directly outside the bridge files.
- Behaviour logic stays pure (TypeScript with no DOM, or Rust with an injectable clock) and gets tests.
- Privacy is a feature: never log or store key identities, never add telemetry or outbound network calls.
- Keep the efficiency budget (see README "Performance"): no always-on animation loops, redraw only when something changes.
- Pixel art: 64x64 logical canvas, integer scaling, `imageSmoothingEnabled = false`.

## Commit style

Conventional commits with a scope: `feat(engine): ...`, `fix(agents): ...`, `docs: ...`, `chore(release): ...`. Keep commits focused. Note non-obvious decisions and gotchas in `MEMORY.md`, and tick items in `tasks.md`.

## Testing agent integrations safely

The agent installers edit files in your home directory (`~/.claude`, `~/.codex`, ...). Do not point experiments at your real config.

- Installers take a `home` argument; unit tests pass a temp directory. Copy that pattern for new installers (see `src-tauri/src/agents/installers/`).
- To try the real app against a throwaway home: set `USERPROFILE` and `HOME` to an empty temp folder before launching (PowerShell: `$env:USERPROFILE = "$env:TEMP\critter-home"; $env:HOME = $env:USERPROFILE`). The hook CLI also honours `CRITTER_HOME`.
- Installers must be idempotent, tag their entries with `critter-hook`, back up a file before first write, refuse to touch files they cannot parse, and uninstall cleanly. Add a test for each of those.
- Poke the server by hand: `curl -X POST http://127.0.0.1:47626/v1/event -H "X-Critter-Token: $(cat ~/.codecritter/token)" -H "Content-Type: application/json" -d '{"agent":"generic","type":"done"}'`, or use the test buttons in Settings > Agents. `CRITTER_DEBUG=1` prints diagnostics.

## Adding a character

See [docs/characters.md](docs/characters.md). Original characters are very welcome.

## Releases

Maintainers tag `vX.Y.Z` (or run the Release workflow manually); `tauri-apps/tauri-action` builds unsigned installers on Windows (NSIS + MSI), macOS (universal dmg) and Linux (AppImage + deb) and attaches them to a draft GitHub Release for review. Windows installers use the WebView2 download bootstrapper (tiny installer; the runtime is fetched only when missing). The bundle identifier is `dev.codecritter.app` (Tauri warns that it ends in `.app`; harmless).

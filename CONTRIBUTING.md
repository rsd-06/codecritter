# Contributing to CodeCritter

Thanks for helping! This is a small, friendly project. Bug reports, new characters, agent integrations and docs fixes are all welcome.

## Dev setup

Requirements: Node 22+, npm, Git. Python 3.10+ is only needed to regenerate image assets.

```sh
git clone https://github.com/rsd-06/codecritter.git
cd codecritter
npm ci
npm run dev
```

If your system drive is tight on space, point the caches elsewhere (this repo's `.npmrc` already does for the maintainer's machine; override it with env vars): `npm_config_cache`, `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`. Never install anything globally.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Electron app with hot reload |
| `npm run playground` | The overlay in a plain browser with a mock bridge and buttons for every event (http://localhost:5174/playground/index.html); `/playground/gallery.html` shows expressions, poses, paws and props |
| `npm test` | Vitest unit tests (`npm run test:watch` for watch mode) |
| `npm run typecheck` | `tsc` for node and web projects |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Production bundles into `out/` |
| `npm run dist` | Build + electron-builder installers into `release/` (add `-- --win --dir` for a quick unpacked build) |
| `npm run sprites:export` | Render every character frame to `tools/out/` using the real engine (Node, no browser) |
| `python tools/make_icons.py` | From the export: icons, tray PNGs, README gallery and GIFs (use `.venv`, needs Pillow) |

Before opening a PR run `npm run typecheck && npm test && npm run lint && npm run build`.

## Architecture in five minutes

The full spec and the binding contracts live in [docs/PLAN.md](docs/PLAN.md) (section 4 is the contract for `src/shared`). In short:

- `src/main` - Electron main process: windows, tray, shortcuts, global input aggregation (`input/`), agent HTTP server and installers (`agents/`), reminders and Pomodoro (`scheduler/`), peek detection (`peek/`), settings store and sync.
- `src/preload` - the two `contextBridge` APIs: `window.critter` (overlay) and `window.critterSettings` (settings).
- `src/renderer/overlay` - the canvas app. `engine/` (pixel renderer, rig compiler, expressions, particles, bubbles, sound, scheduler), `characters/` (Stitch, Yoda rigs), `behavior/` (a pure, unit-tested state machine plus the driver that glues it to the engine). Only `bridge.ts` touches Electron, so the overlay runs in a browser.
- `src/renderer/settings` - the React settings UI.
- `bin/critter-hook.mjs` - the zero-dependency CLI that agent hooks call.
- `tools/` - asset pipeline (`sprite-export.ts`, `make_icons.py`).

Rules of the road:

- Renderers never import Node or Electron; they use the bridge objects.
- Behaviour logic stays pure TypeScript (no DOM) and gets tests with injectable clocks.
- Privacy is a feature: never log or store key identities, never add telemetry or outbound network calls.
- Keep the efficiency budget (see README "Performance"): no always-on animation loops, redraw only when something changes.
- Pixel art: 64x64 logical canvas, integer scaling, `imageSmoothingEnabled = false`.

## Commit style

Conventional commits with a scope: `feat(engine): ...`, `fix(agents): ...`, `docs: ...`, `chore(release): ...`. Keep commits focused. Note non-obvious decisions and gotchas in `MEMORY.md`, and tick items in `tasks.md`.

## Testing agent integrations safely

The agent installers edit files in your home directory (`~/.claude`, `~/.codex`, ...). Do not point experiments at your real config.

- Installers take a `home` argument; unit tests pass a temp directory. Copy that pattern for new installers (see `src/main/agents/`).
- To try the real app against a throwaway home: set `USERPROFILE` and `HOME` to an empty temp folder before launching (PowerShell: `$env:USERPROFILE = "$env:TEMP\critter-home"; $env:HOME = $env:USERPROFILE`). The hook CLI also honours `CRITTER_HOME`.
- Installers must be idempotent, tag their entries with `critter-hook`, back up a file before first write, refuse to touch files they cannot parse, and uninstall cleanly. Add a test for each of those.
- Poke the server by hand: `curl -X POST http://127.0.0.1:47626/v1/event -H "X-Critter-Token: $(cat ~/.codecritter/token)" -H "Content-Type: application/json" -d '{"agent":"generic","type":"done"}'`, or use the test buttons in Settings > Agents. `CRITTER_DEBUG=1` prints diagnostics.

## Adding a character

See [docs/characters.md](docs/characters.md). Original characters are very welcome.

## Releases

Maintainers tag `vX.Y.Z`; the Release workflow builds unsigned installers on Windows, macOS and Linux and attaches them to a draft GitHub Release for review.

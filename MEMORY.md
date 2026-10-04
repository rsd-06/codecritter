# MEMORY.md — decisions, gotchas, handoff notes

Append-only log. Newest at the bottom. Format: `- YYYY-MM-DD [who] note`.

- 2026-10-05 [lead] Stack: Electron + electron-vite + TS. Rust/Blender unavailable on dev box; pixel art is authored as text-grid parts in TS (part-based rig) instead of 3D — matches the pixel aesthetic and enables palette customisation for free.
- 2026-10-05 [lead] Global input via `uiohook-napi` (prebuilt). Must aggregate to counts in main; raw key codes never leave `src/main/input/monitor.ts`.
- 2026-10-05 [lead] Agent server port 47626 (Experiment 626), loopback only, token in `~/.codecritter/token`.
- 2026-10-05 [lead] Comnyang's "multi-device license" is replaced by settings export/import + sync folder (app is free).
- 2026-10-05 [lead] Stitch & Yoda are fan-art of Disney/Lucasfilm characters — README carries a non-affiliation disclaimer; characters are pluggable so they can be swapped for originals if ever needed.
- 2026-10-05 [lead] Python venv `.venv` (Pillow) is only for asset tooling (icons, README previews); the app itself has no Python dependency.
- 2026-10-05 [P0] Disk: C: is low. `.npmrc` (committed) points npm cache + electron cache to D:\dev-cache. In shells also set ELECTRON_CACHE=D:/dev-cache/electron, ELECTRON_BUILDER_CACHE=D:/dev-cache/electron-builder, npm_config_cache=D:/dev-cache/npm. Never install globally.
- 2026-10-05 [P0] Versions: electron 44, electron-vite 5 (peer vite <=7 => vite pinned ^7, @vitejs/plugin-react ^5), electron-store ^8 (CJS; v9+ is ESM-only), typescript 6 (no `baseUrl`; tsconfig paths use `./` prefix), vitest 5, eslint 10, react 19.
- 2026-10-05 [P0] Gotcha: the two preload entries share `shared/ipc` so Rollup emits `out/preload/chunks/*.js`; a sandboxed preload cannot require relative files, so BrowserWindows use `sandbox:false` (contextIsolation stays true, nodeIntegration off). To go back to sandbox:true, make each preload self-contained (no shared chunk).
- 2026-10-05 [P0] Gotcha: overlay `main.ts` only auto-starts when `window.critter` exists; the playground imports and calls `startOverlay` itself. `window.critter` is optional in global.d.ts for this reason.
- 2026-10-05 [P0] Gotcha (tooling): very long Bash heredoc batches containing quotes failed to parse on this box; use the Write tool for many files.
- 2026-10-05 [lead] User decision: proceed with Stitch & Yoda (replacing the cat); trademark question deferred.
- 2026-10-05 [lead] Efficiency is a top requirement. Budgets: total working set < 150 MB, idle CPU < 1%, overlay idle redraws ~0-2/s (dirty-flag, ~12 fps max while animating), hardware acceleration disabled by default (CRITTER_GPU=1 re-enables), settings window destroyed on close, cursor polling adaptive (30 Hz near / 4 Hz far / off when peeking). If Electron cannot meet budget, evaluate Tauri port in P4.
- 2026-10-05 [lead] No Blender: 2D pixel art authored in code is higher fidelity for this style and lighter at runtime than pre-rendered 3D sprites.
- 2026-10-05 [lead] Expression system: eyes x brows x mouth x ears x extras, 18 named presets mapped to user activity (see PLAN §3a).
- 2026-10-05 [P1-C] Agent server: `startAgentServer` rejects ANY request carrying an Origin header (CLI hooks never send one) and non-loopback Host; falls back port..port+5 and writes `~/.codecritter/port` (opts.home, default os.homedir() - tests must pass a temp home). Hook CLI reads CRITTER_HOME as a replacement for the *home dir* (config at $CRITTER_HOME/.codecritter).
- 2026-10-05 [P1-C] Installers identify their entries by substring `critter-hook`, so `hookCmd` must contain the path to critter-hook.mjs (validated). Hook command strings convert backslashes to forward slashes (Windows paths survive Git-Bash/cmd/PowerShell + JSON). Antigravity is an alias of gemini (same file; uninstalling either removes both).
- 2026-10-05 [P1-C] Gotcha: eslint on `bin/*.mjs` has no node globals configured, so the hook imports process/Buffer/timers explicitly. Writing literal U+2028/BOM chars via the Write tool corrupts regexes; use code-point checks instead. `no-control-regex` also forbids control chars in regex literals.

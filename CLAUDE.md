# CLAUDE.md

CodeCritter: open-source pixel desktop companion (Stitch & Yoda) for developers. Tauri 2 (Rust shell) + TypeScript front end. (The old Electron shell is at git tag `electron-final`.)

- **Spec & contracts:** `docs/PLAN.md` (§4 is the binding contract for `src/shared`). **Progress:** `tasks.md`. **Decisions/gotchas:** `MEMORY.md`.
- Commands: `npm run dev` (tauri dev) · `npm run playground` (overlay in browser with mock bridge, http://localhost:5174) · `npm test` (vitest) · `npm run test:rust` (cargo test; needs `npm run build` first) · `npm run typecheck` · `npm run lint` · `npm run build` (front end -> dist-tauri) · `npm run dist` (tauri build: NSIS + MSI on Windows).
- Disk: C: is nearly full. In EVERY shell set `RUSTUP_HOME=D:\dev-tools\rustup`, `CARGO_HOME=D:\dev-tools\cargo`, `CARGO_TARGET_DIR=D:\dev-cache\cargo-target`, `TEMP=TMP=D:\dev-cache\tmp`, `npm_config_cache=D:\dev-cache\npm`, and put `D:\dev-tools\cargo\bin` on PATH. Never dump large recursive listings.
- Python tooling: use `.venv\Scripts\python.exe` (Windows) / `.venv/bin/python`; scripts live in `tools/`.
- Process boundaries: Rust shell (`src-tauri/src`) ↔ webview renderer (`src/renderer`) over Tauri commands/events (`src/renderer/tauri-bridge.ts`, contract in `src/shared`). Renderer never imports Node/Tauri outside the bridge files.
- Overlay renderer must run in a plain browser (playground) — keep all Tauri access behind `bridge.ts` / `tauri-bridge.ts`.
- Behaviour logic is pure TS (no DOM) and unit-tested. Agent installers (Rust, `src-tauri/src/agents`) take a `home` dir param for testability.
- Privacy is a feature: never log/store key identities, only counts. No telemetry, no outbound network.
- Pixel art: 64×64 logical canvas, integer scaling, `imageSmoothingEnabled = false`.
- Commit style: conventional commits, scoped (`feat(engine):`, `fix(agents):`). Never add Co-Authored-By or any AI attribution lines; the maintainer is the sole author. Commit only files you own (see tasks.md). Run `npm run typecheck && npm test` first.
- Update `tasks.md` checkboxes when you finish an item; add non-obvious decisions to `MEMORY.md`.

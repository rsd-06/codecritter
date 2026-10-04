# CLAUDE.md

CodeCritter: open-source pixel desktop companion (Stitch & Yoda) for developers. Electron + TypeScript.

- **Spec & contracts:** `docs/PLAN.md` (§4 is the binding contract for `src/shared`). **Progress:** `tasks.md`. **Decisions/gotchas:** `MEMORY.md`.
- Commands: `npm run dev` (Electron app) · `npm run playground` (overlay in browser with mock bridge, http://localhost:5174) · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run dist`.
- Disk: C: is nearly full. Set TEMP/TMP=D:/dev-cache/tmp, ELECTRON_CACHE/ELECTRON_BUILDER_CACHE under D:/dev-cache before npm/electron/tests. Never dump large recursive listings.
- Python tooling: use `.venv\Scripts\python.exe` (Windows) / `.venv/bin/python`; scripts live in `tools/`.
- Process boundaries: main (`src/main`) ↔ preload (`src/preload`) ↔ renderer (`src/renderer`). Renderer never imports Node/Electron; it only uses `window.critter` / `window.critterSettings`.
- Overlay renderer must run in a plain browser (playground) — keep all Electron access behind `bridge.ts`.
- Behaviour logic is pure TS (no DOM) and unit-tested. Agent installers take a `home` dir param for testability.
- Privacy is a feature: never log/store key identities, only counts. No telemetry, no outbound network.
- Pixel art: 64×64 logical canvas, integer scaling, `imageSmoothingEnabled = false`.
- Commit style: conventional commits, scoped (`feat(engine):`, `fix(agents):`). Commit only files you own (see tasks.md). Run `npm run typecheck && npm test` first.
- Update `tasks.md` checkboxes when you finish an item; add non-obvious decisions to `MEMORY.md`.

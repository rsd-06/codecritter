# MEMORY.md — decisions, gotchas, handoff notes

Append-only log. Newest at the bottom. Format: `- YYYY-MM-DD [who] note`.

- 2026-10-05 [lead] Stack: Electron + electron-vite + TS. Rust/Blender unavailable on dev box; pixel art is authored as text-grid parts in TS (part-based rig) instead of 3D — matches the pixel aesthetic and enables palette customisation for free.
- 2026-10-05 [lead] Global input via `uiohook-napi` (prebuilt). Must aggregate to counts in main; raw key codes never leave `src/main/input/monitor.ts`.
- 2026-10-05 [lead] Agent server port 47626 (Experiment 626), loopback only, token in `~/.codecritter/token`.
- 2026-10-05 [lead] Comnyang's "multi-device license" is replaced by settings export/import + sync folder (app is free).
- 2026-10-05 [lead] Stitch & Yoda are fan-art of Disney/Lucasfilm characters — README carries a non-affiliation disclaimer; characters are pluggable so they can be swapped for originals if ever needed.
- 2026-10-05 [lead] Python venv `.venv` (Pillow) is only for asset tooling (icons, README previews); the app itself has no Python dependency.

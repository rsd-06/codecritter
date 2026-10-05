# tasks.md — CodeCritter progress tracker

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · owner in brackets. Full spec: `docs/PLAN.md`.

## P0 Foundation  [lead + scaffold agent]
- [x] Project dir, git, Python venv (`.venv` + Pillow)
- [x] docs/PLAN.md, tasks.md, CLAUDE.md, MEMORY.md
- [x] electron-vite + TS scaffold, all deps installed, scripts (dev, build, typecheck, test, lint, playground)
- [x] `src/shared/{types,ipc,constants,defaults}.ts` exactly per PLAN §4
- [x] vitest + eslint + prettier config, `.editorconfig`, `.gitignore`, MIT LICENSE
- [x] Stub entrypoints so `npm run build` works; playground served by `npm run playground`
- [x] GitHub Actions CI (typecheck + test, ubuntu/windows/macos)
- [x] Public GitHub repo created + pushed (github.com/rsd-06/codecritter)

## P1 Core
### A. Character engine [agent-A] — owns `src/renderer/overlay/**`, `src/renderer/playground/**`
- [x] Pixel renderer (64×64 logical, integer scale, no smoothing), main loop w/ fixed dt, pause when hidden
- [x] Part-based rig format + compiler (text grid + palette → ImageBitmap cache), unit tests
- [x] Stitch rig: big ears, blue body, light-blue belly, dark eye patches, all mouths/paw poses/props
- [x] Yoda rig: green, long pointed ears, robe, cane, wrinkles, all mouths/paw poses/props
- [x] Procedural pupils (eye-follow), blink, breathing idle
- [x] Effects: squash/stretch spring, tint (overheat), scale-up (stretch), hop, particles (steam, hearts, Zzz, sparkles), paper roll
- [x] Speech bubble (pixel font), thought bubble, pinned note, pomodoro timer widget
- [x] WebAudio synth sounds per character (chirp/gibberish for Stitch, hum for Yoda), volume
- [x] Mock bridge + playground page with buttons/sliders for every event
- [x] Expression system (18 presets x 2 characters, ear poses, blink-on-change) + expression gallery page
- [x] Dirty-flag scheduler (~12 fps max, ~1-2 redraws/s idle), pooled particles, audio context suspend

### B. Main process shell [agent-B] — owns `src/main/{index,store,tray,shortcuts,autostart}.ts`, `src/main/windows/**`, `src/main/input/**`, `src/preload/**`
- [x] Single-instance, app lifecycle, no dock icon on mac (tray app)
- [x] Overlay window (transparent, click-through, hit-test toggling, drag, persisted position, multi-monitor clamp)
- [x] uiohook input monitor → InputSample @10Hz (counts only) + fallback
- [x] Cursor poller → CursorSample @30Hz (throttled to 5Hz when idle)
- [x] electron-store w/ defaults + migration + broadcast on change
- [x] Tray menu (character switch, pomodoro, peek, pause reactions, settings, quit), global shortcuts, autostart
- [x] Preload bridges per contract

### C. Agent integration [agent-C] — owns `src/main/agents/**`, `bin/**`, `docs/agents.md`
- [x] Loopback HTTP server w/ token, rate limit, validation, tests
- [x] `bin/critter-hook.mjs` zero-dep CLI (stdin JSON parse, 300ms timeout, always exit 0)
- [x] Installers + uninstallers: claude-code, codex, cursor, gemini/antigravity, kiro, copilot, opencode — tests w/ temp HOME
- [x] docs/agents.md (manual setup + generic curl for Devin/others)

## P2 Features
### D. Behaviour [agent-D] — owns `src/renderer/overlay/behavior/**`
- [x] State machine w/ priorities + tests
- [x] All reactions: eye follow, drag/mochi, hunt, purr, knead, overheat, stretch, water, paper, thinking, done-jump, alert, sleep, peek, message
- [x] Name personalisation in all strings (Yoda-speak variants for Yoda)

### E. Scheduler & system [agent-E] — owns `src/main/scheduler/**`, `src/main/peek/**`, `src/main/sync.ts`
- [x] Stretch/water interval reminders, custom messages (once/daily/weekdays), DND window — tests w/ fake timers
- [x] Pomodoro engine + tray/settings controls — tests
- [x] Peek detector (fullscreen foreground heuristic) + manual toggle
- [x] Settings sync (export/import + sync folder watch)

### F. Settings UI [agent-F] — owns `src/renderer/settings/**`
- [x] React app: Character (pick + palette editor + presets + live preview), Reactions, Reminders, Pomodoro, Messages, Pinned note, Agents (install/uninstall/test), General (name, scale, opacity, sound, autostart, DND, peek, sync), About

## P3 Ship
- [x] Icons via `tools/make_icons.py` (venv) from sprite export
- [x] electron-builder (win nsis+portable, mac dmg, linux AppImage+deb), release workflow on tags
- [x] README (features, GIFs, install, agents, privacy), CONTRIBUTING, character-authoring guide

## P4 Polish
- [x] Idle CPU < 1% (0.0%)
- [ ] Memory < 150MB working set: not achievable on Electron (bare Electron = 206 MB); ours 190-220 MB, private ~110 MB; experiments in MEMORY.md
- [ ] Bug bash from Opus browser review
- [x] CI green on ubuntu/windows/macos; platform-independent peek tests; release workflow fixed (tags + dispatch only); .npmrc removed from repo

## P2.5 integration fixes
- [x] Auto-peek false positive: Windows uses SHQueryUserNotificationState (koffi); mac/linux heuristic tightened; unit tests with injected query
- [x] Peek edges: renderer honours settings.peek.edge (rotated head for left/right), shared PEEK_VISIBLE_FRACTION, default edge bottom, playground edge selector
- [x] Settings Pomodoro tab: pomodoroState()/onPomodoro contract + IPC + PLAN.md �4 update
- [x] External links via shell.openExternal, navigation locked to app URLs
- [x] Playground cold-cache Invalid hook call (optimizeDeps + dedupe)
- [x] Bubble text capped to 2 lines, clamped inside stage when scaled
- [x] Fallback hook scripts forward stdin message (prompt/message/last_assistant_message)

## v0.2 Tauri port (spec: docs/TAURI_PLAN.md)
- [x] Rust toolchain on D:\dev-tools; Electron preserved at tag `electron-final`
- [ ] T1 Foundation: scaffold, store, windows, bridge, tray, shortcuts, autostart, cursor hit-test click-through
- [ ] T2a Input (rdev) + cursor + peek
- [ ] T2b Agents server + installers (Rust) + tests
- [ ] T2c Scheduler + pomodoro + sync (Rust) + tests
- [ ] T3 Ship: bundles, CI, release workflow, remove Electron, docs, final metrics

## v0.2 QA (after Tauri migration) [lead-requested by user]
- [ ] Full end-to-end mock scenario run of every feature on the Tauri build (scripted: input bursts, scroll, cursor near/far/over, petting, drag/shake, idle→sleep, reminders, pomodoro cycle, messages, pinned note, name, peek on/off all edges, agent events for every agent, settings round-trip, export/import, tray, shortcuts) with screenshots + metrics
- [ ] Real Claude Code integration: install hook from Settings → AI Agents (writes real ~/.claude/settings.json, with backup), run a real `claude -p` prompt, confirm thinking → done reactions, then verify uninstall restores the file

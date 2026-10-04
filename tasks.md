# tasks.md — CodeCritter progress tracker

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · owner in brackets. Full spec: `docs/PLAN.md`.

## P0 Foundation  [lead + scaffold agent]
- [x] Project dir, git, Python venv (`.venv` + Pillow)
- [x] docs/PLAN.md, tasks.md, CLAUDE.md, MEMORY.md
- [ ] electron-vite + TS scaffold, all deps installed, scripts (dev, build, typecheck, test, lint, playground)
- [ ] `src/shared/{types,ipc,constants,defaults}.ts` exactly per PLAN §4
- [ ] vitest + eslint + prettier config, `.editorconfig`, `.gitignore`, MIT LICENSE
- [ ] Stub entrypoints so `npm run build` works; playground served by `npm run playground`
- [ ] GitHub Actions CI (typecheck + test, ubuntu/windows/macos)
- [ ] Public GitHub repo created + pushed

## P1 Core
### A. Character engine [agent-A] — owns `src/renderer/overlay/**`, `src/renderer/playground/**`
- [ ] Pixel renderer (64×64 logical, integer scale, no smoothing), main loop w/ fixed dt, pause when hidden
- [ ] Part-based rig format + compiler (text grid + palette → ImageBitmap cache), unit tests
- [ ] Stitch rig: big ears, blue body, light-blue belly, dark eye patches, all mouths/paw poses/props
- [ ] Yoda rig: green, long pointed ears, robe, cane, wrinkles, all mouths/paw poses/props
- [ ] Procedural pupils (eye-follow), blink, breathing idle
- [ ] Effects: squash/stretch spring, tint (overheat), scale-up (stretch), hop, particles (steam, hearts, Zzz, sparkles), paper roll
- [ ] Speech bubble (pixel font), thought bubble, pinned note, pomodoro timer widget
- [ ] WebAudio synth sounds per character (chirp/gibberish for Stitch, hum for Yoda), volume
- [ ] Mock bridge + playground page with buttons/sliders for every event

### B. Main process shell [agent-B] — owns `src/main/{index,store,tray,shortcuts,autostart}.ts`, `src/main/windows/**`, `src/main/input/**`, `src/preload/**`
- [ ] Single-instance, app lifecycle, no dock icon on mac (tray app)
- [ ] Overlay window (transparent, click-through, hit-test toggling, drag, persisted position, multi-monitor clamp)
- [ ] uiohook input monitor → InputSample @10Hz (counts only) + fallback
- [ ] Cursor poller → CursorSample @30Hz (throttled to 5Hz when idle)
- [ ] electron-store w/ defaults + migration + broadcast on change
- [ ] Tray menu (character switch, pomodoro, peek, pause reactions, settings, quit), global shortcuts, autostart
- [ ] Preload bridges per contract

### C. Agent integration [agent-C] — owns `src/main/agents/**`, `bin/**`, `docs/agents.md`
- [ ] Loopback HTTP server w/ token, rate limit, validation, tests
- [ ] `bin/critter-hook.mjs` zero-dep CLI (stdin JSON parse, 300ms timeout, always exit 0)
- [ ] Installers + uninstallers: claude-code, codex, cursor, gemini/antigravity, kiro, copilot, opencode — tests w/ temp HOME
- [ ] docs/agents.md (manual setup + generic curl for Devin/others)

## P2 Features
### D. Behaviour [agent-D] — owns `src/renderer/overlay/behavior/**`
- [ ] State machine w/ priorities + tests
- [ ] All reactions: eye follow, drag/mochi, hunt, purr, knead, overheat, stretch, water, paper, thinking, done-jump, alert, sleep, peek, message
- [ ] Name personalisation in all strings (Yoda-speak variants for Yoda)

### E. Scheduler & system [agent-E] — owns `src/main/scheduler/**`, `src/main/peek/**`, `src/main/sync.ts`
- [ ] Stretch/water interval reminders, custom messages (once/daily/weekdays), DND window — tests w/ fake timers
- [ ] Pomodoro engine + tray/settings controls — tests
- [ ] Peek detector (fullscreen foreground heuristic) + manual toggle
- [ ] Settings sync (export/import + sync folder watch)

### F. Settings UI [agent-F] — owns `src/renderer/settings/**`
- [ ] React app: Character (pick + palette editor + presets + live preview), Reactions, Reminders, Pomodoro, Messages, Pinned note, Agents (install/uninstall/test), General (name, scale, opacity, sound, autostart, DND, peek, sync), About

## P3 Ship
- [ ] Icons via `tools/make_icons.py` (venv) from sprite export
- [ ] electron-builder (win nsis+portable, mac dmg, linux AppImage+deb), release workflow on tags
- [ ] README (features, GIFs, install, agents, privacy), CONTRIBUTING, character-authoring guide

## P4 Polish
- [ ] Idle CPU < 1%, memory < 150MB
- [ ] Bug bash from Opus browser review

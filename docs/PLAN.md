# CodeCritter — Master Plan

Open-source, free, cross-platform (Windows/macOS/Linux) **pixel desktop companion for developers**.
A from-scratch reimplementation of the feature set of Comnyang (comnyang.com), with two characters
instead of a cat: **Stitch** (blue alien, "Experiment 626") and **Yoda** (small green Jedi master).
Fan-art characters; the character system is pluggable so others can be added.

## 1. Reverse-engineered feature set (parity target)

| # | Comnyang feature | CodeCritter implementation |
|---|---|---|
| 01 | Cat pattern/colors | Per-character palette customisation (body, belly, ears, eyes, accent, outline) + presets, live preview |
| 02 | Eye follow | Pupils track the global cursor (main polls `screen.getCursorScreenPoint()` @30 Hz) |
| 03 | Mochi drag | Drag character: squash/stretch + spring wobble on shake; window follows |
| 04 | Mouse hunt | Fast cursor near the character → crouch, wiggle, pounce toward cursor |
| 05 | Purring pets | Cursor rubbing back and forth over head → closed eyes, hearts, purr/hum sound |
| 06 | Keyboard kneading | Global key activity → paws knead/type animation (counts only, never key content) |
| 07 | Overheat | Keys/sec above threshold for N s → red tint + steam particles |
| 08 | Stretch reminder | Interval timer → character grows big and stretches, bubble message |
| 09 | Water reminder | Interval timer → holds a cup, bubble message |
| 10 | Paper unroll | Global scroll wheel → unspools a paper roll (Yoda: scroll of parchment / Stitch: paper) |
| 11 | Thinking along | AI agent "thinking" event → thinking face + thought bubble with agent name |
| 12 | Agent done jump | AI agent "done" → happy hop + sound + bubble; "error"/"attention" → alert pose |
| 13 | Pomodoro | Focus/break loops, pixel timer floats beside character, tray controls |
| 14 | Message reminder | Scheduled (time + message, optional daily/weekdays repeat) → sound + bubble |
| 15 | Fixed message | Pinned sticky note above head |
| 16 | Tell your name | User name used in bubbles ("Stretch, Sudharshan you must.") |
| 17 | Multi-device license | N/A (free). Replaced by **settings sync**: export/import + optional sync folder |
| 18 | Peek mode | Fullscreen app/video detected (or hotkey) → hides to screen edge, peeks; only reminders shown |
| + | Extras | Sleep when idle, tray menu, global hotkeys, autostart, multi-monitor, scale 1–4x, opacity, sound toggle/volume, DND hours, i18n-ready strings, no telemetry |

AI agents supported (status hooks): Claude Code, Codex CLI, Cursor, Gemini CLI/Antigravity, Kiro,
GitHub Copilot (VS Code via extension-less generic hook / CLI), OpenCode, Devin/anything via generic
`critter-hook` CLI or raw HTTP.

## 2. Tech stack

- **Tauri 2 (Rust shell) + TypeScript front end** (Vite; the original Electron shell is preserved at git tag `electron-final`, see [TAURI_PLAN.md](TAURI_PLAN.md))
- **Renderer**: Canvas 2D, zero-framework for the overlay (perf); **React** for the settings window
- **Global input**: `rdev` (Win/mac/Linux). Only counts and rates leave the hook thread. Fallback: cursor polling only
- **Peek detection**: Windows `SHQueryUserNotificationState`; mac/linux: none yet
- **Persistence**: JSON file in the app config dir (`store.rs`), deep-merged with embedded defaults
- **Packaging**: `tauri build` (NSIS + MSI for Windows, dmg/app for macOS, AppImage/deb for Linux), unsigned
- **Tests**: `vitest` (behaviour state machine, sprite compiler, shared contract) + `cargo test` (agents server and installers, scheduler, input aggregation, sync)
- **Asset tooling**: Python venv (`.venv`, Pillow) in `tools/` for app icons (.png/.ico/.icns), sprite-sheet
  previews/GIFs for README, rendered from the same sprite definitions (JSON exported by `npm run sprites:export`)
- **CI**: GitHub Actions (typecheck, vitest, lint, `cargo test` on 3 OSes; tauri-action draft release on tag)

> Sections 3 onward describe the original Electron layout; the Rust modules that replaced `src/main` are mapped in TAURI_PLAN.md. The `window.critter` contracts in section 4 are now implemented by `src/renderer/tauri-bridge.ts`.

## 3. Architecture

```
src/
  shared/            # types + constants shared by all processes (CONTRACT – see §4)
  main/
    index.ts         # app lifecycle, single-instance lock
    windows/overlay.ts   # transparent, frameless, always-on-top, click-through w/ hit-test toggling
    windows/settings.ts  # settings window
    input/monitor.ts     # uiohook → aggregated InputSample (rates only) → overlay
    input/cursor.ts      # cursor polling → CursorSample
    agents/server.ts     # HTTP 127.0.0.1:47626 POST /v1/event, GET /v1/health
    agents/installers/*.ts # per-agent hook installers (claude, codex, cursor, gemini, kiro, copilot, opencode)
    scheduler/*.ts       # reminders, pomodoro, custom messages, DND
    peek/detector.ts     # fullscreen detection
    store.ts             # electron-store w/ schema + migrations
    tray.ts, shortcuts.ts, autostart.ts, sync.ts
  preload/
    overlay.ts       # exposes window.critter (OverlayBridge)
    settings.ts      # exposes window.critterSettings (SettingsBridge)
  renderer/
    overlay/         # index.html + main.ts : canvas app
      engine/        # loop, renderer (pixel canvas, scale), particles, bubbles, sound (WebAudio synth)
      behavior/      # state machine + reactions
      characters/    # stitch/, yoda/  — part-based pixel rigs
      bridge.ts      # real bridge or mock (browser playground)
    playground/      # index.html : browser dev page w/ mock bridge + buttons for every event
    settings/        # React settings UI
bin/critter-hook.mjs # zero-dep Node CLI used by agent hooks → POSTs to server
tools/               # python asset scripts (venv)
```

### Overlay window strategy
Window is ~ (64·scale+bubble margin) px, transparent, `alwaysOnTop(true,'screen-saver')`, `skipTaskbar`,
`focusable:false`, `setIgnoreMouseEvents(true,{forward:true})`. Renderer does per-pixel hit test on
mousemove; when over an opaque pixel it calls `bridge.setInteractive(true)` (main disables ignore),
leaving → back to click-through. Drag uses `bridge.dragStart/dragMove/dragEnd` → main `setPosition`.
Default position: bottom-right of primary display work area (sits on taskbar). Position persisted.

### Character system (part-based pixel rig)
A character = palette keys + parts, each part a small text grid (one char = one pixel, `.` = transparent):
`body`, `head`, `earL`, `earR`, `eyeWhiteL/R` (pupils drawn procedurally for eye-follow),
`mouth.{neutral,happy,open,o,flat,smirk}`, `pawL/pawR` (+`pawUp` variants), `feet`, `props.{cup,paper,laptop,
saber/cane,note}` and anchors. Poses are functions `(t, params) → PartTransform[]` (pixel offsets, flips,
frame selection). Global effects (squash/stretch, tint, scale-up for stretch, y-hop) are canvas transforms.
Palette swap = customisation. Base logical canvas: 64×64 px, drawn with `imageSmoothingEnabled=false`.

### Behaviour state machine
Priority-ordered states: `peek` > `drag` > `reminder(stretch|water|message|pomodoro)` > `agentDone` >
`agentAlert` > `hunt` > `purr` > `overheat` > `knead` > `paper` > `thinking` > `idle` > `sleep`.
Each state: `enter/update(dt,ctx)/exit`, min-duration, interruptibility. Pure TS, unit-tested, no DOM.

## 4. CONTRACT (src/shared) — all agents must use these exactly

```ts
// src/shared/types.ts
export type CharacterId = 'stitch' | 'yoda';
export type AgentId = 'claude-code'|'codex'|'cursor'|'gemini'|'antigravity'|'kiro'|'copilot'|'opencode'|'devin'|'generic';
export type AgentEventType = 'thinking' | 'tool' | 'done' | 'error' | 'attention' | 'idle';
export interface AgentEvent { agent: AgentId; type: AgentEventType; session?: string; message?: string; cwd?: string; ts: number; }

export interface InputSample {          // emitted ~10 Hz by main, aggregated
  keysPerSec: number; keyBurst: boolean; // keyBurst=true if any key in last 150ms
  scrollDelta: number;                   // sum of wheel rotation since last sample (+down)
  mouseSpeed: number;                    // px/s, global
  idleMs: number;                        // ms since last any input
}
export interface CursorSample { x: number; y: number; winX: number; winY: number; winW: number; winH: number; } // screen coords + overlay bounds

export type ReminderKind = 'stretch' | 'water' | 'message' | 'pomodoro-focus' | 'pomodoro-break' | 'pomodoro-done';
export interface ReminderEvent { kind: ReminderKind; text: string; durationMs: number; }

export interface Palette { outline: string; body: string; bodyShade: string; belly: string; earInner: string; eye: string; pupil: string; accent: string; }
export interface CustomMessage { id: string; time: string /*HH:MM*/; text: string; repeat: 'once'|'daily'|'weekdays'; enabled: boolean; }

export interface Settings {
  version: 1;
  character: CharacterId; userName: string;
  palettes: Record<CharacterId, Palette>;
  scale: 1|2|3|4; opacity: number; position: { displayId: number; x: number; y: number } | null;
  sound: { enabled: boolean; volume: number };
  reactions: { eyeFollow: boolean; hunt: boolean; purr: boolean; knead: boolean; overheat: boolean; paper: boolean; drag: boolean; sleep: boolean };
  overheatKps: number;                   // default 8 keys/sec sustained 3 s
  reminders: { stretch: { enabled: boolean; everyMin: number }; water: { enabled: boolean; everyMin: number } };
  pomodoro: { focusMin: number; breakMin: number; longBreakMin: number; cyclesBeforeLong: number };
  messages: CustomMessage[]; pinnedNote: string;
  dnd: { enabled: boolean; from: string; to: string };
  peek: { auto: boolean; edge: 'left'|'right'|'bottom' };
  agents: { enabled: boolean; port: number; token: string };
  autostart: boolean; syncFolder: string | null;
}
export interface PomodoroState { phase: 'idle'|'focus'|'break'|'longBreak'; endsAt: number|null; cycle: number; paused: boolean; remainingMs: number; }

// window.critter (overlay preload)
export interface OverlayBridge {
  onInput(cb: (s: InputSample) => void): () => void;
  onCursor(cb: (s: CursorSample) => void): () => void;
  onAgent(cb: (e: AgentEvent) => void): () => void;
  onReminder(cb: (e: ReminderEvent) => void): () => void;
  onPomodoro(cb: (s: PomodoroState) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
  onPeek(cb: (peeking: boolean) => void): () => void;
  getSettings(): Promise<Settings>;
  setInteractive(on: boolean): void;
  dragStart(): void; dragMove(dx: number, dy: number): void; dragEnd(): void;
  openSettings(): void; showContextMenu(): void;
}
// window.critterSettings (settings preload)
export interface SettingsBridge {
  get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings>;
  pomodoro(cmd: 'start'|'pause'|'resume'|'skip'|'stop'): Promise<PomodoroState>;
  pomodoroState(): Promise<PomodoroState>;                 // current state (tray-started sessions)
  onPomodoro(cb: (s: PomodoroState) => void): () => void;  // pushed on every transition (+1/s while running)
  agentStatus(): Promise<Record<string, { installed: boolean; path: string }>>;
  installAgent(id: AgentId): Promise<{ ok: boolean; message: string }>;
  uninstallAgent(id: AgentId): Promise<{ ok: boolean; message: string }>;
  testEvent(type: AgentEventType): Promise<void>; testReminder(kind: ReminderKind): Promise<void>;
  exportSettings(): Promise<string|null>; importSettings(): Promise<boolean>;
}
```
```ts
// src/shared/ipc.ts — channel names
export const IPC = {
  input: 'critter:input', cursor: 'critter:cursor', agent: 'critter:agent', reminder: 'critter:reminder',
  pomodoro: 'critter:pomodoro', settings: 'critter:settings', peek: 'critter:peek',
  getSettings: 'critter:get-settings', setSettings: 'critter:set-settings', setInteractive: 'critter:set-interactive',
  dragStart: 'critter:drag-start', dragMove: 'critter:drag-move', dragEnd: 'critter:drag-end',
  openSettings: 'critter:open-settings', contextMenu: 'critter:context-menu',
  pomodoroCmd: 'critter:pomodoro-cmd', pomodoroState: 'critter:pomodoro-state', agentStatus: 'critter:agent-status', installAgent: 'critter:install-agent',
  uninstallAgent: 'critter:uninstall-agent', testEvent: 'critter:test-event', testReminder: 'critter:test-reminder',
  exportSettings: 'critter:export-settings', importSettings: 'critter:import-settings',
} as const;
// src/shared/constants.ts
export const AGENT_PORT = 47626; // "626" for Experiment 626
```
`src/shared/defaults.ts` exports `DEFAULT_SETTINGS: Settings` and `DEFAULT_PALETTES`.

### Agent HTTP API
`POST http://127.0.0.1:47626/v1/event` JSON `{agent,type,message?,session?,cwd?}` header `X-Critter-Token: <token>`
(token from settings, written to `~/.codecritter/token` so the hook CLI can read it). Bound to loopback only.
`GET /v1/health` → `{ok:true,version}`. `bin/critter-hook.mjs <agent> <type> [--message ..]` also reads hook
JSON from stdin (Claude Code passes JSON) to extract message/cwd. Never blocks the agent: 300 ms timeout, exit 0 always.

Hook mapping:
- Claude Code `~/.claude/settings.json` hooks: `UserPromptSubmit`→thinking, `PreToolUse`→tool, `Stop`→done,
  `Notification`→attention, `SubagentStop`→tool. Merge without clobbering; tag entries with `codecritter` for uninstall; backup file.
- Codex `~/.codex/config.toml`: `notify = ["node", "<abs>/critter-hook.mjs", "codex", "done"]` (Codex appends JSON arg).
- Cursor `~/.cursor/hooks.json`: `beforeSubmitPrompt`→thinking, `stop`→done, `afterFileEdit`→tool.
- Gemini CLI / Antigravity `~/.gemini/settings.json` hooks (`BeforeAgent`→thinking, `AfterAgent`→done).
- Kiro: `.kiro/hooks/*.kiro.hook` user-level file w/ shell command on agent stop.
- Copilot CLI `~/.copilot/hooks/codecritter.json` (`userPromptSubmitted`, `sessionEnd`/`agentStop`).
- OpenCode: plugin file `~/.config/opencode/plugin/codecritter.js` listening to `session.idle`/`session.status`.
- Devin / others: documented generic curl / `critter-hook` usage.
Installers are pure functions over a `home` dir param → fully unit-testable with temp dirs.

## 5. Phases (each ends with: tests green, Opus review in browser playground, commit, push)

- **P0 Foundation** — scaffold, contract, docs, CI skeleton.
- **P1 Core (parallel)** — A: character engine + Stitch/Yoda rigs + playground. B: main process shell
  (overlay window, input, cursor, tray, store, IPC). C: agent server + hook CLI + installers.
- **P2 Features (parallel)** — D: behaviour state machine + all reactions wired. E: scheduler (reminders,
  pomodoro, messages, DND), peek detector, sync. F: React settings UI.
- **P3 Ship** — icons (python), electron-builder configs, release workflow, README w/ GIFs, CONTRIBUTING, LICENSE (MIT).
- **P4 Polish** — perf (idle CPU < 1%), a11y, i18n strings, bug bash from Opus review.

## 6. Rules for implementers
- Own only the paths assigned in tasks.md. Never edit `src/shared/*` without the lead's approval (log a note in MEMORY.md).
- Privacy: never record key identities/content; aggregate counts only. No network except loopback server.
- Commit only your own paths (`git add <paths>`), conventional commits (`feat(engine): ...`).
- `npm run typecheck && npm test` must pass before committing.

## 3a. Expressions (activity → expression)
Expression = eyes × brows × mouth × ears × extras (blush, sweat, tear, anger vein, steam).
| User activity / event | Preset |
|---|---|
| nothing special | neutral (breathing, blinking, occasional look-around) |
| steady typing | focused |
| typing burst > overheat threshold | stressed (red tint, steam) |
| cursor approaches | curious |
| very fast mouse | surprised → hunt |
| petting head | love (hearts, blush) |
| dragged | excited; shaken → annoyed; shaken long → dizzy |
| idle 2 min | bored; idle 5 min | sleepy → sleep |
| scrolling | focused + paper unroll |
| agent thinking / tool | thinking |
| agent done | proud + hop |
| agent error / attention | worried |
| pomodoro focus / break | determined / relaxed |
| peek mode | sneaky |
| reminder | happy (with bubble) |
| late night (after 23:00) typing | sleepy-eyed nudge "go to bed" bubble once/hour |

## 3b. Efficiency budget
Total working set < 150 MB, idle CPU < 1%. Overlay renders dirty-flag only (~12 fps max while animating,
0–2 redraws/s idle). HW acceleration off by default. Settings window destroyed on close. Adaptive cursor polling.

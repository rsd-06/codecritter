<div align="center">

<img src="docs/media/hero.gif" alt="Stitch and Yoda idling and hopping" width="420">

# CodeCritter

**A tiny pixel companion that lives on your desktop, watches you code, and reacts to your AI agents.**

Free, open source, no telemetry. Windows, macOS and Linux.

[Download](https://github.com/rsd-06/codecritter/releases) · [AI agents](docs/agents.md) · [Make a character](docs/characters.md) · [Contributing](CONTRIBUTING.md)

</div>

---

CodeCritter puts a small pixel character on top of your windows. It follows your cursor with its eyes, kneads the air while you type, gets hot when you type too fast, reminds you to stretch and drink water, runs your Pomodoro timer, and celebrates when your coding agent finishes a task. Inspired by desktop pets like Comnyang, but free, open source and built for developers.

Two characters ship in the box: **Stitch** and **Yoda** (unofficial fan art, see the [disclaimer](#disclaimer)). The character system is pluggable.

<p align="center">
  <img src="docs/media/stitch-hop.gif" alt="Stitch hopping" width="160">
  <img src="docs/media/stitch-knead.gif" alt="Stitch typing" width="160">
  <img src="docs/media/yoda-idle.gif" alt="Yoda idling" width="160">
  <img src="docs/media/yoda-sleep.gif" alt="Yoda sleeping" width="160">
</p>

## Features

| # | Feature | What it does |
| --- | --- | --- |
| 1 | Colours | Per-character palette editor with presets and a live preview |
| 2 | Eye follow | Pupils track your cursor across all monitors |
| 3 | Mochi drag | Grab and fling the critter; it squashes, stretches and wobbles |
| 4 | Mouse hunt | Whip the cursor past it and it crouches, wiggles and pounces |
| 5 | Purring pets | Rub the cursor back and forth over its head: hearts and a purr |
| 6 | Keyboard kneading | Typing makes it knead/type along (key counts only, never key content) |
| 7 | Overheat | Sustained fast typing turns it red and makes it steam |
| 8 | Stretch reminder | Grows big, stretches, and nags you politely |
| 9 | Water reminder | Holds up a cup on your schedule |
| 10 | Paper unroll | Scrolling unspools a paper roll (a scroll for Yoda) |
| 11 | Thinking along | Shows a thought bubble while your AI agent works |
| 12 | Agent done jump | Hops, chirps and shows a bubble when the agent finishes; alert pose on errors |
| 13 | Pomodoro | Focus/break/long-break loops with a pixel timer beside the critter and tray controls |
| 14 | Message reminders | Scheduled messages (once / daily / weekdays) with a sound |
| 15 | Fixed message | A pinned sticky note above its head |
| 16 | Your name | Bubbles use your name (Yoda keeps his syntax) |
| 17 | Settings sync | Export/import settings, or point at a sync folder to share them across machines |
| 18 | Peek mode | Hides at a screen edge and peeks out while a fullscreen app or video is up; only reminders break through |

Extras: 18 expression presets per character, sleeps when you go idle, synthesised sounds (chirps for Stitch, hums for Yoda) with volume, scale 1-4x, opacity, do-not-disturb hours, multi-monitor aware, global shortcuts, autostart, quiet by design.

## Characters

Every character is built from small pixel-grid parts and a palette, so colours are fully customisable. 18 expressions each:

**Stitch**

![Stitch expressions](docs/media/gallery-stitch.png)

**Yoda**

![Yoda expressions](docs/media/gallery-yoda.png)

Want to add your own? See [docs/characters.md](docs/characters.md).

## AI agent integration

CodeCritter listens on a tiny loopback-only HTTP endpoint. Agents report `thinking`, `tool`, `done`, `error` and `attention` events through a zero-dependency hook script. Open **Settings > Agents** and click **Install**: CodeCritter edits the agent's config for you (idempotently, with a backup, and it can uninstall just as cleanly).

| Agent | One-click install | Notes |
| --- | --- | --- |
| Claude Code | Yes | `~/.claude/settings.json` hooks |
| Codex CLI | Yes | `notify` command |
| Cursor | Yes | `~/.cursor/hooks.json` |
| Gemini CLI | Yes | Hooks in `~/.gemini/settings.json` |
| Antigravity | Yes | Shares Gemini's settings file |
| Kiro | Yes | User-level `.kiro.hook` files |
| GitHub Copilot CLI | Yes | `~/.copilot/hooks/codecritter.json` |
| OpenCode | Yes | Plugin in `~/.config/opencode/plugin/` |
| Devin and anything else | Manual | One `curl` call, see below |

Manual setup, exact file formats, the HTTP API and troubleshooting: [docs/agents.md](docs/agents.md).

## Install

### Download

Grab the latest build for your OS from the [Releases page](https://github.com/rsd-06/codecritter/releases):

- **Windows**: `CodeCritter-*-win-x64-nsis.exe` (installer, per-user) or `*-portable.exe`
- **macOS**: `CodeCritter-*-mac-*.dmg`
- **Linux**: `.AppImage` (`chmod +x`, run) or `.deb`

> Builds are **unsigned** for now. Windows SmartScreen shows "Windows protected your PC": click **More info > Run anyway**. On macOS right-click the app, choose **Open**, then confirm (or run `xattr -dr com.apple.quarantine /Applications/CodeCritter.app`). CodeCritter is a menu-bar/tray app and has no Dock icon.

### Build from source

Requires Node 22+ (and Python 3.10+ only if you regenerate image assets).

```sh
git clone https://github.com/rsd-06/codecritter.git
cd codecritter
npm ci
npm run dev            # run the app with hot reload
npm run dist           # installers for your OS in release/
npm run dist -- --win --dir   # unpacked build only (fast)
```

Regenerate icons, tray images and README media from the character definitions (needs a Python venv with Pillow):

```sh
python -m venv .venv
.venv\Scripts\pip install -r tools\requirements.txt      # Windows (use .venv/bin/pip on macOS/Linux)
npm run sprites:export                                    # render frames with the real engine
.venv\Scripts\python.exe tools\make_icons.py              # icons, tray PNGs, docs/media
```

## Usage

- **Tray / menu-bar icon**: switch character, start/pause/skip/stop Pomodoro, peek mode, pause reactions, mute, hide/show, Settings, Quit. The tray icon follows the selected character.
- **Right-click the critter** for the same menu. **Drag** it anywhere; its position is remembered per monitor.
- **Shortcuts** (global): `Ctrl/Cmd+Alt+P` toggle peek, `Ctrl/Cmd+Alt+H` hide/show, `Ctrl/Cmd+Alt+S` open Settings.
- **Settings window**: character and colours, reactions, reminders, Pomodoro, messages, pinned note, agents, general (name, size, opacity, sound, autostart, do-not-disturb, peek, sync).
- **Config file**: `config.json` in the app data folder: `%APPDATA%\CodeCritter\config.json` on Windows, `~/Library/Application Support/CodeCritter/config.json` on macOS, `~/.config/CodeCritter/config.json` on Linux. The agent token and port live in `~/.codecritter/`.

## Privacy

Privacy is a feature, not a footnote.

- **No telemetry, no analytics, no outbound network.** The app never phones home and has no auto-update ping.
- **Keystrokes are never recorded.** The global input hook is aggregated in the main process into counts and rates (keys per second, scroll delta, mouse speed). Key identities never leave that one file and are never stored or logged.
- **Loopback only.** The agent endpoint binds to `127.0.0.1`, requires a random per-install token, rejects browser requests, and is rate limited. Events can only animate the critter.
- Agent messages (for speech bubbles) are shown and discarded; they are not stored.

See [SECURITY.md](SECURITY.md) for the threat model.

## Performance

Efficiency is a design goal: no animation loop while idle (a dirty-flag scheduler redraws ~1-2 times per second at rest and at most ~12 fps while animating), hardware acceleration off by default, adaptive cursor polling, and the Settings window is destroyed when closed. Measured on a Windows 11 box with the packaged build (idle, overlay visible, normal desktop use):

| Metric | Result |
| --- | --- |
| CPU (idle) | ~0.0% |
| Working set | ~190-220 MB (browser ~115-131 MB + overlay renderer ~77-89 MB). This counts shared Electron/Chromium DLL pages; a bare Electron app with one transparent window measures 206 MB the same way, so CodeCritter adds only ~12 MB. Private (unshared) memory is ~110 MB. |
| Idle redraws | ~1.2-1.4 per second (0.8 while asleep) |

Honest note: the memory figure is above our 150 MB aspiration, which is close to the floor for an Electron app. `CRITTER_METRICS=1` prints these numbers, `CRITTER_GPU=1` re-enables GPU acceleration.

## Roadmap

- Code-signed Windows and macOS builds and auto-update
- More built-in characters and a drop-in character pack loader
- Per-monitor and per-app behaviour rules
- Localised strings (the text layer is already i18n-ready)
- Idle CPU/memory polish and a lighter shell investigation

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) (dev setup, scripts, architecture, commit style, how to test agent installers safely) and the architecture notes in [docs/PLAN.md](docs/PLAN.md).

## License

[MIT](LICENSE) for the code. Character artwork is unofficial fan art, see below.

## Disclaimer

CodeCritter is an independent, unofficial, non-commercial fan project. **Stitch is a character of and copyright (c) Disney. Yoda is a character of and copyright (c) Lucasfilm Ltd.** All rights belong to their respective owners. CodeCritter is **not affiliated with, endorsed by or sponsored by** Disney, Lucasfilm, or any of the AI-agent or desktop-pet products mentioned here. The characters are plain pixel-art data and the character system is pluggable, so they can be swapped for original characters at any time. The MIT license covers the source code only, not the third-party characters it depicts.

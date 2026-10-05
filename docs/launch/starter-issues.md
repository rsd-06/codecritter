# Starter issues (to open on GitHub at launch)

| Title | Labels | Notes |
|---|---|---|
| Left-click the peeking critter to bring it back | good first issue, enhancement | Needs a small `unpeek` bridge command; right-click → Peek mode already works (see docs/QA-v0.2.md). |
| Test and fix the macOS build (.dmg) | help wanted, macos | Builds in CI but never run on a real Mac. Check transparency, tray template icon, LSUIElement. |
| Test and fix the Linux build (AppImage/.deb) | help wanted, linux | rdev needs X11; Wayland behaviour unknown. |
| Multi-monitor testing | help wanted, testing | Drag between monitors, mixed DPI, unplugging a display. |
| Design an original third character | character, help wanted | Characters are pixel-grid data, see docs/characters.md. |
| Translate the settings UI | good first issue, i18n | Strings live in src/renderer/settings. |
| Shrink the stage now that characters are smaller | enhancement | Proposal in MEMORY.md: 128×112 → ~112×100. |
| Bump GitHub Actions off the deprecated Node 20 runtime | good first issue, ci | CI shows a deprecation warning. |
| Add an integration for another coding agent | help wanted, agents | See docs/agents.md for hook formats and the HTTP API. |

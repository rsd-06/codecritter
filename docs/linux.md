# CodeCritter on Linux

Supported targets: Ubuntu 22.04 / 24.04, Debian 12, Arch Linux; X11 and Wayland sessions (GNOME, KDE).
Packages: `.deb` (apt), `.AppImage` (any distro), `codecritter-bin` (AUR, source is the release `.deb`).

## Install

| Distro | Command |
|---|---|
| Ubuntu 22.04 / 24.04, Debian 12 | `sudo apt install ./CodeCritter_<version>_amd64.deb` |
| Any | `chmod +x CodeCritter_<version>_amd64.AppImage && ./CodeCritter_<version>_amd64.AppImage` |
| Arch | `yay -S codecritter-bin` (or `paru`), once published; until then the AppImage |

- The `.deb` depends on `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1 | libappindicator3-1`, `libxdo3`, `libxtst6`, `libx11-6`, `libxi6`; apt installs them. Releases are built on Ubuntu 22.04 (older glibc) so the same files run on all of the above.
- AppImage without FUSE (containers, some minimal installs, Ubuntu 24.04 without `libfuse2t64`): run `./CodeCritter_*.AppImage --appimage-extract-and-run`, or `sudo apt install libfuse2t64`.
- Updates: the AppImage updates itself (Settings or tray "Check for updates"). A `.deb` / AUR install cannot replace itself: CodeCritter shows "update available" and "Install" opens the releases page; AUR users update through their helper.

## Sessions: X11 and Wayland

- **X11**: everything works (overlay, click-through, global input via XRecord, shortcuts, fullscreen peek).
- **Wayland (GNOME / KDE)**: CodeCritter runs GTK/WebKit through **XWayland** (`GDK_BACKEND=x11` is set at startup when `WAYLAND_DISPLAY` and `DISPLAY` both exist). Native Wayland cannot place windows, keep them on top or report the global cursor, so the overlay would be unusable. Make sure XWayland is installed (`xorg-xwayland` on Arch, `xwayland` on Debian/Ubuntu; installed by default on GNOME and KDE).
  - Opt out with `CRITTER_WAYLAND=1` (native Wayland: no positioning, no always-on-top, cursor tracking limited). Not recommended.
  - **Limits under XWayland**: global input (typing / scroll / clicks) and fullscreen-app detection only see **X11 / XWayland apps**. Native Wayland apps (GNOME Terminal, Firefox with Wayland, most GTK4/Qt6 apps) are invisible to X11 input. Fix: the optional evdev mode below. The overlay's cursor tracking works only while the pointer is over an X11 window on some compositors.
  - GNOME shows no window decorations/shadow for the overlay, which is intended. Global shortcuts (Ctrl+Alt+P/H/S) work only while an X11 client has focus on strict compositors; use the tray menu otherwise.
- Fractional scaling: XWayland renders at integer scale and is upscaled (slightly soft). Multi-DPI works through `GDK_SCALE` / the compositor scale; set `GDK_SCALE=2` in the environment to force it on X11.

## Optional evdev input mode (Wayland)

Reads `/dev/input/event*` only to count key presses, clicks and wheel notches (never key identities, never logged). Off by default.

1. Use a release build (it includes the `evdev` feature) or build with `--features evdev`.
2. Join the input group, then log out and in: `sudo usermod -aG input $USER`.
3. Opt in: `touch ~/.codecritter/evdev` (or start with `CRITTER_EVDEV=1`).
4. Restart CodeCritter. `CRITTER_DEBUG=1` prints `evdev input backend active (N devices)`.

Security note: members of `input` can read every keyboard device. Only enable this if you accept that for your user. If CodeCritter sees no input for 90 s on a Wayland session it shows a one-time bubble pointing here.

## Tray

Uses libayatana-appindicator (StatusNotifierItem). KDE, XFCE, Cinnamon, MATE work out of the box.
**GNOME** has no tray: install the *AppIndicator and KStatusNotifierItem Support* extension (Ubuntu ships it enabled; on Debian/Arch: `sudo apt install gnome-shell-extension-appindicator` / `pacman -S gnome-shell-extension-appindicator`, then enable it). Without a tray host CodeCritter shows a one-time bubble; shortcuts still work: Ctrl+Alt+S settings, Ctrl+Alt+H hide/show, Ctrl+Alt+P peek.

## Other behaviour

- **Autostart**: Settings toggle writes `~/.config/autostart/codecritter.desktop` (AppImage: points at the `.AppImage` file, so keep it in a stable place). Only active in release builds.
- **Peek auto-detect**: X11 `_NET_ACTIVE_WINDOW` + `_NET_WM_STATE_FULLSCREEN` (fallback: window covers its monitor and has no title bar). No window titles or process names are read.
- **Sound**: the WebKitGTK "media requires user gesture" restriction is lifted for CodeCritter's own windows.
- **Agent hooks**: with Node on PATH the bundled `critter-hook.mjs` is used (copied to `~/.codecritter/`), else a `curl` shell script `~/.codecritter/critter-hook.sh` (optional `jq` adds the prompt text). The resource is found under `/usr/lib/CodeCritter/` (deb) or the AppImage mount.
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set by default (blank-window fix on NVIDIA); set it yourself (any value) to override.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank / black overlay | No compositor (transparent windows need one): use a normal desktop session; or start with `WEBKIT_DISABLE_COMPOSITING_MODE=1` |
| No tray icon on GNOME | AppIndicator extension (above) |
| Character does not react to typing on Wayland | Native Wayland app focused: use evdev mode |
| AppImage: `dlopen(): libfuse.so.2` | `--appimage-extract-and-run` or install libfuse2 |
| Nothing starts | Run from a terminal with `CRITTER_DEBUG=1 codecritter` and open an issue with the output |
| Two copies wanted | `CRITTER_MULTI=1` skips the single-instance guard (testing only) |

## Maintainers: CI, release and AUR

- `.github/workflows/linux-smoke.yml` (push to `platform/**`, tags): builds `.deb` + AppImage on ubuntu-22.04, installs/runs them in ubuntu:22.04, ubuntu:24.04, debian:12 and archlinux containers under Xvfb + openbox, asserts `/v1/health`, an always-on-top skip-taskbar overlay and an accepted event, uploads screenshots. A second job runs `makepkg -si` on the PKGBUILD against the v0.2.1 release and smoke-runs the result. Local runs: `tools/linux-smoke.sh`, `tools/aur-test.sh`.
- Release builds Linux on ubuntu-22.04 with `--features evdev`.
- **Publishing to the AUR (needs your AUR account; not done by CI):**
  1. Create an account at https://aur.archlinux.org and add your SSH public key in *My Account*.
  2. After the GitHub release is published: `packaging/aur/update.sh <version>` (on Arch or in an `archlinux` container with `base-devel`) to set `pkgver`, the real `sha256sums` and regenerate `.SRCINFO`.
  3. `git clone ssh://aur@aur.archlinux.org/codecritter-bin.git aur-codecritter-bin`, copy `PKGBUILD` and `.SRCINFO` from `packaging/aur/codecritter-bin/` into it.
  4. `git add PKGBUILD .SRCINFO && git commit -m "codecritter-bin <version>" && git push` (branch `master`).
  5. Each release: repeat 2-4.

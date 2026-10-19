# CodeCritter on Linux

**Tested** on Ubuntu 22.04 / 24.04 and Debian 12 (x86-64), on GNOME/X11, and in clean containers (see
[Packaging](#packaging)). **Not tested:** ARM64, non-GNOME/KDE desktops, Wayland sessions *without*
XWayland.

Packages: `.deb` (apt), `.rpm` (dnf), `.AppImage` (any distro).

## Compatibility matrix

Statuses are evidence-based. "TESTED PASS" means it was actually exercised, not that it compiled.
"Container" means the package was installed, launched and removed on that distro's library set — which
proves packaging and runtime linkage, but **not** real hardware, a real window manager, the tray host,
global shortcuts, GPU compositing or input capture.

| Target | Status | Evidence |
|---|---|---|
| Ubuntu 22.04, x86-64, GNOME, X11 | **TESTED PASS** | Live desktop session: overlay renders, click-through, always-on-top, rdev key/click/scroll input, EWMH fullscreen peek + slide/restore, tray icon, Ctrl+Alt+S, single instance, WebAudio, agent IPC (200 with token / 401 without) |
| Ubuntu 22.04, x86-64, GNOME, **container** | **TESTED PASS** | `tools/linux-smoke.sh`: install → `ldd` closure → launch → `/v1/health` → event POST → clean removal |
| Ubuntu 24.04, x86-64, **container** | **TESTED PASS (packaging)** | Same smoke test incl. clean removal. No real desktop session — **runtime behaviour on 24.04 hardware: NOT VERIFIED** |
| Debian 12, x86-64, **container** | **TESTED PASS (packaging)** | Same smoke test (deb + AppImage) incl. clean removal. Desktop behaviour: **NOT VERIFIED** |
| Fedora 39, x86-64, RPM | **TESTED PASS** | `dnf install` resolved from the declared Requires, `ldd` clean, launched under Xvfb, `/v1/health` OK, event POST 200, clean removal. Only Fedora 39 — **RHEL / openEuler / Rocky: NOT VERIFIED** |
| AppImage | **TESTED PASS (packaging)** | Runs and passes the full smoke test on `ubuntu:22.04` and `debian:12` via `--appimage-extract-and-run`; bundles WebKitGTK/GTK (189 files under `usr/lib`), so it needs no distro packages. `--appimage-extract-and-run` is required without FUSE. **Other distros: NOT VERIFIED** — the AppImage was not run on Fedora/RHEL or Arch |
| Ubuntu 22.04, Wayland **with** XWayland | **NOT VERIFIED** | No Wayland session was available. The selection logic is unit-tested (`session::forces_xwayland_only_when_sensible`) and `GDK_BACKEND=x11` is verifiably applied before GTK init and inherited by the web process, but the end-to-end Wayland session was never run |
| **Native Wayland without XWayland** | **UNSUPPORTED BY DESIGN** | Native Wayland cannot position windows, keep them on top or report the global cursor. `CRITTER_WAYLAND=1` exists but is degraded and not recommended |
| KDE, XFCE | **NOT VERIFIED** | Uses generic EWMH + libayatana-appindicator, which both support, but nothing was run |
| ARM64 | **NOT VERIFIED** | No `aarch64-unknown-linux-gnu` build was attempted and no ARM hardware was available. Nothing in the code forbids it |
| Multi-monitor, fractional scaling | **NOT VERIFIED** | Only one monitor at integer scale 2 was exercised. `watch_displays` / `reclamp_overlay` / `clamp_rect` are unit-tested but no hotplug or second-monitor run was performed |
| GPU: hybrid Intel iGPU + NVIDIA (this host) | **PARTIALLY TESTED** | Measured which render node `WebKitWebProcess` opens: DMA-BUF path → `/dev/dri/renderD128` (Intel), default path → `/dev/dri/renderD129` (NVIDIA). Both rendered correctly — see [WebKitGTK rendering](#webkitgtk-rendering) |
| GPU: Intel-only or AMD-only | **NOT VERIFIED** | No such hardware available. The DMA-BUF workaround is on by default precisely because its failure cases could not be reproduced here |

## Install

| Distro | Command |
|---|---|
| Ubuntu 22.04 / 24.04, Debian 12 | `sudo apt install ./CodeCritter_<version>_amd64.deb` |
| Any | `chmod +x CodeCritter_<version>_amd64.AppImage && ./CodeCritter_<version>_amd64.AppImage` |

- Releases are built on **Ubuntu 22.04**, the oldest supported baseline, so one set of files runs on
  Ubuntu 24.04 (glibc 2.39) and Debian 12 (glibc 2.36) too. The binary needs glibc <= 2.35.
- Runtime dependencies (declared by the packages, installed automatically):
  `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `libxtst6`, `libx11-6`, `libxi6`.
  `dbus-x11` and `xdg-utils` are *recommended*, not required.
- AppImage without FUSE (containers, minimal installs, Ubuntu 24.04 without `libfuse2t64`):
  run `./CodeCritter_*.AppImage --appimage-extract-and-run`, or `sudo apt install libfuse2t64`.

## Building from source

```bash
# Build dependencies (Debian / Ubuntu names)
sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libxdo-dev libxtst-dev libx11-dev libxi-dev libssl-dev patchelf build-essential file

npm ci
npm run dist:linux     # .deb + .rpm + .AppImage
```

`npm run dist:linux` deliberately turns `createUpdaterArtifacts` **off**. It is on in
`tauri.conf.json` for the signed release flow, so a plain `tauri build` fails at the end with
*"A public key has been found, but no private key"* unless `TAURI_SIGNING_PRIVATE_KEY` is set.
`release.yml` sets it from repository secrets and keeps the artifacts on.

Development: `npm run dev` (Vite on :5175 + the Tauri shell), `npm run playground` (browser overlay
with a mock bridge). `npm run test:rust` needs `npm run build` first, because
`tauri::generate_context!` embeds the built front end.

### Building a production-mode binary for local testing

`cargo build --release` on its own produces a binary that **silently fails at runtime**: blank overlay
and a "Could not connect to localhost" page in Settings. Tauri chooses between the embedded assets and
`devUrl` on the `custom-protocol` cargo feature, not on `debug_assertions`
(`tauri-macros`: `dev: cfg!(not(feature = "custom-protocol"))`), and only `tauri build` passes it. Use:

```bash
npm run build:release     # = npm run build && cargo build --release --features tauri/custom-protocol
./src-tauri/target/release/codecritter
```

Nothing in the app's log says what went wrong in the plain-`cargo build` case, which is why the script
exists. `npm run dist:linux` is the bundling equivalent and is what the shipped `.deb`/`.rpm`/AppImage
are built from.

## Sessions: X11 and Wayland

- **X11**: everything works — overlay, click-through, global input via XRecord, global shortcuts,
  fullscreen peek.
- **Wayland (GNOME / KDE)**: CodeCritter runs GTK/WebKit through **XWayland**. `GDK_BACKEND=x11` is set
  at startup when `WAYLAND_DISPLAY` *and* `DISPLAY` are both present, the user has not set
  `GDK_BACKEND`, and `CRITTER_WAYLAND` is not set. Native Wayland cannot position windows, keep them
  on top or report the global cursor, so the overlay would be unusable there. Make sure XWayland is
  installed (`xwayland` on Debian/Ubuntu, `xorg-xwayland` on Arch; installed by default on GNOME and
  KDE).
  - Opt out with `CRITTER_WAYLAND=1` (native Wayland: no positioning, no always-on-top, cursor
    tracking limited). Not recommended.
  - **Limits under XWayland**: global input (typing / scroll / clicks) and fullscreen-app detection
    see **X11 / XWayland clients only**. Native Wayland apps (GNOME Terminal, Wayland Firefox, most
    GTK4/Qt6 apps) are invisible to X11 input. Use the optional evdev mode below. GNOME shows no
    decorations for the overlay, which is intended.
  - Fractional scaling: XWayland renders at integer scale and is upscaled (slightly soft). Set
    `GDK_SCALE=2` to force a scale on X11.

## Optional evdev input mode (needed on Wayland)

Reads `/dev/input/event*` only to count key presses, clicks and wheel notches — key identities,
device names and everything else are never stored, forwarded or logged. **Off by default.**

1. Build with the feature: `cargo build --manifest-path src-tauri/Cargo.toml --release --features evdev`
   (release builds for the AUR/rolling distros ship it; `npm run dist:linux` does not).
2. Allow device access, then log out and back in (group membership needs a new login):
   `sudo usermod -aG input "$USER"`.
3. Opt in: `touch ~/.codecritter/evdev`, or start with `CRITTER_EVDEV=1`.
4. Restart CodeCritter. `CRITTER_DEBUG=1` prints `evdev input backend active (N devices)`.

Security note: members of the `input` group can read **every** keyboard device on the machine. Only
enable this if you accept that for your user account; it is the only way to see native Wayland apps
from a desktop companion. If CodeCritter sees no input for 90 s on a Wayland session it shows a
one-time bubble pointing at this section.

## Tray

Uses libayatana-appindicator (StatusNotifierItem). KDE, XFCE, Cinnamon and MATE work out of the box.
**GNOME has no tray host of its own**: install the *AppIndicator and KStatusNotifierItem Support*
extension (`sudo apt install gnome-shell-extension-appindicator`, then enable it in Extensions).
Without a tray host CodeCritter prints a diagnostic, keeps running, and shows a one-time bubble —
the app no longer aborts startup over a missing tray. Shortcuts still work:
<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> settings, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>
hide/show, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> peek.

## Autostart

The Settings toggle writes `~/.config/autostart/codecritter.desktop` by hand (the autostart plugin's
Linux path points at the AppImage mount, which changes on every run). Running from an AppImage it
points at the `.AppImage` file itself, so keep that file somewhere stable. Release builds only — a
debug build would register the dev executable.

## Updates and release ownership

Two separate things, and it is worth keeping them apart.

**1. Can this install replace itself?** The AppImage can: Settings or tray "Check for updates"
downloads, verifies (minisign) and installs, then restarts. A `.deb` / `.rpm` install **cannot** —
those files belong to the package manager. CodeCritter detects this and, instead of promising an
install, says *"Download it from the releases page"* and opens the releases page. Update your package
with `apt install ./CodeCritter_<version>_amd64.deb` (or your package manager). Settings > General
always shows which of the two applies to your copy.

**2. Whose releases are consumed?** The updater endpoint and the minisign public key are compiled in,
so every build — including one you compile yourself from this source tree — checks **one specific
project's** releases, currently `rsd-06/codecritter`. This matters when the running binary was not
built by that project:

- A copy built from a fork or from source **consumes the upstream project's releases**. Installing an
  update replaces the running binary with *that project's* build. CodeCritter says so in
  Settings > General and Settings > About rather than implying the update is a rebuild of your copy.
- The signature check is always on and is never bypassed. A build that cannot be signed by the
  configured publisher simply has no updater artifacts of its own; `npm run dist` then fails with
  *"A public key has been found, but no private key"* and `npm run dist:linux` is the unsigned
  variant (bundles only, no `latest.json`, no signature) — see [Building from source](#building-from-source).

To consume a *different* project's releases you must change `plugins.updater.endpoints` **and**
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json` together, and hold the matching private key
outside the repository. Changing one without the other does not disable verification — it makes every
update fail verification.

## WebKitGTK rendering

CodeCritter sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before GTK/WebKit initialise unless you have
already set it yourself. It is applied in `platform::linux::early_init()`, i.e. before
`tauri::Builder` runs, so it is inherited by the `WebKitWebProcess`.

Measured on this project's reference host (Ubuntu 22.04, GNOME, X11, WebKitGTK 2.50.4, hybrid
Intel UHD + RTX 2050) by looking at which render node the web process actually opens:

| `WEBKIT_DISABLE_DMABUF_RENDERER` | render node in use | overlay |
|---|---|---|
| unset (CodeCritter sets `1`) | `/dev/dri/renderD129` (NVIDIA) | renders |
| `1` | `/dev/dri/renderD129` (NVIDIA) | renders |
| `0` (DMA-BUF on) | `/dev/dri/renderD128` (Intel) | renders |

So the workaround is **not** required on that combination, and the two paths even use different GPUs.
It stays on anyway: the blank / glitchy transparent surface it exists to avoid could not be reproduced
here and is reported on other NVIDIA + WebKitGTK stacks. The table also shows why GPU detection is not
a usable gate — on a hybrid laptop, `nvidia-smi` being present says nothing about which adapter
WebKitGTK ends up rendering on. **Intel-only and AMD-only machines: NOT VERIFIED** (no hardware).

### Diagnosing a blank or transparent overlay

```bash
CRITTER_DEBUG=1 codecritter 2>&1 | head -20
```

CodeCritter prints which WebKit/GDK decisions it made:

```
[linux] WEBKIT_DISABLE_DMABUF_RENDERER=1 (defaulted by CodeCritter), GDK_BACKEND=<unset>
```

If the overlay is blank, try the other rendering path — this is the documented escape hatch and needs
no rebuild:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=0 codecritter
```

Other causes:

- **No compositor.** A transparent window needs one. Use a normal desktop session; in a VM or over a
  bare X server start with `WEBKIT_DISABLE_COMPOSITING_MODE=1` (and `LIBGL_ALWAYS_SOFTWARE=1`).
- **Wrong GPU.** On a hybrid laptop, check which adapter is in play with
  `ls -l /proc/$(pgrep -x Xorg)/fd | grep /dev/dri` and compare with the table above.
- **Driver version.** `glxinfo -B` reports the GL renderer actually in use (needs `mesa-utils`).
  NVIDIA drivers below 5xx were the common trigger for the DMA-BUF blank window.

## Other behaviour

- **Peek auto-detect** reads X11 EWMH: `_NET_ACTIVE_WINDOW` + `_NET_WM_STATE_FULLSCREEN`, with a
  geometry fallback (window covers its whole monitor and has no title bar). No window titles or
  process names are ever read, only the window class and pid. No titles → nothing to log.
- **Sound** is synthesised with WebAudio (no audio files, so no codec dependencies). WebKitGTK's
  "media requires a user gesture" restriction is lifted for CodeCritter's own windows, which is what
  lets the click-through overlay make sound.
- **Agent hooks**: with Node on `PATH` the bundled `critter-hook.mjs` is copied to `~/.codecritter/`
  and used; otherwise a `curl` shell script `~/.codecritter/critter-hook.sh` is written (optional
  `jq` adds the prompt text). The local event server binds **loopback only** and requires the token in
  `~/.codecritter/token` (mode 0600).
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set by default (the 64x64 pixel canvas does not need DMA-BUF).
  Setting the variable yourself always wins. See [WebKitGTK rendering](#webkitgtk-rendering) for the
  measurements behind that default and for the blank-overlay procedure.

## Packaging

`.deb`, `.rpm` and `.AppImage` are built by `npm run dist:linux` and produced under
`src-tauri/target/release/bundle/`.

`tools/linux-smoke.sh` runs **inside** a Debian/Ubuntu-family container (`MODE=deb` installs the
`.deb`, `MODE=appimage` runs the AppImage) under Xvfb + openbox and asserts:

- the app starts and stays alive and `GET /v1/health` answers,
- every shared library resolves from the declared dependencies alone (`ldd | grep 'not found'`),
- `desktop-file-validate` is clean,
- an overlay window exists with the exact case-sensitive `_NET_WM_NAME=CodeCritter`, is 256x224
  physical (the 128x112 stage at scale 2), and carries `_NET_WM_STATE_ABOVE` + `_SKIP_TASKBAR`,
- a token-authenticated `POST /v1/event` is accepted and the same request without a token is
  rejected with 401,
- the package then removes cleanly (`.deb` only).

It skips non-Debian/Ubuntu containers with a clear message; Fedora/RHEL is covered by installing the
generated RPM with `dnf` instead (Requires, `ldd`, launch under Xvfb, event POST, removal).

Local run:

```bash
npm run dist:linux
mkdir -p /tmp/cc-art /tmp/cc-out
cp src-tauri/target/release/bundle/deb/*.deb \
   src-tauri/target/release/bundle/appimage/*.AppImage /tmp/cc-art/
docker run --rm -v /tmp/cc-art:/w/art -v /tmp/cc-out:/w/out \
  -v "$PWD/tools/linux-smoke.sh:/w/linux-smoke.sh:ro" ubuntu:22.04 sh /w/linux-smoke.sh
```

What this does **not** prove: real GPU/WebKitGTK compositing, a real window manager's
always-on-top and stacking rules, the tray host, global shortcuts, or input capture. Those need a
real desktop session — see [Troubleshooting](#troubleshooting) for how to check them by hand.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank / black / transparent overlay | No compositor: a transparent window needs one. Use a normal desktop session, or start with `WEBKIT_DISABLE_COMPOSITING_MODE=1` (headless/VM). To try the other WebKitGTK rendering path, run `WEBKIT_DISABLE_DMABUF_RENDERER=0 codecritter`. Measurements and the full procedure: [WebKitGTK rendering](#webkitgtk-rendering) |
| No tray icon on GNOME | Install and enable the AppIndicator extension (above). The app still runs. |
| Character does not react to typing on Wayland | A native Wayland app has focus and XRecord cannot see it — use [evdev mode](#optional-evdev-input-mode-needed-on-wayland) |
| Overlay is behind other windows | Check `_NET_WM_STATE_ABOVE` with `xprop -id <id> _NET_WM_STATE`; some strict compositors ignore it for XWayland clients. |
| AppImage: `dlopen(): libfuse.so.2` | `--appimage-extract-and-run`, or `sudo apt install libfuse2` (`libfuse2t64` on 24.04). |
| `.deb` will not install on a very old distro | The binary needs glibc <= 2.35 (the Ubuntu 22.04 build baseline). Older than that, use the AppImage. |
| Two copies wanted | `CRITTER_MULTI=1` skips the single-instance guard (testing only). |

### Collecting logs

```bash
CRITTER_DEBUG=1 /usr/bin/codecritter 2> /tmp/critter.log
```

This prints the session/backend decision, the input hook state, the X11 fullscreen probe
(`peek poll: x11 fg=... -> fullscreen=...`), updater checks, tray failures and autostart write errors.
It never prints keystrokes, window titles or the token. Useful extras:

```bash
# What the compositor thinks about the overlay
xprop -id "$(xdotool search --name 'CodeCritter' | tail -1)" _NET_WM_STATE
# Is a tray host present?
dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus.NameHasOwner string:org.kde.StatusNotifierWatcher
# Is the local event server up? (PORT is in ~/.codecritter/port)
curl -s "http://127.0.0.1:$(cat ~/.codecritter/port)/v1/health"
```

## Maintainers: CI, release and AUR

- `.github/workflows/linux-smoke.yml` (push to `platform/**`, tags): builds `.deb` + AppImage on ubuntu-22.04, installs/runs them in ubuntu:22.04, ubuntu:24.04, debian:12 and archlinux containers under Xvfb + openbox, asserts `/v1/health`, an always-on-top skip-taskbar overlay and an accepted event, uploads screenshots. A second job runs `makepkg -si` on the PKGBUILD against the v0.2.1 release and smoke-runs the result. Local runs: `tools/linux-smoke.sh`, `tools/aur-test.sh`.
- Release builds Linux on ubuntu-22.04 with `--features evdev`.
- **Publishing to the AUR (needs your AUR account; not done by CI):**
  1. Create an account at https://aur.archlinux.org and add your SSH public key in *My Account*.
  2. After the GitHub release is published: `packaging/aur/update.sh <version>` (on Arch or in an `archlinux` container with `base-devel`) to set `pkgver`, the real `sha256sums` and regenerate `.SRCINFO`.
  3. `git clone ssh://aur@aur.archlinux.org/codecritter-bin.git aur-codecritter-bin`, copy `PKGBUILD` and `.SRCINFO` from `packaging/aur/codecritter-bin/` into it.
  4. `git add PKGBUILD .SRCINFO && git commit -m "codecritter-bin <version>" && git push` (branch `master`).
  5. Each release: repeat 2-4.

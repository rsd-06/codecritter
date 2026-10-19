#!/bin/sh
# Linux smoke test, meant to run INSIDE a Debian/Ubuntu-family container (ubuntu:22.04, ubuntu:24.04,
# debian:12). Installs the built .deb (MODE=deb) or runs the AppImage (MODE=appimage) under
# Xvfb + openbox, then checks:
#   * the app stays alive, the loopback server answers GET /v1/health
#   * every shared library resolves from the declared dependencies alone (.deb)
#   * desktop-file-validate is clean (.deb)
#   * an overlay window exists, is 256x224, is "above" and skips the taskbar
#   * an accepted agent event (token auth works) and a rejected one (no token)
#   * the overlay actually painted (blank-window regression guard)
#   * the package removes cleanly (.deb)
# and writes a screenshot + the app log to $OUT.
# This proves packaging + startup on a *clean* distro; it does NOT prove X11/Wayland compositor
# behaviour, the tray host, global shortcuts, GPU compositing or input capture (Xvfb has no real
# compositor, GPU or tray host). See docs/linux.md for those manual checks.
# Env: ART (dir with CodeCritter_*.deb / *.AppImage, default /w/art, may be read-only),
#      OUT (default /w/out), MODE (deb|appimage)
set -eu

ART="${ART:-/w/art}"
OUT="${OUT:-/w/out}"
MODE="${MODE:-deb}"
mkdir -p "$OUT"
# shellcheck disable=SC1091
. /etc/os-release
TAG="$ID-${VERSION_ID:-rolling}-$MODE"
echo "== smoke: $TAG =="

export DEBIAN_FRONTEND=noninteractive
case "${ID:-}" in
  debian | ubuntu)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    TOOLS="xvfb xdotool x11-utils imagemagick curl openbox dbus-x11 ca-certificates xdg-utils desktop-file-utils"
    if [ "$MODE" = deb ]; then
      DEB=$(ls "$ART"/*.deb | head -1)
      # shellcheck disable=SC2086
      apt-get install -y -qq $TOOLS "$DEB" >"$OUT/install-$TAG.log" 2>&1 || { tail -40 "$OUT/install-$TAG.log"; exit 1; }
      PKG=$(dpkg-deb -f "$DEB" Package)
      BIN=$(dpkg -L "$PKG" | grep '^/usr/bin/' | head -1)
      dpkg-deb -I "$DEB" | sed -n '/Depends/p'
      # Every shared library the binary needs must resolve from the declared dependencies alone.
      MISSING=$(ldd "$BIN" | grep 'not found' || true)
      if [ -n "$MISSING" ]; then echo "FAIL: unresolved libraries"; echo "$MISSING"; exit 1; fi
      echo "ldd: all libraries resolved"
      DESKTOP=$(dpkg -L "$PKG" | grep '\.desktop$' | head -1)
      desktop-file-validate "$DESKTOP" && echo "desktop-file-validate: clean"
    else
      # shellcheck disable=SC2086
      apt-get install -y -qq $TOOLS libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libxtst6 file \
        >"$OUT/install-$TAG.log" 2>&1 || { tail -40 "$OUT/install-$TAG.log"; exit 1; }
    fi
    ;;
  arch)
    case "$MODE" in appimage | pkg) ;; *) echo "arch: appimage / pkg mode only"; exit 0 ;; esac
    # MODE=pkg: codecritter-bin was already installed by tools/aur-test.sh in this container.
    [ "$MODE" != pkg ] || BIN=$(pacman -Ql codecritter-bin | awk '/\/usr\/bin\/[^\/]+$/ {print $2; exit}')
    pacman -Sy --noconfirm --needed webkit2gtk-4.1 gtk3 libayatana-appindicator xdotool xorg-server-xvfb \
      imagemagick curl openbox dbus xdg-utils libxtst xorg-xprop xorg-xwininfo xorg-xdpyinfo file >"$OUT/install-$TAG.log" 2>&1 \
      || { tail -30 "$OUT/install-$TAG.log"; exit 1; }
    ;;
  *)
    echo "unsupported distro $ID"
    exit 1
    ;;
esac

if [ "$MODE" = appimage ]; then
  AI=$(ls "$ART"/*.AppImage | head -1)
  # The artifact directory is often mounted read-only in CI, so only touch the exec bit when it is
  # actually missing rather than unconditionally chmod-ing a read-only mount.
  if [ ! -x "$AI" ]; then
    chmod +x "$AI" || {
      echo "FAIL: $AI is not executable and the artifact directory is not writable"; exit 1;
    }
  fi
  # No FUSE inside containers: always use the documented fallback.
  BIN="$AI --appimage-extract-and-run"
fi

export HOME=/tmp/home XDG_RUNTIME_DIR=/tmp/xdg DISPLAY=:99 CRITTER_MULTI=1 CRITTER_DEBUG=1
# Software rendering: containers have no GPU.
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1
mkdir -p "$HOME" && mkdir -p -m 700 "$XDG_RUNTIME_DIR"

Xvfb :99 -screen 0 1280x800x24 >"$OUT/xvfb-$TAG.log" 2>&1 &
XVFB_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
openbox >"$OUT/openbox-$TAG.log" 2>&1 &
OB_PID=$!
sleep 1

# `setsid` puts the app in its own session so the whole tree can be signalled later: in AppImage mode
# `dbus-run-session` spawns an --appimage-extract-and-run child that outlives it, and without this the
# container would stay alive until the outer timeout even though every assertion passed.
# shellcheck disable=SC2086
setsid dbus-run-session -- $BIN >"$OUT/app-$TAG.log" 2>&1 &
APP=$!

# Kill the app and everything it started, then make sure it really is gone.
stop_app() {
  kill -TERM "-$APP" 2>/dev/null || kill -TERM "$APP" 2>/dev/null || true
  i=0
  while kill -0 "$APP" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -gt 15 ] && { kill -KILL "-$APP" 2>/dev/null || kill -KILL "$APP" 2>/dev/null || true; break; }
    sleep 1
  done
  sleep 1
}
stop_bg() {
  stop_app
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
  [ -n "${OB_PID:-}" ] && kill "$OB_PID" 2>/dev/null
  return 0
}
trap stop_bg EXIT INT TERM

PORT=47626
OK=0
for _ in $(seq 1 60); do
  [ -s "$HOME/.codecritter/port" ] && PORT=$(cat "$HOME/.codecritter/port")
  if curl -sf "http://127.0.0.1:$PORT/v1/health" >"$OUT/health-$TAG.json" 2>/dev/null; then OK=1; break; fi
  kill -0 "$APP" 2>/dev/null || break
  sleep 1
done
if [ "$OK" != 1 ]; then
  echo "FAIL: /v1/health never answered"; tail -50 "$OUT/app-$TAG.log"; exit 1
fi
echo "health: $(cat "$OUT/health-$TAG.json")"

# Overlay window: present, above, skip-taskbar.
# `xdotool search --name` matches case-insensitively, so it also returns GTK's 10x10 group-leader
# window ("codecritter"). Pick by the exact (case-sensitive) _NET_WM_NAME / WM_CLASS instead.
sleep 4
WID=""
for w in $(xdotool search --name 'odecritter' 2>/dev/null || true); do
  # xprop prints `_NET_WM_NAME(UTF8_STRING) = "CodeCritter"`; strip type and quotes.
  N=$(xprop -id "$w" -notype _NET_WM_NAME 2>/dev/null | sed 's/^[^=]*= *//; s/^"//; s/"$//')
  [ "$N" = "CodeCritter" ] && WID="$w"
done
if [ -z "$WID" ]; then
  xwininfo -root -tree >"$OUT/tree-$TAG.txt" 2>&1 || true
  echo "FAIL: no overlay window found"; tail -30 "$OUT/app-$TAG.log"; exit 1
fi
GEOM=$(xdotool getwindowgeometry --shell "$WID" | tr '\n' ' ')
STATE=$(xprop -id "$WID" _NET_WM_STATE 2>/dev/null || true)
echo "overlay $WID: $GEOM"
echo "overlay $WID: $STATE"
# The stage is 128x112 logical; at scale 2 that is 256x224 physical. Any other size means the overlay
# was built or scaled wrong.
case "$GEOM" in *"WIDTH=256 HEIGHT=224"*) ;; *) echo "FAIL: overlay is not 256x224"; exit 1 ;; esac
case "$STATE" in *ABOVE*) ;; *) echo "FAIL: overlay is not always-on-top"; exit 1 ;; esac
case "$STATE" in *SKIP_TASKBAR*) ;; *) echo "FAIL: overlay is not skip-taskbar"; exit 1 ;; esac

# An agent event is accepted (token auth works), and rejected without one.
TOKEN=$(cat "$HOME/.codecritter/token" 2>/dev/null || true)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -H "X-Critter-Token: $TOKEN" -d '{"agent":"claude-code","type":"done"}' "http://127.0.0.1:$PORT/v1/event" || true)
echo "event POST (token) -> $CODE"
case "$CODE" in 2*) ;; *) echo "FAIL: event not accepted"; exit 1 ;; esac
ANON=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"agent":"claude-code","type":"done"}' "http://127.0.0.1:$PORT/v1/event" || true)
echo "event POST (no token) -> $ANON"
case "$ANON" in 401) ;; *) echo "FAIL: unauthenticated event was not rejected"; exit 1 ;; esac

sleep 2
import -window root "$OUT/shot-$TAG.png" || true
kill -0 "$APP" 2>/dev/null || { echo "FAIL: app died"; tail -50 "$OUT/app-$TAG.log"; exit 1; }

# The overlay must actually have PAINTED, not merely exist. A binary that selects the dev asset server
# (plain `cargo build --release`, i.e. no `custom-protocol`) still creates a correct 256x224 window with
# ABOVE+SKIP_TASKBAR and still answers /v1/health, but renders a blank white surface -- every other check
# above would pass. Measured reference points: a rendered overlay has ~16 distinct colours, a blank one 1.
import -window "$WID" "$OUT/overlay-$TAG.png" || true
COLOURS=$(identify -format '%k' "$OUT/overlay-$TAG.png" 2>/dev/null || echo '')
case "$COLOURS" in
  '' | *[!0-9]*) echo "FAIL: could not measure the overlay capture"; exit 1 ;;
esac
echo "overlay distinct colours: $COLOURS"
if [ "$COLOURS" -lt 8 ]; then
  echo "FAIL: the overlay rendered blank ($COLOURS distinct colours, expected >= 8)."
  echo "      A correct-looking window with no pixels is the dev-asset-server symptom:"
  echo "      rebuild with 'npm run build:release' (--features tauri/custom-protocol)."
  exit 1
fi

stop_app

# Removal must leave nothing behind (deb only; the AppImage is not installed).
if [ "$MODE" = deb ]; then
  echo "== removal =="
  apt-get remove -y -qq "$PKG" >"$OUT/remove-$TAG.log" 2>&1 || { tail -20 "$OUT/remove-$TAG.log"; exit 1; }
  if [ -e "$BIN" ]; then echo "FAIL: $BIN still present after remove"; exit 1; fi
  echo "remove: clean"
fi
if [ "$MODE" = pkg ] && [ "${ID:-}" = "arch" ]; then
  echo "== removal =="
  pacman -R --noconfirm codecritter-bin >"$OUT/remove-$TAG.log" 2>&1 || { tail -20 "$OUT/remove-$TAG.log"; exit 1; }
  echo "remove: clean"
fi
echo "OK: $TAG"

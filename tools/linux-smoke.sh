#!/bin/sh
# Linux smoke test, meant to run INSIDE a distro container (ubuntu:22.04, ubuntu:24.04, debian:12, archlinux).
# Installs the built .deb (MODE=deb) or runs the AppImage (MODE=appimage) under Xvfb + openbox, then checks:
#   * the app stays alive, the loopback server answers GET /v1/health
#   * an overlay window exists and is "above" (always on top) and skips the taskbar
#   * a test agent event is accepted
# and writes a screenshot + the app log to $OUT.
# Env: ART (dir with CodeCritter_*.deb / *.AppImage, default /w/art), OUT (default /w/out), MODE (deb|appimage)
set -eu

ART="${ART:-/w/art}"
OUT="${OUT:-/w/out}"
MODE="${MODE:-deb}"
mkdir -p "$OUT"
# shellcheck disable=SC1091
. /etc/os-release
TAG="$ID-${VERSION_ID:-rolling}-$MODE"
echo "== smoke: $TAG =="

case "$ID" in
  ubuntu | debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    TOOLS="xvfb xdotool x11-utils imagemagick curl openbox dbus-x11 ca-certificates xdg-utils"
    if [ "$MODE" = deb ]; then
      DEB=$(ls "$ART"/*.deb | head -1)
      # shellcheck disable=SC2086
      apt-get install -y -qq $TOOLS "$DEB" >"$OUT/install-$TAG.log" 2>&1 || { cat "$OUT/install-$TAG.log"; exit 1; }
      PKG=$(dpkg-deb -f "$DEB" Package)
      BIN=$(dpkg -L "$PKG" | grep '^/usr/bin/' | head -1)
      dpkg -L "$PKG" | grep -E '\.desktop$|/icons/' | head -5
      grep -q '^Categories=' "$(dpkg -L "$PKG" | grep '\.desktop$' | head -1)"
    else
      # shellcheck disable=SC2086
      apt-get install -y -qq $TOOLS libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libxdo3 libxtst6 file \
        >"$OUT/install-$TAG.log" 2>&1 || { cat "$OUT/install-$TAG.log"; exit 1; }
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
  *) echo "unsupported distro $ID"; exit 1 ;;
esac

if [ "$MODE" = appimage ]; then
  AI=$(ls "$ART"/*.AppImage | head -1)
  chmod +x "$AI"
  # No FUSE inside containers: always use the documented fallback.
  BIN="$AI --appimage-extract-and-run"
fi

export HOME=/tmp/home XDG_RUNTIME_DIR=/tmp/xdg DISPLAY=:99 CRITTER_MULTI=1 CRITTER_DEBUG=1
# Software rendering: containers have no GPU.
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1
mkdir -p "$HOME" && mkdir -p -m 700 "$XDG_RUNTIME_DIR"

Xvfb :99 -screen 0 1280x800x24 >"$OUT/xvfb-$TAG.log" 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10; do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
openbox >"$OUT/openbox-$TAG.log" 2>&1 &
sleep 1

# shellcheck disable=SC2086
dbus-run-session -- $BIN >"$OUT/app-$TAG.log" 2>&1 &
APP=$!

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
sleep 4
WID=$(xdotool search --name '^CodeCritter$' 2>/dev/null | head -1 || true)
if [ -z "$WID" ]; then
  xwininfo -root -tree >"$OUT/tree-$TAG.txt" 2>&1 || true
  echo "FAIL: no overlay window found"; exit 1
fi
STATE=$(xprop -id "$WID" _NET_WM_STATE 2>/dev/null || true)
echo "overlay $WID: $STATE"
case "$STATE" in *ABOVE*) ;; *) echo "FAIL: overlay is not always-on-top"; exit 1 ;; esac
case "$STATE" in *SKIP_TASKBAR*) ;; *) echo "FAIL: overlay is not skip-taskbar"; exit 1 ;; esac

# An agent event is accepted (token auth works).
TOKEN=$(cat "$HOME/.codecritter/token" 2>/dev/null || true)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -H "X-Critter-Token: $TOKEN" -d '{"agent":"claude-code","type":"done"}' "http://127.0.0.1:$PORT/v1/event" || true)
echo "event POST -> $CODE"
case "$CODE" in 2*) ;; *) echo "FAIL: event not accepted"; exit 1 ;; esac

sleep 2
import -window root "$OUT/shot-$TAG.png" || true
kill -0 "$APP" 2>/dev/null || { echo "FAIL: app died"; tail -50 "$OUT/app-$TAG.log"; exit 1; }
echo "OK: $TAG"
kill "$APP" 2>/dev/null || true

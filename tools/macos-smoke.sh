#!/bin/bash
# macOS smoke test (run on a macOS CI runner): install the .dmg, launch the app, check it.
# Usage: tools/macos-smoke.sh <path-to.dmg> <output-dir>
# CI runners have no Accessibility / Input Monitoring grant, so the app must run with input disabled.
set -uo pipefail
DMG="$1"
OUT="$2"
mkdir -p "$OUT"
APP=/Applications/CodeCritter.app
FAIL=0
fail() { echo "SMOKE FAIL: $*" | tee -a "$OUT/summary.txt"; FAIL=1; }
ok() { echo "SMOKE ok:   $*" | tee -a "$OUT/summary.txt"; }

echo "host: $(uname -m) $(sw_vers -productVersion)" | tee "$OUT/summary.txt"

# ---- install from the dmg
hdiutil attach "$DMG" -mountpoint /tmp/cc-mnt -nobrowse -quiet || { fail "dmg did not mount"; exit 1; }
ls -la /tmp/cc-mnt | tee "$OUT/dmg-contents.txt"
rm -rf "$APP"
cp -R /tmp/cc-mnt/CodeCritter.app /Applications/ || fail "copy to /Applications"
hdiutil detach /tmp/cc-mnt -quiet || true
[ -d "$APP" ] || { fail "no app in the dmg"; exit 1; }

# ---- static checks
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")
codesign -dv --verbose=4 "$APP" > "$OUT/codesign.txt" 2>&1
cat "$OUT/codesign.txt"
grep -q "Signature=adhoc" "$OUT/codesign.txt" && ok "ad-hoc signature" || fail "not ad-hoc signed"
codesign --verify --deep --strict "$APP" 2> "$OUT/codesign-verify.txt" && ok "codesign --verify --deep" || fail "codesign verify: $(cat "$OUT/codesign-verify.txt")"
ARCHS=$(lipo -archs "$APP/Contents/MacOS/$EXE")
echo "archs: $ARCHS" | tee -a "$OUT/summary.txt"
case "$ARCHS" in *arm64*x86_64* | *x86_64*arm64*) ok "universal binary" ;; *) fail "not universal: $ARCHS" ;; esac
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$APP/Contents/Info.plist")" = "true" ] && ok "LSUIElement (no Dock icon)" || fail "LSUIElement missing"
[ -f "$APP/Contents/Resources/bin/critter-hook.mjs" ] && ok "hook script bundled in Resources/bin" || fail "critter-hook.mjs missing from Resources/bin"
echo "min system: $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist")" | tee -a "$OUT/summary.txt"

# ---- launch via LaunchServices, like a double click
rm -rf "$HOME/.codecritter"
: > "$OUT/app.log"
screencapture -x "$OUT/00-before.png" || true
open -n "$APP" --env CRITTER_DEBUG=1 --stdout "$OUT/app.log" --stderr "$OUT/app.log"
HEALTH=""
for i in $(seq 1 60); do
  HEALTH=$(curl -sf --max-time 2 http://127.0.0.1:47626/v1/health || true)
  [ -n "$HEALTH" ] && break
  sleep 1
done
if [ -n "$HEALTH" ]; then ok "health after ${i}s: $HEALTH"; else fail "no /v1/health within 60 s"; fi

PID=$(pgrep -f "$APP/Contents/MacOS/$EXE" | head -1 || true)
[ -n "$PID" ] && ok "process running (pid $PID)" || fail "process not running"
sleep 6 # overlay load + window re-assert + first-run bubble (4 s delay)

# ---- window facts (layer 25 = status level) and a screenshot
if [ -n "$PID" ]; then
  swift "$(dirname "$0")/macos-windows.swift" "$PID" 2>&1 | tee "$OUT/windows.txt"
  grep -q "layer=25" "$OUT/windows.txt" && ok "overlay window is at status level (25)" || fail "no layer-25 window"
fi
screencapture -x "$OUT/01-overlay.png" || fail "screencapture"

# ---- drive a reaction through the agent API (token from ~/.codecritter)
if [ -f "$HOME/.codecritter/token" ]; then
  T=$(cat "$HOME/.codecritter/token")
  for ty in thinking done; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -H "X-Critter-Token: $T" \
      -d "{\"agent\":\"claude-code\",\"type\":\"$ty\",\"message\":\"macOS smoke\"}" http://127.0.0.1:47626/v1/event)
    [ "$CODE" = "200" ] && ok "agent event $ty accepted" || fail "agent event $ty -> HTTP $CODE"
    sleep 2
    screencapture -x "$OUT/02-agent-$ty.png" || true
  done
else
  fail "no ~/.codecritter/token"
fi

# ---- input permission must be reported, not crash
grep -E "input access|input tap|overlay NSWindow" "$OUT/app.log" | tee "$OUT/input-lines.txt" || true
grep -q "input access:" "$OUT/app.log" && ok "input access state logged" || fail "no input access log line"

# ---- quit cleanly
[ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null
for i in $(seq 1 10); do pgrep -f "$APP/Contents/MacOS/$EXE" >/dev/null || break; sleep 1; done
pgrep -f "$APP/Contents/MacOS/$EXE" >/dev/null && { fail "still running after SIGTERM"; pkill -9 -f "$APP/Contents/MacOS/$EXE"; } || ok "quit on SIGTERM"
if ls "$HOME/Library/Logs/DiagnosticReports" 2>/dev/null | grep -i codecritter > "$OUT/crash-reports.txt"; then
  fail "crash report(s): $(cat "$OUT/crash-reports.txt")"
  cp "$HOME"/Library/Logs/DiagnosticReports/*odecritter* "$OUT/" 2>/dev/null || true
fi
exit $FAIL

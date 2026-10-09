# CodeCritter on macOS

Supported: macOS 13+, Apple Silicon and Intel (one universal `.dmg`). CI installs and launches the
app on macOS 14 (arm64) and macOS 15 (Intel) for every push to `platform/**` and every tag
(`.github/workflows/macos-smoke.yml`).

## First run (unsigned build)
Releases are **ad-hoc signed, not notarized** (no Apple Developer account yet), so Gatekeeper warns:

1. Open the `.dmg`, drag CodeCritter to Applications.
2. Right-click the app, choose **Open**, then **Open** again; or run
   `xattr -dr com.apple.quarantine /Applications/CodeCritter.app`.
3. CodeCritter lives in the menu bar (no Dock icon). Click the menu-bar icon for the menu.
4. macOS asks to allow **Input Monitoring**. CodeCritter only counts keystrokes and clicks, never which
   keys. Choose Open System Settings and switch CodeCritter on (Privacy & Security > Input Monitoring).
   Reactions start within a few seconds, no restart needed. Until then only mouse movement is noticed;
   the app never crashes or hangs without the permission, and Settings shows a banner with a button.
5. Ad-hoc signatures change with every build, so after an update macOS may ask for Input Monitoring
   again. A Developer ID signature fixes that.

Shortcuts: Cmd+Option+P (peek), Cmd+Option+H (hide/show), Cmd+Option+S (settings).

## What is implemented
Overlay: transparent, no shadow, NSWindow level 25 (status), on every Space and over fullscreen apps
(`platform/macos/overlay.rs`). Input: own listen-only CGEventTap (`platform/macos/input.rs`).
Auto peek: fullscreen app detection from window bounds (`platform/macos/fullscreen.rs`).
Tray: template icon. Autostart: LaunchAgent. Agent hooks: `Contents/Resources/bin/critter-hook.mjs`
with a `critter-hook.sh` fallback. Updater: signed `.app.tar.gz` (same minisign key as Windows).

## Limits
- Not tested on a physical Mac by a human: CI proves launch, signature, window level, transparency,
  health endpoint and agent events, but not real keystroke reactions, sound, Spaces switching or fullscreen peek.
- Zoomed windows with an auto-hidden menu bar can look like fullscreen to peek (only a hint).
- The Dock may show a recent-apps tile for CodeCritter even though it is `LSUIElement`.

## Signing and notarization (when you have an Apple Developer account)
1. Join the Apple Developer Program (99 USD/year). Create a **Developer ID Application** certificate,
   export it from Keychain Access as `.p12`, then `base64 -i cert.p12 | pbcopy`.
2. Create an app-specific password at appleid.apple.com. Find your Team ID in the developer portal.
3. Add repository secrets (Settings > Secrets > Actions):
   `APPLE_CERTIFICATE` (base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
   (`Developer ID Application: Name (TEAMID)`), and for notarization `APPLE_ID`, `APPLE_PASSWORD`
   (app-specific password), `APPLE_TEAM_ID`.
4. Push a `v*` tag. `release.yml` detects the secrets and signs (+ notarizes) automatically; without them
   it keeps the ad-hoc identity. Then remove the quarantine `postflight` from the cask.

## Homebrew cask
`packaging/homebrew/codecritter.rb` installs the universal dmg. To publish (needs your approval):
1. Create the GitHub repo `rsd-06/homebrew-tap`; copy the file to `Casks/codecritter.rb`.
2. After each release set `version` and `sha256` (`shasum -a 256 CodeCritter_<v>_universal.dmg`) and push.
3. Users: `brew install --cask rsd-06/tap/codecritter`. `livecheck` tracks the latest GitHub release.

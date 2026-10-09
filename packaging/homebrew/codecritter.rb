# Homebrew cask for CodeCritter (universal .dmg: Apple Silicon + Intel).
# Lives in the tap repo rsd-06/homebrew-tap as Casks/codecritter.rb (see docs/macos.md).
# Install:  brew install --cask rsd-06/tap/codecritter
#
# Per release: bump `version` and `sha256` (shasum -a 256 CodeCritter_<version>_universal.dmg).
cask "codecritter" do
  version "0.2.1"
  sha256 "REPLACE_WITH_SHA256_OF_THE_UNIVERSAL_DMG"

  url "https://github.com/rsd-06/codecritter/releases/download/v#{version}/CodeCritter_#{version}_universal.dmg",
      verified: "github.com/rsd-06/codecritter/"
  name "CodeCritter"
  desc "Pixel desktop companion (Stitch & Yoda) for developers"
  homepage "https://github.com/rsd-06/codecritter"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app checks for updates itself (signed updater); brew upgrade still works.
  auto_updates true
  depends_on macos: ">= :ventura"

  app "CodeCritter.app"

  # Builds are ad-hoc signed, not notarized (no Apple Developer account yet), so Gatekeeper would
  # block the first launch. Remove this block once releases are notarized.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/CodeCritter.app"],
                   sudo: false
  end

  uninstall quit: "dev.codecritter.app"

  zap trash: [
    "~/.codecritter",
    "~/Library/Application Support/dev.codecritter.app",
    "~/Library/Caches/dev.codecritter.app",
    "~/Library/LaunchAgents/CodeCritter.plist",
    "~/Library/WebKit/dev.codecritter.app",
  ]

  caveats <<~EOS
    CodeCritter is a menu-bar app (no Dock icon). This build is not notarized by Apple; the cask
    clears the quarantine flag so it opens normally. If macOS still blocks it, right-click the app,
    choose Open, or run:
      xattr -dr com.apple.quarantine /Applications/CodeCritter.app

    To react to your typing, CodeCritter needs Input Monitoring:
      System Settings > Privacy & Security > Input Monitoring > CodeCritter
    It only counts keystrokes, never which keys. Ad-hoc signed updates change the app's identity, so
    macOS may ask for this again after an update until releases are signed with a Developer ID.
  EOS
end

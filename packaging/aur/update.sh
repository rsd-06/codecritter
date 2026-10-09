#!/bin/sh
# Usage: packaging/aur/update.sh <version>   e.g. 0.2.1
# Downloads the release .deb, writes pkgver / sha256sums into the PKGBUILD and regenerates .SRCINFO
# (makepkg --printsrcinfo; run inside an Arch container or on Arch, as a non-root user).
set -eu
VER="${1:?version, e.g. 0.2.1}"
DIR="$(cd "$(dirname "$0")/codecritter-bin" && pwd)"
URL="https://github.com/rsd-06/codecritter/releases/download/v${VER}/CodeCritter_${VER}_amd64.deb"
TMP="$(mktemp)"
curl -fL --retry 3 -o "$TMP" "$URL"
SUM="$(sha256sum "$TMP" | cut -d' ' -f1)"
rm -f "$TMP"
sed -i -e "s/^pkgver=.*/pkgver=${VER}/" -e "s/^pkgrel=.*/pkgrel=1/" \
  -e "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('${SUM}')/" "$DIR/PKGBUILD"
if command -v makepkg >/dev/null 2>&1; then
  (cd "$DIR" && makepkg --printsrcinfo >.SRCINFO)
else
  echo "makepkg not found: regenerate .SRCINFO on Arch with: (cd $DIR && makepkg --printsrcinfo > .SRCINFO)"
fi
echo "PKGBUILD -> ${VER} (${SUM})"

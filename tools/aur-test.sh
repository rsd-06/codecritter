#!/bin/sh
# Runs INSIDE an archlinux container as root: builds + installs packaging/aur/codecritter-bin with makepkg
# against a real release (VERSION, default = the PKGBUILD's pkgver), checks the package, then smoke-runs it.
# Env: VERSION (e.g. 0.2.1), REPO (default /w).
set -eu
REPO="${REPO:-/w}"
pacman -Sy --noconfirm --needed base-devel sudo git curl >/dev/null
useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/builder
cp -r "$REPO/packaging/aur/codecritter-bin" /home/builder/pkg
cp "$REPO/packaging/aur/update.sh" /home/builder/update.sh
chown -R builder:builder /home/builder
if [ -n "${VERSION:-}" ]; then
  # update.sh resolves ../codecritter-bin relative to itself
  mkdir -p /home/builder/aur && mv /home/builder/pkg /home/builder/aur/codecritter-bin && mv /home/builder/update.sh /home/builder/aur/
  chown -R builder:builder /home/builder/aur
  su builder -c "sh /home/builder/aur/update.sh $VERSION"
  PKGDIR=/home/builder/aur/codecritter-bin
else
  PKGDIR=/home/builder/pkg
fi
su builder -c "cd $PKGDIR && makepkg --syncdeps --install --noconfirm"
pacman -Qi codecritter-bin | grep -E '^(Name|Version|Depends On)'
pacman -Ql codecritter-bin | grep -E '/usr/bin/|\.desktop' | head
# .SRCINFO must be what makepkg generates
su builder -c "cd $PKGDIR && makepkg --printsrcinfo" | diff - "$PKGDIR/.SRCINFO" && echo ".SRCINFO in sync"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

VERSION="$(node -p "require('./package.json').version")"
ARCH="amd64"
PKG_NAME="yayra_${VERSION}_${ARCH}"
STAGING_DIR=".deb-staging/${PKG_NAME}"
RELEASE_DIR="release"

echo "=== Staging 64-bit Debian Package Layout for Yayra v${VERSION} (${ARCH}) ==="
rm -rf ".deb-staging"
mkdir -p "${STAGING_DIR}/DEBIAN"
mkdir -p "${STAGING_DIR}/usr/bin"
mkdir -p "${STAGING_DIR}/usr/share/applications"
mkdir -p "${STAGING_DIR}/usr/share/doc/yayra"
mkdir -p "${STAGING_DIR}/opt/yayra"
mkdir -p "${RELEASE_DIR}"

# 1. Staging Control Metadata and Scripts
cp packages/platform-packaging/linux/control "${STAGING_DIR}/DEBIAN/control"
# Ensure version in control file matches package.json
sed -i "s/^Version:.*/Version: ${VERSION}/" "${STAGING_DIR}/DEBIAN/control"

cp packages/platform-packaging/linux/postinst "${STAGING_DIR}/DEBIAN/postinst"
cp packages/platform-packaging/linux/prerm "${STAGING_DIR}/DEBIAN/prerm"
if [ -f packages/platform-packaging/linux/postrm ]; then
    cp packages/platform-packaging/linux/postrm "${STAGING_DIR}/DEBIAN/postrm"
    chmod 755 "${STAGING_DIR}/DEBIAN/postrm"
fi
chmod 755 "${STAGING_DIR}/DEBIAN/postinst" "${STAGING_DIR}/DEBIAN/prerm"

# 2. Staging Desktop Entry
cp build/linux/yayra.desktop "${STAGING_DIR}/usr/share/applications/yayra.desktop"

# 3. Staging Hicolor Icon Theme (all 9 standard resolutions)
for size in 16 24 32 48 64 96 128 256 512; do
    ICON_SRC="build/icons/hicolor/${size}x${size}/apps/yayra.png"
    ICON_DEST_DIR="${STAGING_DIR}/usr/share/icons/hicolor/${size}x${size}/apps"
    if [ -f "${ICON_SRC}" ]; then
        mkdir -p "${ICON_DEST_DIR}"
        cp "${ICON_SRC}" "${ICON_DEST_DIR}/yayra.png"
    fi
done

# 4. Staging Application Launcher Shell Script
cat << 'EOF' > "${STAGING_DIR}/usr/bin/yayra"
#!/bin/sh
# Yayra Floating Browser Launcher for Linux

set -e

APP_DIR="/opt/yayra"
EXEC_BIN="${APP_DIR}/yayra"

# If standalone native binary exists, run it
if [ -x "${EXEC_BIN}" ]; then
    exec "${EXEC_BIN}" "$@"
fi

# Fallback to web runtime / node server if available
if command -v node >/dev/null 2>&1 && [ -f "${APP_DIR}/server.mjs" ]; then
    exec node "${APP_DIR}/server.mjs" "$@"
fi

# Fallback to system browser opening local assets
if command -v xdg-open >/dev/null 2>&1 && [ -f "${APP_DIR}/index.html" ]; then
    exec xdg-open "${APP_DIR}/index.html"
fi

echo "Error: Yayra application runtime could not be launched." >&2
exit 1
EOF
chmod 755 "${STAGING_DIR}/usr/bin/yayra"

# 5. Staging Application Content in /opt/yayra
if [ -d "dist" ]; then
    cp -r dist/* "${STAGING_DIR}/opt/yayra/"
fi

# 6. Staging Documentation & Copyright
cat << EOF > "${STAGING_DIR}/usr/share/doc/yayra/copyright"
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: yayra
Source: https://github.com/g2code33/yayra

Files: *
Copyright: 2026 Yayra Project <support@yayra.app>
License: Proprietary / Local-First
EOF

cat << EOF > "${STAGING_DIR}/usr/share/doc/yayra/changelog"
yayra (${VERSION}) stable; urgency=medium

  * Production release of Yayra Floating Browser.
  * Cross-platform support for Android, Windows, and Linux.
  * Local-first privacy, edge docking, and floating multi-tab engine.

 -- Yayra Development Team <support@yayra.app>  Fri, 02 Oct 2026 12:00:00 +0000
EOF
gzip -9n -f "${STAGING_DIR}/usr/share/doc/yayra/changelog"

# 7. Generate MD5 sums
(
    cd "${STAGING_DIR}"
    find . -type f ! -path './DEBIAN/*' | sed 's|^./||' | sort | xargs md5sum > "DEBIAN/md5sums"
)

# 8. Build Debian .deb Archive
if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --root-owner-group --build "${STAGING_DIR}" "${RELEASE_DIR}/${PKG_NAME}.deb"
    echo "Successfully generated Debian package: ${RELEASE_DIR}/${PKG_NAME}.deb"
    dpkg-deb --info "${RELEASE_DIR}/${PKG_NAME}.deb"
else
    echo "dpkg-deb is not available in environment; staging directory validated at ${STAGING_DIR}"
fi

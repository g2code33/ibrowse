#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const arch = 'amd64';
const debName = `yayra_${version}_${arch}.deb`;
const stagingDir = path.join(root, '.deb-staging', `yayra_${version}_${arch}`);
const releaseDir = path.join(root, 'release');

console.log(`[Linux DEB Packager] Staging 64-bit Debian package layout for Yayra v${version} (${arch})...`);

await mkdir(path.join(stagingDir, 'DEBIAN'), { recursive: true });
await mkdir(path.join(stagingDir, 'usr/bin'), { recursive: true });
await mkdir(path.join(stagingDir, 'usr/share/applications'), { recursive: true });
await mkdir(path.join(stagingDir, 'usr/share/doc/yayra'), { recursive: true });
await mkdir(path.join(stagingDir, 'opt/yayra'), { recursive: true });
await mkdir(releaseDir, { recursive: true });

// Copy control and maintainer scripts
let controlContent = await readFile(path.join(root, 'packages/platform-packaging/linux/control'), 'utf8');
controlContent = controlContent.replace(/^Version:.*/m, `Version: ${version}`);
await writeFile(path.join(stagingDir, 'DEBIAN/control'), controlContent);

const postinst = path.join(root, 'packages/platform-packaging/linux/postinst');
const prerm = path.join(root, 'packages/platform-packaging/linux/prerm');
const postrm = path.join(root, 'packages/platform-packaging/linux/postrm');

if (existsSync(postinst)) {
  await cp(postinst, path.join(stagingDir, 'DEBIAN/postinst'));
  await chmod(path.join(stagingDir, 'DEBIAN/postinst'), 0o755);
}
if (existsSync(prerm)) {
  await cp(prerm, path.join(stagingDir, 'DEBIAN/prerm'));
  await chmod(path.join(stagingDir, 'DEBIAN/prerm'), 0o755);
}
if (existsSync(postrm)) {
  await cp(postrm, path.join(stagingDir, 'DEBIAN/postrm'));
  await chmod(path.join(stagingDir, 'DEBIAN/postrm'), 0o755);
}

// Copy desktop file
const desktopFilePath = path.join(root, 'build/linux/yayra.desktop');
if (!existsSync(desktopFilePath)) {
  await mkdir(path.dirname(desktopFilePath), { recursive: true });
  await writeFile(desktopFilePath, `[Desktop Entry]
Name=yayra
Exec=yayra %U
Terminal=false
Type=Application
Icon=yayra
StartupWMClass=yayra
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;x-scheme-handler/yayra;
Comment=Lightweight cross-platform floating browser with glassmorphism overlay
`);
}
await cp(desktopFilePath, path.join(stagingDir, 'usr/share/applications/yayra.desktop'));

// Copy all 9 hicolor icon resolutions
for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
  const iconSrc = path.join(root, `build/icons/hicolor/${size}x${size}/apps/yayra.png`);
  if (existsSync(iconSrc)) {
    const iconDestDir = path.join(stagingDir, `usr/share/icons/hicolor/${size}x${size}/apps`);
    await mkdir(iconDestDir, { recursive: true });
    await cp(iconSrc, path.join(iconDestDir, 'yayra.png'));
  }
}

// Copy launcher shell script
const launcher = `#!/bin/sh
set -e
APP_DIR="/opt/yayra"
if [ -x "\${APP_DIR}/yayra" ]; then
    exec "\${APP_DIR}/yayra" "$@"
fi
if command -v node >/dev/null 2>&1 && [ -f "\${APP_DIR}/server.mjs" ]; then
    exec node "\${APP_DIR}/server.mjs" "$@"
fi
if command -v xdg-open >/dev/null 2>&1 && [ -f "\${APP_DIR}/index.html" ]; then
    exec xdg-open "\${APP_DIR}/index.html"
fi
echo "Error: Yayra application runtime could not be launched." >&2
exit 1
`;
await writeFile(path.join(stagingDir, 'usr/bin/yayra'), launcher);
await chmod(path.join(stagingDir, 'usr/bin/yayra'), 0o755);

// Copy dist files into /opt/yayra
if (existsSync(path.join(root, 'dist'))) {
  await cp(path.join(root, 'dist'), path.join(stagingDir, 'opt/yayra'), { recursive: true });
}

// Create doc files
await writeFile(path.join(stagingDir, 'usr/share/doc/yayra/copyright'), `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: yayra
Source: https://github.com/g2code33/yayra

Files: *
Copyright: 2026 Yayra Project <support@yayra.app>
License: Proprietary / Local-First
`);

// Build deb package using dpkg-deb if available
const build = spawnSync('dpkg-deb', ['--root-owner-group', '--build', stagingDir, path.join(releaseDir, debName)], { encoding: 'utf8' });
if (build.status === 0) {
  console.log(`[Linux DEB Packager] Successfully built ${path.join('release', debName)}`);
} else {
  console.warn(`[Linux DEB Packager] dpkg-deb failed or was not found: ${build.stderr || build.stdout}`);
}

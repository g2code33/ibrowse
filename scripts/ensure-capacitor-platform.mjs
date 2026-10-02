#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
  console.error('usage: node scripts/ensure-capacitor-platform.mjs <android|ios>');
  process.exit(2);
}
const root = process.cwd();
if (!existsSync(path.join(root, platform))) {
  const add = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'add', platform], { cwd: root, stdio: 'inherit' });
  if (add.status !== 0) process.exit(add.status || 1);
}
if (platform === 'android') {
  for (const density of ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']) {
    const src = path.join(root, 'native-assets/android', density, 'ic_launcher.png');
    const destDir = path.join(root, 'android/app/src/main/res', density);
    if (existsSync(src) && existsSync(path.join(root, 'android'))) {
      await mkdir(destDir, { recursive: true });
      await cp(src, path.join(destDir, 'ic_launcher.png'));
    }
  }
}
if (platform === 'ios') {
  const src = path.join(root, 'native-assets/ios/AppIcon.appiconset');
  const dest = path.join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  if (existsSync(src) && existsSync(path.join(root, 'ios'))) {
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true, force: true });
  }
  const exportOptions = path.join(root, 'ios/exportOptions.plist');
  if (!existsSync(exportOptions)) {
    await writeFile(exportOptions, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>method</key><string>development</string><key>signingStyle</key><string>automatic</string></dict></plist>\n`);
  }
}
console.log(`capacitor ${platform} platform is present and icon assets are synced`);

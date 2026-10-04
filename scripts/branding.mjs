#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { decodePng, dimensions, encodePng, makeIconPixels, resizeNearest } from './lib/png.mjs';

const mode = process.argv.includes('--write') ? 'write' : 'check';
const installIndex = process.argv.indexOf('--install');
const installPrefix = installIndex >= 0 ? process.argv[installIndex + 1] : null;
const root = process.cwd();
const sourcePath = path.join(root, 'assets/brand/source.png');
const pngSizes = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512];
const hicolorSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512];
const androidTargets = [
  ['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96], ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]
];
const iosSizes = [20, 29, 40, 60, 76, 83.5, 1024];

async function main() {
  if (mode === 'write' && !existsSync(sourcePath)) {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, encodePng({ width: 1024, height: 1024, data: makeIconPixels(1024) }));
  }
  const sourceBuffer = await readFile(sourcePath);
  const source = decodePng(sourceBuffer);
  // The raw brand canvas carries large transparent margins (the artwork
  // only covers ~77% x ~66% of it, with a big empty band at the top), which
  // made the installed app icon look tiny on desktop docks, Android/iOS
  // home screens and PWA launchers. Crop to the opaque artwork and
  // re-center it on a square canvas with a slim 4% margin so the logo
  // fills ~92% of every generated icon. source.png itself is kept as-is.
  const iconSource = cropToContent(source, 0.04);
  const expected = new Map();
  expected.set('assets/brand/source.png', encodePng(source));
  for (const size of pngSizes) {
    const png = encodePng(resizeNearest(iconSource, size));
    if (size === 16) expected.set('public/favicon-16x16.png', png);
    if (size === 32) expected.set('public/favicon-32x32.png', png);
    if (size === 192) expected.set('public/icons/icon-192.png', png);
    if (size === 512) expected.set('public/icons/icon-512.png', png);
  }
  expected.set('public/apple-touch-icon.png', encodePng(resizeNearest(iconSource, 180)));
  for (const size of hicolorSizes) {
    expected.set(`build/icons/hicolor/${size}x${size}/apps/yayra.png`, encodePng(resizeNearest(iconSource, size)));
    // electron-builder's Linux "set" icon resolver only reads a flat
    // directory of `<size>x<size>.png` files (see app-builder-lib's
    // iconConverter collectIconsFromDir) — it does not walk the freedesktop
    // hicolor/<size>x<size>/apps/ hierarchy above. Ship both so the .deb
    // installs the full hicolor icon theme AND electron-builder packages
    // every resolution into /usr/share/icons/hicolor/<size>x<size>/apps/.
    expected.set(`build/icons/linux-set/${size}x${size}.png`, encodePng(resizeNearest(iconSource, size)));
  }
  const ico = makeIco([16, 24, 32, 48, 64, 96, 128, 256].map((size) => ({ size, png: encodePng(resizeNearest(iconSource, size)) })));
  expected.set('build/icons/icon.ico', ico);
  expected.set('build/icons/installer.ico', ico);
  expected.set('build/icons/uninstaller.ico', ico);
  for (const [density, size] of androidTargets) {
    expected.set(`native-assets/android/${density}/ic_launcher.png`, encodePng(resizeNearest(iconSource, size)));
  }
  const iosContents = { images: [], info: { author: 'xcode', version: 1 } };
  for (const base of iosSizes) {
    const pixels = Math.round(base * (base === 1024 ? 1 : 2));
    const filename = `AppIcon-${String(base).replace('.', '_')}@${base === 1024 ? '1' : '2'}x.png`;
    iosContents.images.push({ size: `${base}x${base}`, idiom: base === 1024 ? 'ios-marketing' : 'iphone', scale: base === 1024 ? '1x' : '2x', filename });
    expected.set(`native-assets/ios/AppIcon.appiconset/${filename}`, encodePng(resizeNearest(iconSource, pixels)));
  }
  expected.set('native-assets/ios/AppIcon.appiconset/Contents.json', Buffer.from(`${JSON.stringify(iosContents, null, 2)}\n`));

  if (installPrefix) {
    await verifyInstalled(installPrefix, sourceBuffer);
    return;
  }

  const changed = [];
  for (const [relative, buffer] of expected) {
    const absolute = path.join(root, relative);
    if (mode === 'write') {
      await mkdir(path.dirname(absolute), { recursive: true });
      const old = existsSync(absolute) ? await readFile(absolute) : null;
      if (!old || !old.equals(buffer)) changed.push(relative);
      await writeFile(absolute, buffer);
    } else {
      if (!existsSync(absolute)) {
        changed.push(`${relative} (missing)`);
        continue;
      }
      const old = await readFile(absolute);
      if (!old.equals(buffer)) changed.push(`${relative} (would change)`);
    }
  }
  if (changed.length) {
    console.error(`${mode === 'write' ? 'updated' : 'branding verification failed'}:`);
    for (const file of changed) console.error(` - ${file}`);
    if (mode === 'check') process.exit(1);
  } else {
    console.log('branding verification passed: generated icons match assets/brand/source.png');
  }
}

/**
 * Crops a decoded RGBA image to its opaque bounding box (alpha > 8) and
 * re-centers the artwork on a square canvas with `margin` (fraction of the
 * artwork's larger side) of transparent padding on every edge. Returns the
 * original image untouched when it has no visible pixels.
 */
function cropToContent(image, margin = 0.04) {
  const { width, height, data } = image;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return image;
  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  const side = Math.ceil(Math.max(contentW, contentH) * (1 + margin * 2));
  const out = Buffer.alloc(side * side * 4);
  const offX = Math.round((side - contentW) / 2);
  const offY = Math.round((side - contentH) / 2);
  for (let y = 0; y < contentH; y += 1) {
    const srcStart = ((minY + y) * width + minX) * 4;
    data.copy(out, ((offY + y) * side + offX) * 4, srcStart, srcStart + contentW * 4);
  }
  return { width: side, height: side, data: out };
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const buffers = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size === 256 ? 0 : image.size;
    entry[1] = image.size === 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
    buffers.push(image.png);
  }
  return Buffer.concat([header, ...entries, ...buffers]);
}

async function verifyInstalled(prefix, sourceBuffer) {
  const sourceDims = dimensions(sourceBuffer);
  const candidates = [
    path.join(prefix, 'share/icons/hicolor/512x512/apps/yayra.png'),
    path.join(prefix, 'yayra.png')
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const buffer = await readFile(candidate);
    const dims = dimensions(buffer);
    if (dims.width > 0 && dims.height > 0 && sourceDims.width === 1024) {
      console.log(`installed branding verification passed: ${candidate} is ${dims.width}x${dims.height}`);
      return;
    }
  }
  console.error(`installed branding verification failed: no yayra icon found under ${prefix}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

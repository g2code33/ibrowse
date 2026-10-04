#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
// --- Google sign-in deep-link callback (docs/GOOGLE_SIGNIN.md) -----------
// The OAuth flow returns to the app on the custom URL scheme
// `com.yayra.app:/oauth2redirect` (RFC 8252 §7.1). Capacitor's generated
// projects do NOT register a handler for their own custom_url_scheme out
// of the box, and android/ + ios/ are generated/gitignored - so the
// registration is (re)injected here, idempotently, every time the platform
// is ensured, instead of being a manual step someone forgets.
const OAUTH_MARKER = 'YAYRA GOOGLE SIGN-IN DEEP LINK';

async function injectAndroidUrlSchemeIntentFilter() {
  const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  if (!existsSync(manifestPath)) return;
  let manifest = await readFile(manifestPath, 'utf8');
  if (manifest.includes(OAUTH_MARKER)) return;
  const intentFilter = `
            <!-- ${OAUTH_MARKER}: injected by scripts/ensure-capacitor-platform.mjs.
                 Routes com.yayra.app:/oauth2redirect (Google OAuth callback,
                 @string/custom_url_scheme) back into the app as an
                 App.appUrlOpen event. autoVerify is NOT set: this is a
                 custom scheme, not an https app link. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="@string/custom_url_scheme" />
            </intent-filter>
`;
  const closingActivity = /(\n\s*<\/activity>)/;
  if (!closingActivity.test(manifest)) throw new Error('MainActivity </activity> not found in AndroidManifest.xml');
  manifest = manifest.replace(closingActivity, `\n${intentFilter}$1`);
  await writeFile(manifestPath, manifest);
  console.log('injected Google sign-in intent-filter into AndroidManifest.xml');
}

async function injectIosUrlScheme() {
  const plistPath = path.join(root, 'ios/App/App/Info.plist');
  if (!existsSync(plistPath)) return;
  let plist = await readFile(plistPath, 'utf8');
  if (plist.includes(OAUTH_MARKER)) return;
  const urlTypes = `\t<!-- ${OAUTH_MARKER}: injected by scripts/ensure-capacitor-platform.mjs.
\t     Registers the com.yayra.app custom scheme so Google's OAuth redirect
\t     reopens the app (surfaced as App.appUrlOpen). -->
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.yayra.app</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>com.yayra.app</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;
  if (plist.includes('<key>CFBundleURLTypes</key>')) {
    console.warn('Info.plist already declares CFBundleURLTypes; verify the com.yayra.app scheme is present (docs/GOOGLE_SIGNIN.md)');
    return;
  }
  const closingDict = /(\n<\/dict>\n<\/plist>)/;
  if (!closingDict.test(plist)) throw new Error('closing </dict></plist> not found in Info.plist');
  plist = plist.replace(closingDict, `\n${urlTypes}$1`);
  await writeFile(plistPath, plist);
  console.log('injected Google sign-in URL scheme into Info.plist');
}

if (platform === 'android') {
  await injectAndroidUrlSchemeIntentFilter();
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
  await injectIosUrlScheme();
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

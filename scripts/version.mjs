#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSemver } from '../src/config/updates.js';

const root = process.cwd();
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bump = args.find((arg) => !arg.startsWith('--'));
const pkgPath = path.join(root, 'package.json');
const pkg = await readJson(pkgPath);
const current = pkg.version;
let next = current;
if (!checkOnly) {
  if (!bump) usage();
  next = computeNext(current, bump);
}
parseSemver(next);
const files = [
  updateJson('package.json', (json) => { json.version = next; }),
  updateJson('capacitor.config.json', (json) => { json.appId = 'com.ibrowse.app'; json.appName = 'ibrowse'; json.webDir = 'dist'; }),
  updateJson('public/manifest.webmanifest', (json) => { json.version = next; json.cacheVersion = next; }),
  updateJson('electron/app-version.json', (json) => { json.version = next; })
];
if (existsSync(path.join(root, 'package-lock.json'))) {
  files.push(updateJson('package-lock.json', (json) => {
    json.version = next;
    if (json.packages?.['']) json.packages[''].version = next;
  }));
}
files.push(updateText('native/android/version.gradle', (text) => text.replace(/appVersionName = "[^"]+"/, `appVersionName = "${next}"`).replace(/appVersionCode = \d+/, `appVersionCode = ${versionCode(next)}`)));
files.push(updateText('native/ios/Info.plist', (text) => text.replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleShortVersionString</key>\n  <string>${next}</string>`).replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleVersion</key>\n  <string>${versionCode(next)}</string>`)));
files.push(updateText('public/sw.js', (text) => text.replace(/const BUILD_VERSION = '[^']*';/, `const BUILD_VERSION = '__BUILD_VERSION__';`)));

const changed = [];
const observed = [];
for (const operation of files) {
  const result = await operation;
  if (result.changed) changed.push(result.file);
  observed.push(...result.versions.map((version) => ({ file: result.file, version })));
}
const mismatches = observed.filter((entry) => entry.version !== next);
if (mismatches.length) {
  console.error('version lockstep failed:');
  for (const entry of mismatches) console.error(` - ${entry.file}: ${entry.version} != ${next}`);
  process.exit(1);
}
if (checkOnly) {
  if (changed.length) {
    console.error(`version check failed: files would change for ${next}`);
    for (const file of changed) console.error(` - ${file}`);
    process.exit(1);
  }
  console.log(`version lockstep passed: ${next}`);
} else {
  console.log(`version updated to ${next}`);
  console.log(`Commit with: git add package.json package-lock.json capacitor.config.json public/manifest.webmanifest native/android/version.gradle native/ios/Info.plist electron/app-version.json && git commit -m "chore: bump ibrowse to v${next} because release manifests must match"`);
}

function computeNext(version, bump) {
  if (/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(bump)) return bump.replace(/^v/, '');
  const parsed = parseSemver(version);
  if (bump === 'major') return `${parsed.major + 1}.0.0`;
  if (bump === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (bump === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  usage();
}

function versionCode(version) {
  const parsed = parseSemver(version);
  return parsed.major * 1000000 + parsed.minor * 1000 + parsed.patch;
}

async function updateJson(file, mutator) {
  const absolute = path.join(root, file);
  const oldText = await readFile(absolute, 'utf8');
  const json = JSON.parse(oldText);
  mutator(json);
  const newText = `${JSON.stringify(json, null, 2)}\n`;
  if (!checkOnly && oldText !== newText) await writeFile(absolute, newText);
  return { file, changed: oldText !== newText, versions: collectVersions(file, newText) };
}

async function updateText(file, mutator) {
  const absolute = path.join(root, file);
  const oldText = await readFile(absolute, 'utf8');
  const newText = mutator(oldText);
  if (!checkOnly && oldText !== newText) await writeFile(absolute, newText);
  return { file, changed: oldText !== newText, versions: collectVersions(file, newText) };
}

function collectVersions(file, text) {
  const versions = [];
  if (file.endsWith('.json') || file.endsWith('.webmanifest')) {
    const json = JSON.parse(text);
    if (json.version) versions.push(json.version);
    if (json.cacheVersion) versions.push(json.cacheVersion);
    if (json.packages?.['']?.version) versions.push(json.packages[''].version);
  }
  for (const match of text.matchAll(/(?:appVersionName = |CFBundleShortVersionString<\/key>\s*<string>)(?:")?([^"<\n]+)/g)) versions.push(match[1]);
  return versions;
}

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
function usage() { console.error('usage: node scripts/version.mjs <major|minor|patch|x.y.z> OR --check'); process.exit(2); }

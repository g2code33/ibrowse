#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_UPDATE_CONFIG } from '../src/config/updates.js';
import { pickArtifact } from './lib/update-artifacts.mjs';

const root = process.cwd();
const out = process.argv[2] || 'dist/updates/manifest.json';
const metadataDir = process.argv[3] || '.artifacts';
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const releaseRepository = process.env.GITHUB_REPOSITORY || 'g2code33/yayra';
const latest = {};
const downloads = {};
const records = existsSync(path.join(root, metadataDir)) ? await findBuildInfo(path.join(root, metadataDir)) : [];
for (const recordPath of records) {
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const target = record.target;
  latest[target] = record.version;
  const dir = path.dirname(recordPath);
  const sums = existsSync(path.join(dir, 'SHA256SUMS.txt')) ? await parseSums(path.join(dir, 'SHA256SUMS.txt')) : new Map();
  // Pick the actual installable artifact for this target - NOT simply the
  // first line of SHA256SUMS.txt. The artifact folders also carry signing
  // keys, detached signatures, helper binaries (electron-builder's
  // elevate.exe) and metadata; the old "take the first file" logic shipped
  // manifests that told Windows clients to install elevate.exe and Linux
  // clients to install the signing public key (.pem).
  const addDownload = async (downloadTarget, file) => {
    if (!file) return;
    const sha256 = sums.get(file);
    const absolute = path.join(dir, file);
    if (!existsSync(absolute)) return;
    const info = await stat(absolute);
    downloads[downloadTarget] = { url: record.urlBase ? `${record.urlBase}/${file}` : `https://github.com/${releaseRepository}/releases/download/v${record.version}/${file}`, sha256, bytes: info.size };
    // Detached artifact signature (scripts/sign-linux-artifacts.mjs writes
    // `<artifact>.sig`, RSA-SHA256 over the artifact bytes). Embedding it
    // base64 in the manifest lets UpdateService verify the download against
    // a PINNED public key baked into the app - so even a compromised
    // manifest host cannot push an artifact the release key never signed.
    // See "signature verification" in src/services/updateService.js.
    const sigFile = `${absolute}.sig`;
    if (existsSync(sigFile)) {
      downloads[downloadTarget].sig = (await readFile(sigFile)).toString('base64');
    }
  };
  await addDownload(target, pickArtifact(target, sums.keys()));
  // Linux ships TWO install formats: .deb (system installs) and AppImage
  // (self-contained file). AppImage users must be served the AppImage so
  // the in-app updater can self-replace it; see ARTIFACT_PATTERNS note.
  if (target === 'linux') {
    const appImageFile = pickArtifact('linux-appimage', sums.keys());
    if (appImageFile) {
      await addDownload('linux-appimage', appImageFile);
      latest['linux-appimage'] = record.version;
    }
  }
}
for (const target of ['windows', 'linux', 'ios', 'android', 'pwa']) latest[target] ||= pkg.version;
const manifest = {
  schema: 1,
  channel: DEFAULT_UPDATE_CONFIG.channel,
  latest,
  minSupported: DEFAULT_UPDATE_CONFIG.minSupported,
  downloads,
  notes: DEFAULT_UPDATE_CONFIG.notes,
  rollout: { percent: DEFAULT_UPDATE_CONFIG.rollout.percent, allowlist: [] },
  publishedAt: new Date().toISOString(),
  ttlSeconds: 300
};
await mkdir(path.dirname(path.join(root, out)), { recursive: true });
await writeFile(path.join(root, out), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`generated update manifest ${out} with ${Object.keys(downloads).length} download entries`);

async function findBuildInfo(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) out.push(...await findBuildInfo(absolute));
    else if (entry === 'build-info.json') out.push(absolute);
  }
  return out;
}
async function parseSums(file) {
  const text = await readFile(file, 'utf8');
  const sums = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    if (match) sums.set(match[2], match[1]);
  }
  return sums;
}

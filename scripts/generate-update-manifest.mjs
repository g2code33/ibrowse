#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_UPDATE_CONFIG } from '../src/config/updates.js';

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
  for (const [file, sha256] of sums) {
    if (file === 'build-info.json' || file === 'SHA256SUMS.txt') continue;
    const absolute = path.join(dir, file);
    if (!existsSync(absolute)) continue;
    const info = await stat(absolute);
    downloads[target] = { url: record.urlBase ? `${record.urlBase}/${file}` : `https://github.com/${releaseRepository}/releases/download/v${record.version}/${file}`, sha256, bytes: info.size };
    break;
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

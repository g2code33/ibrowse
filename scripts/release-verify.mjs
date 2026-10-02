#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: scripts/release-verify.mjs <tag>');
  process.exit(2);
}
const targets = ['windows', 'linux', 'android', 'ios', 'pwa'];
const latest = gh(['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name, .draft, .prerelease']).stdout.trim().split(/\r?\n/);
if (latest[0] !== tag || latest[1] !== 'false') {
  console.error(`latest release mismatch: expected ${tag}/draft=false, got ${latest.join('/')}`);
  process.exit(1);
}
const release = JSON.parse(gh(['release', 'view', tag, '--json', 'assets', '--jq', '.']).stdout);
const names = release.assets.map((asset) => asset.name);
for (const target of targets) {
  if (!names.some((name) => name.includes(`-${target}-`) || name.includes(`_${target}`) || name.includes(target))) {
    console.error(`missing expected target asset for ${target}`);
    process.exit(1);
  }
}
const temp = await mkdtemp(path.join(tmpdir(), 'ibrowse-release-verify-'));
try {
  gh(['release', 'download', tag, '-D', temp, '-p', '*SHA256SUMS.txt', '--clobber']);
  const sums = await readSums(temp);
  if (!sums.size) throw new Error('no SHA256SUMS entries downloaded');
  const assetByName = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const [assetName, expectedSha] of sums) {
    if (!assetByName.has(assetName)) continue;
    gh(['release', 'download', tag, '-D', temp, '-p', assetName, '--clobber']);
    const file = path.join(temp, assetName);
    const actualSha = createHash('sha256').update(await readFile(file)).digest('hex');
    if (actualSha !== expectedSha) throw new Error(`SHA256 mismatch for ${assetName}: ${actualSha} != ${expectedSha}`);
    const actualSize = (await stat(file)).size;
    if (actualSize !== assetByName.get(assetName).size) throw new Error(`size mismatch for ${assetName}: ${actualSize} != ${assetByName.get(assetName).size}`);
    console.log(`verified ${assetName} ${actualSize} bytes ${actualSha}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
if (process.env.UPDATE_MANIFEST_URL) {
  const response = await fetch(process.env.UPDATE_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
  const manifest = await response.json();
  const version = tag.replace(/^v/, '');
  if (!Object.values(manifest.latest || {}).some((value) => value === version)) {
    console.error(`manifest latest does not include ${version}`);
    process.exit(1);
  }
  for (const [target, download] of Object.entries(manifest.downloads || {})) {
    if (!download.sha256 || !download.bytes || !download.url) {
      console.error(`manifest download for ${target} missing url/sha256/bytes`);
      process.exit(1);
    }
  }
  console.log(`manifest verified: ${process.env.UPDATE_MANIFEST_URL}`);
} else {
  console.log('UPDATE_MANIFEST_URL unset; verified GitHub latest/assets only');
}
console.log(`release verification passed for ${tag}`);

async function readSums(dir) {
  const out = new Map();
  for (const file of await readdir(dir)) {
    if (!file.endsWith('SHA256SUMS.txt')) continue;
    const text = await readFile(path.join(dir, file), 'utf8');
    for (const line of text.trim().split(/\r?\n/)) {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
      if (match) out.set(match[2], match[1]);
    }
  }
  return out;
}
function gh(args) {
  console.log(`gh ${args.join(' ')}`);
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (/authentication|not logged in/i.test(result.stderr)) console.error('GitHub authentication failed. Reconnect GitHub in Arena.');
    process.exit(result.status || 1);
  }
  return result;
}

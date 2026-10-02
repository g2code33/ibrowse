#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tag = process.argv[2] || `v${JSON.parse(await readFile('package.json', 'utf8')).version}`;
const artifactRoot = process.argv[3] || '.artifacts';
const files = await stageReleaseFiles(artifactRoot);
if (!files.length) throw new Error(`no release files found under ${artifactRoot}`);
const title = `ibrowse ${tag}`;
const body = `Automated ibrowse release ${tag}. Assets are uploaded draft-first, verified, then published.`;
const view = gh(['release', 'view', tag, '--json', 'isDraft', '--jq', '.isDraft'], { allowFailure: true });
if (view.status === 0) {
  gh(['release', 'upload', tag, ...files, '--clobber']);
} else {
  gh(['release', 'create', tag, ...files, '-t', title, '-n', body, '--draft']);
}
await verifyAssets(tag, files);
gh(['release', 'edit', tag, '--draft=false', '--latest']);
console.log(`published ${tag} with ${files.length} assets`);

async function verifyAssets(tagName, localFiles) {
  const assetJson = gh(['release', 'view', tagName, '--json', 'assets', '--jq', '.assets']).stdout;
  const assets = JSON.parse(assetJson);
  for (const file of localFiles) {
    const name = path.basename(file);
    const local = await stat(file);
    const asset = assets.find((candidate) => candidate.name === name);
    if (!asset) throw new Error(`missing release asset ${name}`);
    if (asset.size !== local.size) throw new Error(`size mismatch for ${name}: release=${asset.size} local=${local.size}`);
  }
  console.log(`verified ${localFiles.length} release asset sizes for ${tagName}`);
}
async function stageReleaseFiles(dir) {
  const raw = await collectFiles(dir);
  const out = [];
  const seen = new Set();
  const stage = '.release-upload';
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for (const file of raw) {
    const artifactName = path.basename(path.dirname(file));
    let name = path.basename(file);
    if (seen.has(name) || name === 'SHA256SUMS.txt' || name === 'build-info.json') name = `${artifactName}-${name}`;
    seen.add(name);
    const staged = path.join(stage, name);
    await cp(file, staged, { force: true });
    out.push(staged);
  }
  return out;
}
async function collectFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) out.push(...await collectFiles(absolute));
    else out.push(absolute);
  }
  return out;
}
function gh(args, options = {}) {
  console.log(`gh ${args.join(' ')}`);
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 && !options.allowFailure) {
    if (/authentication|not logged in/i.test(result.stderr)) console.error('GitHub authentication failed. Reconnect GitHub in Arena.');
    process.exit(result.status || 1);
  }
  return result;
}

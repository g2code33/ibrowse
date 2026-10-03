#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildContentSecurityPolicy } from '../src/security/csp.js';

const root = process.cwd();
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.VERSION_OVERRIDE || pkg.version;
const sha = git(['rev-parse', '--short=12', 'HEAD']) || process.env.GITHUB_SHA?.slice(0, 12) || 'unknown';
const builtAt = process.env.BUILT_AT || new Date().toISOString();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });
await cp(path.join(root, 'assets', 'brand'), path.join(dist, 'assets', 'brand'), { recursive: true });
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
// BrowserShell is imported directly by the web entry point. Keep its runtime
// packages inside the self-contained PWA bundle instead of leaving imports
// pointing back at the repository checkout.
for (const packageName of ['browser-contract', 'persistence', 'shared-ui']) {
  await cp(path.join(root, 'packages', packageName), path.join(dist, 'packages', packageName), { recursive: true });
}

await replaceFile(path.join(dist, 'index.html'), {
  __BUILD_VERSION__: version,
  __CSP__: buildContentSecurityPolicy()
});

const info = { version, sha, builtAt };
await writeFile(path.join(dist, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);

let precache = (await listFiles(dist))
  .map((file) => `./${file}`)
  .filter((file) => file !== './sw.js' && file !== './precache-manifest.json')
  .sort();
const swPath = path.join(dist, 'sw.js');
let sw = await readFile(swPath, 'utf8');
sw = sw.replaceAll('__BUILD_VERSION__', version).replaceAll('__BUILD_SHA__', sha).replace('__PRECACHE_MANIFEST__', JSON.stringify(precache, null, 2));
await writeFile(swPath, sw);
await writeFile(path.join(dist, 'precache-manifest.json'), `${JSON.stringify(precache, null, 2)}\n`);
console.log(`built web bundle: dist (${precache.length} precached files) version=${version} sha=${sha} builtAt=${builtAt}`);

async function replaceFile(file, replacements) {
  let text = await readFile(file, 'utf8');
  for (const [needle, value] of Object.entries(replacements)) text = text.replaceAll(needle, value);
  await writeFile(file, text);
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) out.push(...await listFiles(absolute, base));
    else out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out;
}

function git(args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; }
}

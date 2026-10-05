#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const workerName = process.env.CLOUDFLARE_WORKER_NAME || 'yayra-updates-api';
const config = path.join(root, 'wrangler.worker.toml');
const entry = path.join(root, 'worker', 'update-worker.mjs');
const manifestPath = path.join(root, 'dist', 'updates', 'manifest.json');

if (!token || !accountId) {
  // No CI tokens in the environment - fall back to the interactive
  // `wrangler login` session (OAuth), which is how local deploys work.
  // CI keeps using the env-var path; tokens stay terminal-only.
  console.warn('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set - using your `wrangler login` session instead.');
  console.warn('If this fails with an auth error, run: npx wrangler@4 login');
}
if (!existsSync(config) || !existsSync(entry)) {
  console.error('Cloudflare Worker configuration or entrypoint is missing.');
  process.exit(1);
}

const sourceManifest = existsSync(manifestPath)
  ? manifestPath
  : path.join(root, 'public', 'updates', 'manifest.json');
if (!existsSync(sourceManifest)) {
  console.error('No update manifest found. Build the web bundle before deploying the API Worker.');
  process.exit(1);
}

const manifest = JSON.stringify(JSON.parse(await readFile(sourceManifest, 'utf8')));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, [
  '--yes', 'wrangler@4', 'deploy', entry,
  '--config', config,
  '--name', workerName,
  '--var', `UPDATES_MANIFEST_JSON:${manifest}`
], {
  cwd: root,
  env: {
    ...process.env,
    ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
    ...(token ? { CLOUDFLARE_API_TOKEN: token } : {})
  },
  stdio: 'inherit'
});

if (result.error) {
  console.error(`Could not start Wrangler: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

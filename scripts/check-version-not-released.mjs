#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = process.env.VERSION_OVERRIDE || pkg.version;
const tag = version.startsWith('v') ? version : `v${version}`;
const gh = spawnSync('gh', ['release', 'view', tag, '--json', 'tagName', '--jq', '.tagName'], { encoding: 'utf8' });
if (gh.status === 0 && gh.stdout.trim() === tag) {
  console.error(`version ${tag} already exists in GitHub Releases; refusing to rebuild release feed`);
  process.exit(1);
}
if (gh.stderr && /authentication|not logged in/i.test(gh.stderr)) {
  console.error('GitHub authentication failed while checking release versions. Reconnect GitHub in Arena.');
  process.exit(1);
}
console.log(`version ${tag} is not present in GitHub Releases`);

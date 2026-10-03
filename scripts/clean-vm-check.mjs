#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'yayra-clean-'));
function run(command, args, cwd = temp) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env, timeout: 300000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
run('git', ['clone', '--depth=1', root, 'repo'], temp);
const repo = path.join(temp, 'repo');
run('npm', ['ci'], repo);
run('npm', ['run', 'build:web'], repo);
run('npm', ['run', 'smoke:desktop'], repo);
await rm(temp, { recursive: true, force: true });
console.log('clean-vm-equivalent passed: fresh clone -> npm ci -> build:web -> smoke:desktop');

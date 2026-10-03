#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseDir = path.resolve(process.argv[2] || 'release');
const signingKey = process.env.LINUX_SIGNING_KEY || '';
const signingPassword = process.env.LINUX_SIGNING_KEY_PASSWORD || '';
if (!signingKey) throw new Error('LINUX_SIGNING_KEY is required to sign Linux artifacts');
if (!existsSync(releaseDir)) throw new Error(`release directory does not exist: ${releaseDir}`);

const files = (await readdir(releaseDir))
  .filter((name) => /\.(deb|AppImage)$/i.test(name))
  .map((name) => path.join(releaseDir, name))
  .sort();
if (!files.length) throw new Error(`no .deb or .AppImage files found under ${releaseDir}`);

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yayra-openssl-'));
const keyFile = path.join(tempDir, 'linux-signing-key.pem');
const publicKeyFile = path.join(releaseDir, 'linux-signing-public-key.pem');
try {
  await writeFile(keyFile, decodeSecret(signingKey), { mode: 0o600 });
  const keyArgs = ['pkey', '-in', keyFile];
  if (signingPassword) keyArgs.push('-passin', 'env:LINUX_SIGNING_KEY_PASSWORD');
  run(keyArgs.concat(['-pubout', '-out', publicKeyFile]), { LINUX_SIGNING_KEY_PASSWORD: signingPassword });

  for (const file of files) {
    const output = `${file}.sig`;
    const args = ['dgst', '-sha256', '-sign', keyFile, '-out', output];
    if (signingPassword) args.push('-passin', 'env:LINUX_SIGNING_KEY_PASSWORD');
    args.push(file);
    run(args, { LINUX_SIGNING_KEY_PASSWORD: signingPassword });
    console.log(`signed ${path.basename(file)} -> ${path.basename(output)}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function decodeSecret(value) {
  const trimmed = value.trim();
  if (/-----BEGIN (?:RSA |EC |)PRIVATE KEY-----/.test(trimmed)) return Buffer.from(trimmed);
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.includes(Buffer.from('PRIVATE KEY'))) return decoded;
  } catch {
    // Fall through to treating the secret as PEM text.
  }
  return Buffer.from(value);
}

function run(args, extraEnv = {}) {
  const result = spawnSync('openssl', args, {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`openssl failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout || '';
}

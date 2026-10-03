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

const home = await mkdtemp(path.join(os.tmpdir(), 'yayra-gpg-'));
const keyFile = path.join(home, 'signing-key');
try {
  await writeFile(keyFile, decodeSecret(signingKey), { mode: 0o600 });
  run(['--batch', '--import', keyFile], home);
  const keyId = run(['--batch', '--with-colons', '--list-secret-keys'], home)
    .split('\n')
    .map((line) => line.split(':'))
    .find((fields) => fields[0] === 'sec')?.[4];
  if (!keyId) throw new Error('LINUX_SIGNING_KEY did not contain a usable private GPG key');

  for (const file of files) {
    const output = `${file}.asc`;
    const args = [
      '--batch', '--yes', '--armor', '--detach-sign',
      '--local-user', keyId,
      '--output', output,
    ];
    if (signingPassword) args.push('--pinentry-mode', 'loopback', '--passphrase-fd', '0');
    args.push(file);
    run(args, home, signingPassword ? `${signingPassword}\n` : '');
    console.log(`signed ${path.basename(file)} -> ${path.basename(output)}`);
  }
} finally {
  await rm(home, { recursive: true, force: true });
}

function decodeSecret(value) {
  const trimmed = value.trim();
  if (/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(trimmed)) return Buffer.from(trimmed);
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.includes(Buffer.from('-----BEGIN PGP PRIVATE KEY BLOCK-----'))) return decoded;
  } catch {
    // Fall through to treating the secret as an armored key.
  }
  return Buffer.from(value);
}

function run(args, home, input = '') {
  const result = spawnSync('gpg', ['--homedir', home, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`gpg failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout || '';
}

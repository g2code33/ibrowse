#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const exe = process.argv[2];
if (!exe) {
  console.error('usage: node scripts/assert-windows-version.mjs <path-to-exe>');
  process.exit(2);
}
if (process.platform !== 'win32') {
  console.error('Windows version resources can only be inspected on Windows');
  process.exit(2);
}
const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe.replaceAll("'", "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim();
console.log(`ProductVersion=${out}`);
if (!out.startsWith(pkg.version)) {
  console.error(`ProductVersion ${out} does not match package.json ${pkg.version}`);
  process.exit(1);
}

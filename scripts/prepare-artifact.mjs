#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const target = required('--target');
const input = value('--input') || targetDefaultInput(target);
const signed = value('--signed') === 'true';
const whyNot = value('--why-not') || (signed ? '' : 'signing secrets unavailable; uploaded unsigned by design');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = process.env.VERSION_OVERRIDE || pkg.version;
const sha = (process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']) || 'unknown').slice(0, 7);
const runner = process.env.RUNNER_OS || `${process.platform}-${process.arch}`;
const builtAt = new Date().toISOString();
const artifactName = `yayra-${target}-${version}-${sha}${signed ? '' : '-unsigned'}`;
const outDir = path.join('.artifacts', artifactName);
await mkdir(outDir, { recursive: true });
const files = await resolveInputs(input);
if (!files.length) throw new Error(`no files matched for target=${target} input=${input}`);
for (const file of files) {
  const info = await stat(file);
  if (info.isDirectory()) {
    const archive = path.join(outDir, `yayra-${target}-${version}.tar.gz`);
    const tar = spawnSync('tar', ['-czf', archive, '-C', path.dirname(file), path.basename(file)], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`tar failed for ${file}: ${tar.stderr || tar.stdout}`);
  } else {
    await cp(file, path.join(outDir, path.basename(file)), { recursive: true, force: true });
  }
}
const buildInfo = { version, sha, builtAt, runner, target, unsigned: !signed, signed, whyNot };
await writeFile(path.join(outDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
const artifactFiles = (await readdir(outDir)).filter((name) => name !== 'SHA256SUMS.txt').sort();
const sums = [];
for (const file of artifactFiles) {
  const buffer = await readFile(path.join(outDir, file));
  sums.push(`${createHash('sha256').update(buffer).digest('hex')}  ${file}`);
}
await writeFile(path.join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
const size = await directorySize(outDir);
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `artifact_name=${artifactName}\nartifact_path=${outDir}\nartifact_size=${size}\n`, { flag: 'a' });
console.log(`prepared artifact ${artifactName} size=${size} signed=${signed} files=${artifactFiles.join(',')}`);
if (!signed) console.log(`::warning:: ${target} signing skipped: ${whyNot}`);

function required(name) { const v = value(name); if (!v) { console.error(`missing ${name}`); process.exit(2); } return v; }
function value(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; }
function targetDefaultInput(t) {
  if (t === 'pwa') return 'dist';
  if (t === 'linux') return 'release/*.{deb,AppImage}';
  if (t === 'windows') return 'release/*.exe';
  if (t === 'android') return 'android/app/build/outputs/apk/release/*.apk';
  if (t === 'ios') return 'build/ios-export/*.ipa,build/*.xcarchive';
  return 'dist';
}
async function resolveInputs(patterns) {
  const out = [];
  for (const pattern of patterns.split(',')) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    if (existsSync(trimmed)) { out.push(trimmed); continue; }
    const base = trimmed.split('*')[0] || '.';
    const root = base.endsWith('/') ? base.slice(0, -1) : path.dirname(base);
    const regex = globRegex(trimmed);
    if (existsSync(root)) {
      for (const file of await listFiles(root)) if (regex.test(file)) out.push(file);
    }
  }
  return [...new Set(out)];
}
function globRegex(pattern) {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  escaped = escaped.replace(/\\\{([^}]+)\\\}/g, (_m, body) => `(${body.split(',').map((v) => v.replace('.', '\\.')).join('|')})`);
  return new RegExp(`^${escaped}$`);
}
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) out.push(...await listFiles(absolute));
    else out.push(absolute.split(path.sep).join('/'));
  }
  return out;
}
async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    total += info.isDirectory() ? await directorySize(absolute) : info.size;
  }
  return total;
}
function git(args) { try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; } }

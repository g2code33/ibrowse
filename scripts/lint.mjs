#!/usr/bin/env node
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const files = await listFiles(root);
const problems = [];
const forbidden = [
  [/webSecurity\s*:\s*false/, 'do not disable Electron webSecurity'],
  [/--no-sandbox/, 'do not blanket-disable Chromium sandbox'],
  [/unsafe-eval/, 'do not widen CSP with unsafe-eval'],
  [/skip[ _-]?signing/i, 'do not silently skip signing; use explicit unsigned warnings']
];
for (const file of files) {
  if (!/\.(js|mjs|cjs|json|html|yml|yaml|md|sh|gradle|plist|webmanifest)$/.test(file)) continue;
  const text = await readFile(path.join(root, file), 'utf8');
  if (text.includes('\t')) problems.push(`${file}: tab character found`);
  for (const [pattern, message] of forbidden) {
    if (pattern.test(text) && !file.endsWith('lint.mjs') && !file.endsWith('RELEASE-PIPELINE.md')) problems.push(`${file}: ${message}`);
  }
}
if (problems.length) {
  console.error('lint failed:');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`lint passed: ${files.length} repository files scanned`);

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    if (['.git', 'node_modules', 'dist', 'release'].includes(entry)) continue;
    const absolute = path.join(dir, entry);
    // Use lstat (not stat) so packaging symlinks such as
    // build/linux/usr-bin/yayra -> ../../opt/yayra/yayra are treated as
    // plain entries instead of crashing the walk: their target only exists
    // once the Debian package is installed, so a link-following stat()
    // throws ENOENT here.
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      out.push(path.relative(base, absolute).split(path.sep).join('/'));
    } else if (info.isDirectory()) {
      out.push(...await listFiles(absolute, base));
    } else {
      out.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
  }
  return out;
}

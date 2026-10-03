#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] || '.artifacts';
const entries = await readdir(root, { withFileTypes: true });
const buildInfos = [];
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  try {
    const info = JSON.parse(await readFile(path.join(root, entry.name, 'build-info.json'), 'utf8'));
    buildInfos.push({ directory: entry.name, ...info });
  } catch {
    // Non-artifact directories are ignored; ci-summary performs the general shape check.
  }
}
if (!buildInfos.length) throw new Error(`no build-info.json files found under ${root}`);
const unsigned = buildInfos.filter((info) => info.unsigned !== false || info.signed !== true);
if (unsigned.length) {
  const details = unsigned.map((info) => `${info.target || info.directory}: ${info.whyNot || 'artifact is marked unsigned'}`).join('; ');
  throw new Error(`refusing to publish unsigned artifacts: ${details}`);
}
console.log(`verified ${buildInfos.length} release artifact set(s) are signed`);

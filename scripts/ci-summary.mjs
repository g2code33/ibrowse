#!/usr/bin/env node
import { readdir, readFile, stat, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || '.artifacts';
const rows = [];
if (existsSync(root)) {
  for (const infoPath of await findBuildInfo(root)) {
    const info = JSON.parse(await readFile(infoPath, 'utf8'));
    const dir = path.dirname(infoPath);
    rows.push({
      target: info.target,
      version: info.version,
      signed: info.signed ? 'yes' : 'no',
      artifact: path.basename(dir),
      size: await directorySize(dir),
      whyNot: info.whyNot || ''
    });
  }
}
const table = ['| target | version | signed? | artifact | size | why-not |', '|---|---:|:---:|---|---:|---|', ...rows.map((row) => `| ${row.target} | ${row.version} | ${row.signed} | ${row.artifact} | ${row.size} | ${row.whyNot.replace(/\|/g, '/')} |`)].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Release artifact summary\n\n${table}\n`);
}
console.log(table);

async function findBuildInfo(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) out.push(...await findBuildInfo(absolute));
    else if (entry === 'build-info.json') out.push(absolute);
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

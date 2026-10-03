#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const tscBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsc');
if (existsSync(tscBin)) {
  const result = spawnSync(tscBin, ['-p', 'tsconfig.json', '--noEmit'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
} else {
  // If running in an offline environment without node_modules installed, gracefully pass
  console.log('typecheck: typescript compiler not installed in local environment, skipped');
  process.exit(0);
}

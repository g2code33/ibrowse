#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gradleFile = path.join(root, 'android', 'app', 'build.gradle');
const required = ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.warn(`[Android signing] signing environment is incomplete (${missing.join(', ')}); leaving local release build unsigned`);
  process.exit(0);
}
if (!existsSync(gradleFile)) {
  throw new Error(`Android app Gradle file not found: ${gradleFile}`);
}

let gradle = await readFile(gradleFile, 'utf8');
const marker = '// YAYRA RELEASE SIGNING';
if (!gradle.includes(marker)) {
  const signingBlock = `${marker}\n    signingConfigs {\n        release {\n            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))\n            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")\n            keyAlias System.getenv("ANDROID_KEY_ALIAS")\n            keyPassword System.getenv("ANDROID_KEY_PASSWORD")\n            storeType System.getenv("ANDROID_KEYSTORE_TYPE") ?: "PKCS12"\n            v1SigningEnabled true\n            v2SigningEnabled true\n        }\n    }\n\n`;
  const androidBlock = /android\s*\{/;
  if (!androidBlock.test(gradle)) throw new Error('android { } block not found in generated Gradle file');
  gradle = gradle.replace(androidBlock, (match) => `${match}\n    ${signingBlock.replaceAll('\n', '\n    ').trimEnd()}\n`);
}

if (!/signingConfig\s+signingConfigs\.release/.test(gradle)) {
  const releaseBlock = /(buildTypes\s*\{\s*release\s*\{)/;
  if (!releaseBlock.test(gradle)) throw new Error('buildTypes { release { } block not found in generated Gradle file');
  gradle = gradle.replace(releaseBlock, '$1\n            signingConfig signingConfigs.release');
}

await writeFile(gradleFile, gradle);
console.log(`[Android signing] configured signed release build: ${path.relative(root, gradleFile)}`);

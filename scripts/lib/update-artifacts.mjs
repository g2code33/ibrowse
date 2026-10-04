/**
 * Selects which file in a release artifact folder is the actual
 * installable update for a given target.
 *
 * The artifact folders (built by scripts/prepare-artifact.mjs) also carry
 * signing keys (.pem), detached signatures (.sig), checksum/metadata files
 * and helper executables (electron-builder's elevate.exe). The update
 * manifest must never point clients at any of those: before this module
 * existed, generate-update-manifest.mjs took the alphabetically-first file
 * from SHA256SUMS.txt, which shipped manifests telling Windows clients to
 * install elevate.exe and Linux clients to install the signing public key.
 */

// Ranked artifact patterns per update target. Earlier entries win.
export const ARTIFACT_PATTERNS = {
  windows: [/-setup-[^/]*\.exe$/i, /-win-x64-[^/]*\.exe$/i, /\.exe$/i],
  linux: [/\.deb$/i, /\.appimage$/i],
  android: [/\.apk$/i],
  ios: [/\.ipa$/i],
  pwa: [/\.tar\.gz$/i]
};

// Files that must never be offered as "the update", regardless of target.
export const NEVER_SHIP = [
  /^build-info\.json$/i,
  /^SHA256SUMS\.txt$/i,
  /\.sig$/i,
  /\.pem$/i,
  /\.ya?ml$/i,
  /\.blockmap$/i,
  /\.txt$/i,
  /\.json$/i,
  /^elevate\.exe$/i
];

export function pickArtifact(target, fileNames) {
  const files = [...fileNames].filter((name) => !NEVER_SHIP.some((rx) => rx.test(name))).sort();
  const ranked = ARTIFACT_PATTERNS[target] || [];
  for (const pattern of ranked) {
    const match = files.find((name) => pattern.test(name));
    if (match) return match;
  }
  // No ranked pattern matched: refuse rather than guess. Omitting the
  // download entry means clients still see "update available" (with the
  // release page as the source) instead of auto-installing a wrong file.
  return null;
}

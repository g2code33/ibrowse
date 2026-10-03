# ibrowse release pipeline

This repository starts from one web bundle and fans out to desktop, mobile, and PWA targets. No workflow created here publishes a tag or release unless the workflow is explicitly run through the publish gate.

## Project map

| Area | Implementation |
|---|---|
| Web bundle | `npm run build:web` copies `public/` + `src/` to `dist/`, injects CSP, `dist/version.json`, and a service-worker precache list. |
| Desktop | Electron `31.7.7` is pinned in `package.json#build.electronVersion`; electron-builder `26.15.3` creates Windows NSIS/portable and the Linux `.AppImage`, while the deterministic `dpkg-deb` packager creates the Linux `.deb`. |
| Mobile | Capacitor `6.2.2`; CI creates native platform projects as needed, then runs `cap sync` against the already-built `dist/`. |
| Updates | `src/services/updateService.js` implements client state/semver/checksum/snooze rules; `worker/update-worker.mjs` serves `/updates/manifest.json`; `scripts/generate-update-manifest.mjs` rewrites the manifest from artifact metadata. |
| Branding | `assets/brand/source.png` is the source of truth; `npm run refresh:branding` generates favicon, PWA icons, hicolor icons, `.ico`, Android, and iOS icon assets. |
| Versions | `scripts/version.mjs` updates/checks package, lockfile, web manifest, Electron metadata, Android version gradle, and iOS plist together. |

## CI workflows

### `.github/workflows/ci.yml` — PR build-only

- Trigger: `pull_request`.
- Concurrency: PR runs cancel superseded PR runs.
- Jobs: `web` first, then independent `desktop-linux`, `desktop-win`, `android`, and `ios` jobs all needing `web`.
- Uploads only the shared `ibrowse-web-dist-${sha}` web build for fan-out; platform build artifacts are build-only in PR CI.

### `.github/workflows/release.yml` — main/release build

- Triggers: push to `main`, tag `v*`, and `workflow_dispatch`.
- `workflow_dispatch` inputs:
  - `version_override`: exact semver applied to all manifests during the run.
  - `publish`: boolean, default `false`.
  - `targets`: comma-separated target list (`web,desktop-win,desktop-linux,android,ios`) or `all`. GitHub Actions does not have a native multi-select input type, so the workflow uses a validated comma-separated list.
- Concurrency: release/main runs never cancel one another.
- Job fan-out: `web` builds once and uploads `ibrowse-web-dist-${sha}`; all platform jobs download that exact artifact before packaging.
- Publish gate: only tag `v*` or `workflow_dispatch` with `publish: true`, under GitHub Environment `release`.

## Job and artifact map

Artifact names are produced by `scripts/prepare-artifact.mjs` as:

```text
ibrowse-<target>-<version>-<git-sha7>[-unsigned]
```

Unsigned artifacts include `-unsigned` in the artifact name. Each artifact directory contains the package(s), `SHA256SUMS.txt`, and `build-info.json` with `{version, sha, builtAt, runner, target, unsigned}`.

| Job | Runner | Outputs inside artifact | Signing behaviour |
|---|---|---|---|
| `web` | `ubuntu-latest` | `ibrowse-pwa-<version>.tar.gz`, `SHA256SUMS.txt`, `build-info.json` | PWA bundle is not code-signed; integrity is represented by SHA256. |
| `desktop-win` | `windows-latest` | NSIS installer `.exe`, portable `.exe`, sums/info | Signed when Windows cert secrets exist; otherwise uploaded as `-unsigned`. |
| `desktop-linux` | `ubuntu-latest` | `.deb`, `.AppImage`, detached `.asc` signatures, sums/info | GPG-signs both Linux packages when `LINUX_SIGNING_KEY` exists; otherwise uploaded as `-unsigned`. |
| `android` | `ubuntu-latest` | release APK, sums/info | Signed when Android keystore secrets exist; otherwise uploaded as `-unsigned`. |
| `ios` | `macos-14` | `.ipa` for signed export or `.xcarchive` for unsigned archive, sums/info | Signed/exported when Apple/App Store Connect secrets exist; otherwise unsigned archive artifact. |

At the end of publish, `scripts/ci-summary.mjs` writes this table shape into `$GITHUB_STEP_SUMMARY`:

```markdown
| target | version | signed? | artifact | size | why-not |
|---|---:|:---:|---|---:|---|
| windows | 0.1.0 | no | ibrowse-windows-0.1.0-abcdef0-unsigned | 123456 | WINDOWS_CERTIFICATE_BASE64 or WINDOWS_CERTIFICATE_PASSWORD not configured |
```

## Secrets

All secrets are optional-but-honest. When a required secret is absent, the workflow emits `::warning::`, writes a `## Signing skipped` section to `$GITHUB_STEP_SUMMARY`, marks `build-info.json.unsigned: true`, and adds `-unsigned` to the artifact name.

| Secret | Target | Missing-secret result |
|---|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | Windows | NSIS and portable `.exe` are built unsigned; artifact name includes `-unsigned`. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | Same as above. |
| `LINUX_SIGNING_KEY` | Linux | Base64-encoded or armored GPG private key used to create detached `.asc` signatures; without it the artifact name includes `-unsigned`. |
| `LINUX_SIGNING_KEY_PASSWORD` | Linux | Optional passphrase for the GPG private key. |
| `ANDROID_KEYSTORE_BASE64` | Android | Keystore used to sign the release APK; without it the artifact name includes `-unsigned`. |
| `ANDROID_KEYSTORE_PASSWORD` | Android | Same as above. |
| `ANDROID_KEY_ALIAS` | Android | Same as above. |
| `ANDROID_KEY_PASSWORD` | Android | Same as above. |
| `APPLE_TEAM_ID` | iOS | CI performs unsigned archive attempt; artifact name includes `-unsigned`. |
| `APPLE_CERTIFICATE_P12_BASE64` | iOS | Same as above. |
| `APPLE_CERTIFICATE_PASSWORD` | iOS | Same as above. |
| `APP_STORE_CONNECT_KEY_ID` | iOS/TestFlight | Same as above. |
| `APP_STORE_CONNECT_ISSUER_ID` | iOS/TestFlight | Same as above. |
| `APP_STORE_CONNECT_PRIVATE_KEY` | iOS/TestFlight | Same as above. |
| `CLOUDFLARE_API_TOKEN` | Web publish | Web deploy is not attempted; release assets are still prepared. |
| `CLOUDFLARE_ACCOUNT_ID` | Web publish | Same as above. |
| `CLOUDFLARE_PROJECT_NAME` | Web publish | Same as above. |
| `GH_TOKEN`/`${{ github.token }}` | Release publish | Required by `gh`; if auth fails the script exits and asks for GitHub reconnection. |

## Cutting a release

1. Bump every versioned manifest in one commit:

   ```sh
   npm run version:bump -- patch
   # or: node scripts/version.mjs 1.2.3
   git add package.json package-lock.json capacitor.config.json public/manifest.webmanifest native/android/version.gradle native/ios/Info.plist electron/app-version.json
   git commit -m "chore: bump ibrowse to v1.2.3 because release manifests must match"
   ```

2. Push through the normal PR path. Do not tag or publish from a PR.
3. After merge to `main`, release.yml builds all artifacts. It refuses to continue if the version already exists in GitHub Releases.
4. To publish, run release.yml manually with `publish: true` and the desired `targets`, or push an approved `v*` tag. The publish job runs in Environment `release` and refuses any artifact set whose `build-info.json` is unsigned.
5. Publish sequence:
   - create or reuse draft release with `gh release create <tag> <files…> -t <title> -n <body> --draft`;
   - upload/replace assets with `gh release upload <tag> <files…> --clobber`;
   - verify asset existence and sizes;
   - regenerate update manifest from those asset inputs;
   - flip live with `gh release edit <tag> --draft=false --latest`;
   - verify latest using `gh api repos/{owner}/{repo}/releases/latest --jq '.tag_name, .draft, .prerelease'`.

## Rollback or manifest repair

- Bad binary but manifest not live: rerun release.yml for the same version; uploads use `--clobber`, and the manifest is regenerated from the current artifact set.
- Bad manifest: remove or replace the bad artifact inputs, run `node scripts/generate-update-manifest.mjs dist/updates/manifest.json .artifacts`, deploy the Worker/Pages manifest again, then run `npm run release:verify -- <tag>` with `UPDATE_MANIFEST_URL` set.
- Deleted release: delete the matching manifest entry by regenerating the manifest from the remaining release artifacts. The manifest generator is idempotent and rewrites from inputs rather than appending.

## Update behaviour table

| Surface | Control | Cadence | Dismissal | Force/min-supported | Install mechanics |
|---|---|---|---|---|---|
| Desktop Windows/Linux | Permanent header `<UpdateButton>` mounted in `#top-header`; admin cannot remove it. | Auto-check after first paint when enabled; manual checks throttled to 20 seconds. | Context menu supports remind later; button remains visible even disabled/offline. | Below `minSupported` returns force state for a non-dismissible banner/gate in UI; offline degrades to warning. | Uses staged download diagnostics under userData; install path verifies byte size and SHA-256 before staging. |
| Installed PWA | Modal/bottom-sheet prompt, no header control. | Once per cold open for a version; service worker keeps waiting worker and prompts/auto reloads by admin strategy. | ×, Later, 1 day, 7 days, and never-for-version persisted locally per version/device. | Force prompt replaces dismissal with update-to-continue and offline escape hatch. | `sw.js` caches build hash; reload guarded exactly once. |
| Android/iOS | Modal/bottom-sheet prompt, no header control. | Once per cold open, after first paint/auth settlement in shared web layer. | Back/Escape/swipe-down modelled as Later; snooze persisted locally. | Force prompt shows store/direct links with offline escape hatch. | Store/TestFlight builds point to store listing; sideload/org-managed Android can use direct APK with checksum. |

## Packaging and security notes implemented

- Windows NSIS: `oneClick:false`, `allowToChangeInstallationDirectory:true`, explicit shortcut/uninstall names, installer/uninstaller icons, and `requestedExecutionLevel:asInvoker`.
- Linux: executable name is `ibrowse`; `desktopName: ibrowse` plus `linux.syncDesktopName:true` is used because electron-builder `26.15.3` states in `node_modules/app-builder-lib/scheme.json` that `syncDesktopName` makes the `.desktop` filename match `StartupWMClass` and Electron app id. `build/linux/ibrowse.desktop` is kept as the checked template and tests assert Name/StartupWMClass/Icon.
- The Electron SUID sandbox helper hook always attempts `chown root:root` and `chmod 4755` when the helper exists, and only prints `WARNING:` on failure.
- CSP is generated from `src/security/csp.js`; local asset helpers reject `..`, encoded traversal, and backslash traversal and preserve JavaScript MIME types.
- Tests can be run with network blocked via `npm run test:no-network`.

## Download commands

Replace `<runId>`, `<artifact-name>`, and `<tag>` with actual values from GitHub Actions/Releases:

```sh
gh run download <runId> -n <artifact-name>
gh release download <tag> -p '*_amd64.deb' -D .
gh release download <tag> -p '*.AppImage' -D .
gh release download <tag> -p '*.exe' -D .
```

This sandbox did not publish a run or release, so there are no real run IDs or release tags from this branch yet.

# Engineering decisions

The initial repository only contained `README.md`, so the missing project facts were filled with industry-default choices that keep one web bundle feeding all targets.

| Fact | Choice | Why |
|---|---|---|
| App/product/executable name | `ibrowse` | User supplied this value. |
| Targets on `main` | Windows NSIS `.exe` + portable `.exe`, Linux `.deb` + `.AppImage`, iOS archive/export, Android release APK, web PWA | User requested this exact target matrix. |
| Desktop framework | Electron `31.7.7` with electron-builder `26.15.3` | Electron has the broadest Windows/Linux installer support and updater ecosystem; version is pinned. |
| Mobile framework | Capacitor `6.2.2` | Lets the same checked web bundle be synced into Android/iOS native shells. |
| Web hosting and config/API | Cloudflare Pages + a Cloudflare Worker | Default static PWA hosting with an edge Worker for `/updates/manifest.json` headers, ETag/HEAD support, and rate limiting. |
| Update delivery | GitHub Releases for signed packages and SHA files; Worker-served manifest generated from the release assets | Keeps assets immutable/auditable while allowing a controlled manifest surface. |
| Bundle/app/package id | `com.ibrowse.app` | Reverse-DNS app id derived from the product name. |
| Release channel | `stable` | Default user-facing production channel. |
| Default version | `0.1.0` | First infrastructure baseline; all versioned files are locked to this semver. |

## Non-goals in this baseline

- CI definitions are present, but no release is published, no tag is created, and nothing is pushed to `main` by this work.
- Native Android/iOS platform directories are generated in CI with Capacitor before `cap sync`, so generated vendor projects do not bloat this repository.

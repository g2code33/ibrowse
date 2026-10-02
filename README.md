# ibrowse

`ibrowse` is a cross-platform web-first application shell. This repository contains the shared PWA bundle, Electron desktop packaging, Capacitor mobile targets, update-manifest tooling, and CI/release automation.

## Local gates

```sh
npm ci
npm run ci:gates
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for defaults chosen for blank project facts and [docs/RELEASE-PIPELINE.md](docs/RELEASE-PIPELINE.md) for release, signing, artifact, and update behaviour.

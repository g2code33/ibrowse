#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

# Debian packaging is owned by Electron Builder so the archive always ships the
# Electron executable, runtime, and bundled application. Keep this legacy shell
# entry point as a compatibility wrapper for release scripts.
exec node scripts/package-linux-deb.mjs "$@"

#!/usr/bin/env bash
set -euo pipefail

# Keep the first Cloudflare credential out of shell history and terminal output.
# Cloudflare does not expose an API token automatically from a new account;
# the account owner must provide the initial token once.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || "${CLOUDFLARE_API_TOKEN}" == your-* ]]; then
  printf 'Cloudflare API token (input hidden): ' >&2
  IFS= read -r -s CLOUDFLARE_API_TOKEN
  printf '\n' >&2
  export CLOUDFLARE_API_TOKEN
fi

if [[ -z "${CLOUDFLARE_API_TOKEN}" ]]; then
  echo 'A non-empty Cloudflare API token is required.' >&2
  exit 1
fi

export CLOUDFLARE_PROJECT_NAME="${CLOUDFLARE_PROJECT_NAME:-yayra}"
exec node scripts/setup-cloudflare.mjs

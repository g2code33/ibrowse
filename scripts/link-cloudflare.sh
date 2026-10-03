#!/usr/bin/env bash
set -euo pipefail

# One-time terminal link for this machine. Wrangler may open the browser for
# Cloudflare's OAuth approval; all project and deployment work remains CLI/API.
# Wrangler refuses OAuth login while an API token is present. Keep the
# deployment token in the caller's environment, but hide it from this child
# process so the interactive account-link flow can run.
env -u CLOUDFLARE_API_TOKEN npx --yes wrangler@4 login
env -u CLOUDFLARE_API_TOKEN npx --yes wrangler@4 whoami

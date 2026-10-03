#!/usr/bin/env bash
set -euo pipefail

# One-time terminal link for this machine. Wrangler may open the browser for
# Cloudflare's OAuth approval; all project and deployment work remains CLI/API.
exec npx --yes wrangler@4 login

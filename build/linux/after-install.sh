#!/usr/bin/env bash
set -euo pipefail

failed=0
for helper in /opt/yayra/chrome-sandbox /opt/yayra/chrome_crashpad_handler /usr/lib/yayra/chrome-sandbox; do
  if [ -e "$helper" ] && [ "$(basename "$helper")" = "chrome-sandbox" ]; then
    chown root:root "$helper" || failed=1
    chmod 4755 "$helper" || failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "WARNING: failed to set Electron SUID sandbox helper permissions" >&2
fi

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

# /usr/bin/yayra must be a REAL wrapper script, not the historical
# symlink to /opt/yayra/yayra: on Wayland desktops the Electron browser
# process picks its windowing backend before ANY app code runs, and
# native Wayland refuses programmatic window moves and always-on-top -
# which breaks the floating bubble. Deciding here, before Electron
# starts, is the only race-free place. An explicit --ozone-platform=...
# argument always wins; without XWayland we launch on whatever works.
rm -f /usr/bin/yayra
cat > /usr/bin/yayra <<'YAYRA_WRAPPER'
#!/bin/sh
BIN="/opt/yayra/yayra"
for arg in "$@"; do
  case "$arg" in
    --ozone-platform=*) exec "$BIN" "$@" ;;
  esac
done
if [ -n "$WAYLAND_DISPLAY" ] && [ -n "$DISPLAY" ]; then
  exec "$BIN" --ozone-platform=x11 "$@"
fi
exec "$BIN" "$@"
YAYRA_WRAPPER
chmod 755 /usr/bin/yayra

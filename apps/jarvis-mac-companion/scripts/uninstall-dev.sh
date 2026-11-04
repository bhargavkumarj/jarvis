#!/bin/bash
# Removes the development companion for the current user.
#   ./scripts/uninstall-dev.sh [--keep-config]
# Order: revoke on the server (if reachable), remove the Keychain credential,
# the Chrome native-host manifest, the app bundle and (unless kept) local config/journal.
set -euo pipefail
[ "$(uname -s)" = "Darwin" ] || { echo "macOS only." >&2; exit 1; }
APP="$HOME/Applications/JARVISCompanion.app"
HOST="$APP/Contents/MacOS/jarvis-companion"
if [ -x "$HOST" ]; then "$HOST" unpair || true; fi
security delete-generic-password -s com.jarvis.companion.device >/dev/null 2>&1 || true
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jarvis.companion.json"
rm -rf "$APP"
if [ "${1:-}" != "--keep-config" ]; then rm -rf "$HOME/Library/Application Support/JARVIS Companion"; fi
echo "Companion removed. Also: remove the extension in chrome://extensions, and confirm the Mac shows as revoked in JARVIS Settings → Computer."

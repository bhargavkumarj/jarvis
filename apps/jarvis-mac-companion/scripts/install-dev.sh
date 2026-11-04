#!/bin/bash
# Development install of the JARVIS Mac companion for the CURRENT USER only.
# No sudo, no system directories, no Gatekeeper/SIP changes, no permission prompts automated.
#   ./scripts/install-dev.sh [ORIGIN] [EXTENSION_ID]
# Defaults: http://127.0.0.1:3000 and the repository's development extension ID.
set -euo pipefail
[ "$(uname -s)" = "Darwin" ] || { echo "macOS only." >&2; exit 1; }
ORIGIN="${1:-http://127.0.0.1:3000}"
EXTENSION_ID="${2:-fomkddjghmfjocinjmbdagahcbilimof}"
[[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]] || { echo "Extension ID must be 32 letters a–p." >&2; exit 1; }
cd "$(dirname "$0")/.."

swift build -c release --product jarvis-companion
APP="$HOME/Applications/JARVISCompanion.app"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/jarvis-companion "$APP/Contents/MacOS/jarvis-companion"
cp Resources/Info.plist "$APP/Contents/Info.plist"
# Ad-hoc signature by default. Keychain items are bound to the signing identity, so
# a rebuild with a different ad-hoc signature may make macOS ask to allow Keychain
# access again. Set JARVIS_SIGNING_IDENTITY to a stable (e.g. Apple Development) identity to avoid that.
codesign --force --timestamp=none --sign "${JARVIS_SIGNING_IDENTITY:--}" "$APP"

HOST="$APP/Contents/MacOS/jarvis-companion"
"$HOST" configure --origin "$ORIGIN" --extension-id "$EXTENSION_ID"

MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$MANIFEST_DIR"
python3 - "$HOST" "$EXTENSION_ID" "$MANIFEST_DIR/com.jarvis.companion.json" <<'PY'
import json, sys
host, ext, out = sys.argv[1:4]
template = json.load(open("Resources/com.jarvis.companion.json.template"))
template["path"] = host
template["allowed_origins"] = [f"chrome-extension://{ext}/"]
json.dump(template, open(out, "w"), indent=2)
PY
chmod 644 "$MANIFEST_DIR/com.jarvis.companion.json"
echo "Installed $APP"
echo "Native host manifest: $MANIFEST_DIR/com.jarvis.companion.json (allowed extension $EXTENSION_ID only)"
echo "Next: build/load the extension (pnpm bridge:build; chrome://extensions → Load unpacked → apps/jarvis-browser-bridge/dist),"
echo "approve items with \"$HOST\" add application|folder|website|shortcut, then pair from JARVIS Settings → Computer."

# Mac companion — development setup, use and removal

For one person's Apple Silicon Mac with Google Chrome. Development install only: ad-hoc signed, not notarized, no store listing. **Status: these steps have not yet been run on a Mac** (they were prepared and partly checked on Linux; see STATUS.md). Use synthetic test items first; do not approve Shortcuts that send messages, buy things or delete files while testing.

## Prerequisites

- macOS 13 or later, Google Chrome 120 or later (the profile you use for JARVIS).
- Xcode Command Line Tools with Swift 5.9+ (`xcode-select --install`; check `swift --version`).
- The JARVIS repository with dependencies installed (`pnpm install --frozen-lockfile`), local services running and migration `202611050001_computer_control.sql` applied (`pnpm db:migrate`). **Note:** `202610310004_privacy_center.sql` currently fails to apply (see STATUS.md); computer control depends on it.
- JARVIS web running at the origin you will trust, normally `http://127.0.0.1:3000` (`pnpm dev --port 3000` or `pnpm build && pnpm start`).

## 1. Build and load the browser extension

```bash
pnpm bridge:build
```

Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, select `apps/jarvis-browser-bridge/dist`. Check the ID is `fomkddjghmfjocinjmbdagahcbilimof` (derived from the public key in `manifest.base.json`; it stays the same across reloads). For a different JARVIS origin:

```bash
pnpm bridge:build --origin https://jarvis.example
```

Only `https://` origins or an explicit loopback `http://` development origin are accepted; the service worker enforces the exact port.

## 2. Build and register the companion (current user only)

```bash
cd apps/jarvis-mac-companion
```

```bash
./scripts/install-dev.sh http://127.0.0.1:3000 fomkddjghmfjocinjmbdagahcbilimof
```

This builds `jarvis-companion`, places it in `~/Applications/JARVISCompanion.app` (ad-hoc signed; set `JARVIS_SIGNING_IDENTITY` to a stable identity to avoid repeated Keychain prompts after rebuilds), writes the trust anchor (`~/Library/Application Support/JARVIS Companion/config.json`: trusted origin + allowed extension ID), and writes the user-level native-host manifest `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jarvis.companion.json` allowing only that extension. No `sudo`, no system directories, no Gatekeeper/SIP changes, no permission prompts are automated.

## 3. Approve items on the Mac

Either from JARVIS Settings → Computer (**Approve an app/website/folder/Shortcut…** opens a native picker and review dialog on the Mac) or in Terminal:

```bash
~/Applications/JARVISCompanion.app/Contents/MacOS/jarvis-companion add application
```

```bash
~/Applications/JARVISCompanion.app/Contents/MacOS/jarvis-companion add website
```

Same for `folder` and `shortcut`. Give each an alias (lowercase, hyphens) and optional spoken names (e.g. alias `vs-code`, names `vs code, vscode`). Other commands: `list`, `remove <kind> <alias>`, `actions enable|disable <type>`, `auto allow|deny <kind> <alias>` / `auto allow|deny volume` (never for Shortcuts), `disable`, `enable`, `status`, `journal`, `journal-clear`, `unpair`.

**Dry run (executes nothing):**

```bash
~/Applications/JARVISCompanion.app/Contents/MacOS/jarvis-companion preview
```

**Deliberate local smoke test of one real action** (native confirmation required; no JARVIS server involved):

```bash
~/Applications/JARVISCompanion.app/Contents/MacOS/jarvis-companion smoke-run set_volume 20
```

It prints the observed level and the previous level with the command to restore it.

## 4. Pair and use

1. Reload JARVIS, open **Settings → Computer**. The extension should show **installed** and the companion **connected**; problems show specific recovery steps.
2. Read the disclosure, tick the box, **Turn on computer control**.
3. **Pair this Mac** → approve the native dialog (it shows the site, your masked account, this Mac and the extension ID). Pairing codes are one-use and expire in five minutes.
4. In **Assistant** (a retained conversation), type or speak-then-review “Open Safari”, “Set the volume to 30 percent”, “Open my Jarvis project folder” or “Run my study setup”. Review the card, press **Send to this Mac for approval**, approve on the Mac. The card then shows the Mac's receipt and evidence; **Stop** is available while it runs.
5. Menu bar **JARVIS** (only while Chrome is connected): Stop current action, Disable computer control, Quit.

## 5. Revoke, disable and uninstall

- Immediate local stop: menu bar **Stop** or **Disable**; or Settings → **Disable on this Mac now**.
- Server-side: Settings → **Disconnect…** next to the Mac (blocks new commands immediately).
- Unpair (server revoke + Keychain removal): Settings → **Unpair this Mac…**, or `jarvis-companion unpair`.
- Remove everything for this user:

```bash
./scripts/uninstall-dev.sh
```

Then remove the extension in `chrome://extensions` and confirm the Mac shows as revoked in Settings → Computer. `--keep-config` keeps the local config/journal.

## Manual acceptance sequence (not yet performed)

1. Pair and approve Safari, a test website, a test folder and a harmless Shortcut you wrote (e.g. one that shows a notification).
2. Speak “Open Safari”, review, send; confirm Safari launches and the receipt says it was observed running.
3. Open the approved website; the receipt must say dispatched, not loaded.
4. Note the current volume, set a safe level (20–30 %), confirm the read-back, then restore the previous level.
5. Open the approved test folder in Finder.
6. Run the harmless Shortcut; the native dialog must name it and warn that its steps run as configured.
7. Ask for an unapproved app; confirm it is refused with nothing run.
8. Disconnect the Mac in Settings, then try a command; it must not run. Repeat with local Disable.
9. Start a Shortcut that waits (e.g. 30 s) and press Stop; the receipt must say stopped/outcome unknown, not success.

Record each result with date, macOS/Chrome versions and what was observed in STATUS.md.

## Signing, notarization and distribution (later work)

A stable Developer ID identity, hardened runtime, notarization, a Chrome Web Store listing (which would give a store-assigned ID and require updating `allowed_origins`) and a signed installer are separate release tasks that need explicit authorization. Nothing was enrolled, published or deployed.

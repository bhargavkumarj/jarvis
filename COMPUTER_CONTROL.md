# Computer control v1 — architecture, trust boundaries and protocol

Prepared 2026-11-05 IST. **Status: implemented; web/database/bridge parts integration-tested on Linux; the macOS companion's native adapters are written but NOT compiled or run (no macOS/Xcode in the build environment).** Nothing here has been physically verified on a Mac. See STATUS.md (2026-11-05) for exact evidence.

This is a disciplined first release, **not** unrestricted control of the Mac. Exactly five action types exist. There is no shell, script, AppleScript, eval, arbitrary process, file read, screenshot or package-install capability, and the model is never given one.

| Action | Input | macOS mechanism (companion) | Best evidence it can report |
| --- | --- | --- | --- |
| `open_application` | `appAlias` | `NSWorkspace.openApplication(at:configuration:)` for a locally approved bundle ID | running process observed |
| `open_website` | `websiteAlias` | `NSWorkspace.open(_:)` with a locally stored exact HTTPS URL | dispatched to the default browser (page load not observed) |
| `set_volume` | `percent` 0–100 | Core Audio `kAudioDevicePropertyVolumeScalar` on the default output device | level read back |
| `open_folder` | `folderAlias` | bookmark resolved locally → `NSWorkspace.open(_:)` (Finder) | dispatched (window not observed) |
| `run_shortcut` | `shortcutAlias` | fixed `/usr/bin/shortcuts run <name>`, separate argv, no input | process exit only (steps not verified) |

## Components

```
 Browser tab (JARVIS page, exact origin)        Chrome MV3 extension (narrow relay)        Mac companion (Swift)
 ─────────────────────────────────────          ──────────────────────────────────        ──────────────────────────────
 typed/voice text ─► POST /computer/proposals   externally_connectable (host pattern)      native-messaging host (stdio)
   (deterministic interpreter, server)          + exact-origin/top-frame/active checks      pinned extension ID (argv[1])
 review card ─► POST /computer/commands          rebuilds allowlisted messages,             local config: trusted backend origin,
   authorize → one-use ticket (once)             adds Chrome-observed origin                approved catalogue, enabled actions
 ticket ─────────────────────────────────────► connectNative('com.jarvis.companion') ─►  redeem ticket with DEVICE credential
                                                                                            local policy → native NSAlert approval
 receipt ◄── events/response ◄────────────────── routes replies to the owning tab ◄──────  execute fixed action → journal → report
                                                                                                       │ HTTPS (or loopback dev)
 JARVIS server (Next.js route handlers)  ◄──────────────────────────────────────────────────────────────┘
   user routes: cookie session + Origin/CSRF          device routes: no cookies, Origin refused, device credential
 Supabase/Postgres: RLS-owned tables, SECURITY DEFINER RPCs owned by the restricted guard role
```

Repository layout (no repository reorganisation; one Next.js app, existing worker untouched):

- `packages/computer-control-contracts/` — dependency-free TypeScript protocol (actions, envelopes, results, catalogue, bridge frames, canonical digest) and `fixtures/contract-cases.json` shared with Swift.
- `apps/jarvis-browser-bridge/` — MV3 extension source (`src/bridge.ts` logic, `src/service-worker.ts` entry), `manifest.base.json` (public key → stable dev ID `fomkddjghmfjocinjmbdagahcbilimof`), `bridge.config.json` (exact origins). Built by `pnpm bridge:build` into ignored `dist/`.
- `apps/jarvis-mac-companion/` — Swift package: portable `JarvisCompanionCore` (framing, contracts, SHA-256, local state/policy, journal, HTTP backend, engine, router; XCTests) and the macOS `jarvis-companion` executable (`MacAdapters.swift`, `CompanionMain.swift`), plus `CompanionE2E` (test harness only), install/uninstall scripts and the host-manifest template.
- `src/lib/computer/`, `src/app/api/v1/computer/**`, `src/components/computer-*.tsx` — interpreter, service, device-route helpers, page bridge client, Settings → Computer and the Assistant action card.
- `supabase/migrations/202611050001_computer_control.sql` — additive tables and RPCs.

## Decisions

1. **Chrome Native Messaging, not a localhost HTTP server or open port.** Only the registered host for the pinned extension can be launched; the host speaks framed stdio. Diagnostics go to stderr, never stdout.
2. **One native target.** The companion is launched by Chrome for the connection and lives only while a JARVIS tab (or a command it is executing) holds the port. It shows a menu-bar item with Stop/Disable while running. There is no second daemon; **a disconnected companion is offline**, and the UI says so.
3. **Deterministic interpretation, no model call.** The five actions resolve only against the closed alias catalogue the Mac published. A model would add cost and prompt-injection surface but no capability, so v1 interprets locally in the server (`src/lib/computer/interpret.ts`) and uses **zero** AI budget. Unrecognised text is ordinary conversation, exactly as before. Ambiguous text asks; relative volume asks for an exact percentage; a plan has at most five ordered steps and stops on first failure.
4. **Local policy is authoritative.** A backend-authorised ticket still runs only action types enabled on the Mac, for resources approved on the Mac, after native approval unless that specific low-risk item was allowed there. Shortcuts always ask, every run.
5. **Evidence over claims.** Receipts carry an evidence level (`observed`, `dispatched`, `process_exit`, `none`) and a bounded message. Dispatch is never described as an observed outcome.

## Trust boundaries and threats

| Boundary | Control | Residual limit |
| --- | --- | --- |
| Arbitrary website → extension | `externally_connectable` host pattern (ports are not expressible) **plus** service-worker check of Chrome's `sender.origin` against exact origins, `frameId === 0`, tab present, `documentLifecycle` active, URL origin match. Messages are rebuilt from an allowlist; page-supplied origin or extra fields are rejected. Rate limited. | A compromised JARVIS page on the allowed origin can still request approved actions → native approval is the authoritative human gate. |
| Other extensions → host | Host manifest `allowed_origins` pins one ID (no wildcards); companion re-checks argv[1]. | A malicious extension loaded with the same private key is out of scope (no private key is committed; the repo holds only the public key). |
| Page/extension → companion | Companion accepts only frames whose Chrome-observed origin equals the origin configured **locally** (`jarvis-companion configure`), never one supplied by the page. Frames are length-checked before allocation (64 KiB). | — |
| Companion → backend | Only the configured origin; HTTPS, or explicit loopback HTTP for development. Default TLS validation, no cookies/cache. Device credential = 32 random bytes in the macOS Keychain (`WhenUnlockedThisDeviceOnly`); server stores SHA-256 only. | Bearer credential over TLS (not request signing). |
| Device credential scope | Anonymous RPCs re-verify credential, device `active`, account eligible (admitted, confirmed, not banned, **no pending account deletion**). They reach only that device's own commands; anon has no table grants. | — |
| User → user | RLS on all public tables; owner-bound RPCs via `m2a_owner_v1` (live session, admission, privacy-job gates). Two-user tests prove isolation. | — |
| Model/prompt injection | No model in the path; inputs are aliases/percent only; digest binds parameters; native approval shows exact local targets (bundle ID, URL, folder path, Shortcut name). | An attacker already controlling macOS or Chrome is out of scope; no perfect-safety claim. |

## Pairing (one-use, short-lived, bound)

1. Signed-in user (computer control turned on with disclosure `computer-control-2026-11-05-v1`) presses **Pair this Mac**. `POST /api/v1/computer/pairings` (same-origin, session) creates a pairing bound to the **account, current Auth session, server origin and extension ID**, valid **300 s**, storing only `sha256(code)`; limits: 5 per 10 min, 3 active Macs.
2. The page passes `{pairingId, code}` to the extension → companion. The companion checks the page origin against its local trust anchor, then calls `device/pairing-inspect`, which returns a **masked** account label and the origin (refused unless it equals the configured origin).
3. The companion shows a **native** dialog (origin, masked account, this Mac's name, extension ID); the default button is *Don't Pair*.
4. On approval it generates the device secret, stores it in the Keychain **first**, then `device/pairing-complete` sends `sha256(secret)`. The SQL claim locks the pairing row, re-checks code, expiry, extension, live issuing session, eligibility and consumes it once. A failed completion deletes the local secret.

## Command tickets

1. `POST /computer/proposals` → interpreter → `computer_propose_v1` stores canonical actions, display labels and `digest = sha256(canonicalCommand(device, command, actions))` (TS, SQL and Swift compute it identically; fixture-tested). Proposal valid 300 s; idempotent per request ID.
2. User presses **Send to this Mac for approval** (or, if every step was locally allowed, it proceeds after the reviewed submission). `computer_authorize_v1` requires the **same digest** (a changed target/parameter invalidates approval; a bare “yes” is never a confirmation), an active owned device, computer control on, and **one active plan per Mac** (unique partial index). It issues a 32-byte ticket, stores its hash with the **issuing Auth session**, valid **60 s**, and returns the ticket once.
3. Extension carries `{commandId, ticket}` only. The companion refuses if locally disabled, busy, or already journaled.
4. `device/redeem` atomically claims under a per-owner advisory lock: correct device, ticket hash, not expired, state `authorized`, control on, **issuing session still live** (sign-out ends ticket authority). A second redeem returns `already_claimed` (reconciliation only, never a second authorisation). The route re-validates the envelope; the companion re-computes the digest and checks device ID.
5. The companion journals the plan (flushed) **before** any action, checks local policy for every step, shows the native approval (60 s timeout → cancelled), then before **each** step calls `device/progress`, which returns `continue:false` on user Stop, control disabled, sign-out, revocation or account deletion; network failure fails closed.
6. `device/finish` stores a strictly validated, bounded result (≤5 results, ≤16 KiB). A server-side `outcome_unknown` may be replaced by the Mac's later report; other final states are never overwritten.

**Expiry instead of late execution:** unclaimed approvals expire; a confirmation that returns after >90 s expires the plan; claimed plans with no report for 15 min become `outcome_unknown`. Nothing is queued to run when a Mac reconnects. **Crash recovery:** in-flight journal entries become `outcome_unknown` (or `cancelled` if no step started) and are reported; they are never replayed, and unknown Shortcut runs are never retried.

States: `proposed, awaiting_confirmation, authorized, running, succeeded, failed, cancelled, expired, outcome_unknown`.

## Stop, disable, revoke, sign-out, deletion

- **Stop** (Assistant card or menu bar) cancels locally at once (dismisses the approval dialog, terminates a running Shortcut process) and asks the server to block later steps. A step already done is **not reversed**; a Shortcut's in-flight side effects may continue.
- **Disable on this Mac** is local and needs no backend; re-enabling needs native approval.
- **Disconnect** (Settings) revokes the device server-side: new redeem/progress/finish fail; unclaimed approvals are cancelled; a running plan stops at its next check.
- **Sign-out** ends the authority of tickets issued by that session (at redeem and at every step).
- **Account deletion** makes every device credential ineligible immediately (pending account job); final erasure cascades all computer rows. There is **no instant remote recall** of an action already executing.

## Privacy

- Leaves the Mac: aliases, labels, spoken names, website **hostnames**, enabled action types, auto flags, results. Stays on the Mac: bundle IDs/paths, full URLs, folder bookmarks/paths, Shortcut names/identifiers/inventory, device secret, journal.
- Sent to the server: the typed or reviewed-voice message text, for interpretation only when computer control is on (not stored in conversation history); the structured plan and receipts. No AI provider receives computer text in v1. Existing cloud-text consent is not reused for computer control.
- Retention: server history 30 days, export categories `computer_devices`/`computer_actions`, **Clear computer history** in Settings. Local journal ≤200 metadata-only entries/30 days, `jarvis-companion journal-clear`. Never logged: tickets, codes, secrets, Shortcut output.

## Platform facts (verified 2026-11-04 UTC) and minimum versions

- Chrome Native Messaging, `externally_connectable`, match patterns, MV3 service-worker lifetime and manifest `key` — read from the Chrome docs **source repository** `GoogleChrome/developer.chrome.com` (raw GitHub, files under `site/en/docs/extensions/mv3/…`; developer.chrome.com itself was blocked by this environment's egress policy, so this is the repository's latest available copy, possibly older than the live site). Confirmed: host manifest fields/locations, `allowed_origins` without wildcards, 4-byte native-order length prefix, 1 MB host→Chrome limit, argv[1] = caller origin, `connectNative` keeps the service worker alive (Chrome 105+), match patterns do not encode ports.
- Apple: `NSWorkspace.openApplication(at:configuration:completionHandler:)` (macOS 10.15+), `open(_:)`, `urlForApplication(withBundleIdentifier:)`, `URL.bookmarkData`/`NSURL(resolvingBookmarkData:…)`, `SecItemAdd`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, `AudioObjectSetPropertyData`/`AudioObjectIsPropertySettable` (HAL may apply changes asynchronously), `kAudioDevicePropertyVolumeScalar`, `NSAlert`, `NSOpenPanel` (out-of-process since 10.15), `NSStatusItem`, `Process` — from developer.apple.com documentation JSON.
- **Not verified:** the Shortcuts command-line guide (support.apple.com was unreachable). The companion assumes `shortcuts list --show-identifiers` (name + identifier) and `shortcuts run <name>`; check on the Mac before relying on Shortcut actions. The companion is **not sandboxed**, so security-scoped bookmarks are not needed; a future sandboxed build must add `.withSecurityScope` and `start/stopAccessingSecurityScopedResource`.
- Minimums chosen: **macOS 13** (Apple Silicon target; `kAudioObjectPropertyElementMain` needs 12+), **Chrome 120** (`minimum_chrome_version`). Permissions: none are requested to enable the companion; Accessibility, Screen Recording, Full Disk Access and admin rights are never needed for these five actions. macOS may ask once to allow Keychain access after rebuilding with a different signature.

## Future boundary (not implemented)

Read-only search in selected folders; previewed file edits with recovery; semantic browser automation in a dedicated context; screen-based computer use with separate capture consent; native push-to-talk then an optional local wake word. Each would be a new typed action in the registry with its own policy, confirmation and evidence; none gets shell access.

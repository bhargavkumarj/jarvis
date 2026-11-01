# Personal-version implementation candidate

**2026-11-01: Personal-version implementation candidate prepared; runtime acceptance pending.** The bounded finishing pass adds optional three-field quick setup, clearer provider/consent/retention states and cross-feature stream/session consistency. No new major subsystem, processor or dependency. Lint/typecheck, **357 unit/mocked tests** and production build pass; database/process/browser/HTTPS/live/device verification remains deferred. No earlier milestone is accepted.

Use [STATUS](STATUS.md) for the single capability/evidence checklist and [MACHINE_HANDOFF](MACHINE_HANDOFF.md) for exact requirements, all pending migrations (through 202610310005), fresh/optional retained setup, secure credentials, web/worker startup and the integrated first smoke. New-machine starting action: extract the source archive into an empty directory, then `pnpm install --frozen-lockfile`. No Docker action is requested on the old laptop.

Quick setup is optional at `/welcome`, linked from Assistant for new accounts and always from Settings. It changes name/style/zone only; providers and permissions remain separate. Suggestions draft text only. Mock behavior is explicitly labelled; live mode requires private configuration, consent, a selected qualified model and budget. No proactive messages are implemented. Notification permission, disconnecting private channel configuration and cancelling a confirmed reminder are distinct; in-flight requests cannot be recalled.

The reviewed archive is `.local/transfer/jarvis-source-20261101-personal-candidate.tar.gz`; it excludes credentials, retained data, exports, recordings and generated caches. Historical feature notes follow; current evidence is the ledger above.

---

# Personal assistant — local application with optional live providers

A local workspace with authentication, owned preferences, retained/temporary conversations, approved memory, reviewed one-time/recurring reminders, push-to-talk review and focused personal tasks. Optional single-account OpenAI/Pushover adapters remain separate from explicit mocks. No hosting, public registration or home control.

**2026-10-31 Privacy Center:** lint/typecheck, **334 unit/mocked cases** and production build pass. Database, browser, worker/finalizer, HTTPS, live and device checks remain deferred. Migration 202610310004 and earlier operator/recurrence/voice/task files are pending. M1/full M2 and prior feature acceptance remain open; manual SR/phone checks are Deferred—not tested and remote CI not run. See [STATUS](STATUS.md) and [MACHINE_HANDOFF](MACHINE_HANDOFF.md).

## Privacy Center (source ready; runtime verification pending)

In Settings choose separate cloud text, transcription and Pushover permissions. Turning AI off does not cancel reminders. Select 7/30/90/365 elapsed days for conversation history (30 default), with explicit warning before shortening. Expired history is unavailable immediately; the worker deletes it in bounded batches. Approved memories remain until you delete them; deleting a source removes its link, not the approved note.

Verify your current password for a five-minute sensitive-operation window. Download bounded owner-scoped JSON, or review a precise bulk-deletion scope and type its exact confirmation. Exports contain current available data/provenance and safe usage, not passwords/keys/session tokens/private diagnostics/audio. They may reflect concurrent edits, are limited to 32 MiB/two minutes and create no server file, public URL or email. Protect the downloaded file yourself.

Account deletion blocks application access first. The existing `pnpm worker` removes content/queue records; **separate `pnpm privacy:finalizer`** removes same-owner local credentials/evaluation and supported Auth identity. This command uses local operator rights only in that process, never web/reminder requests; startup/processing has not run here. Keep the browser receipt at `/privacy/deletion` to inspect pending/failure/completion. Retry cannot restore erased data. No phone/provider recall, remote key/account revocation, physical erasure or automatic backup deletion/restore protection is promised. Source/developer artifacts, logs and provider copies are separate boundaries; minimal operational metadata remains for documented retry/budget purposes. Read the inventory and durations in [ARCHITECTURE](ARCHITECTURE.md).

“Forget this” asks whether you mean saved memory, source conversation or both. It never deletes your account or promises the assistant cannot infer from retained text. Use existing item controls or Privacy Center for exact deterministic confirmation. Full synthetic verification and recovery are in the handoff; no Docker/live action is requested on this laptop.

## Personal tasks (source implemented; runtime verification pending)

After the new-machine migration/check sequence, open Today → Your tasks. Add a title without a reminder, then open task details for notes and no/date-only/exact-time deadline. Date-only means the whole day in its saved IANA zone, overdue from next local day; exact time is overdue at the resolved instant. A task without a deadline is never overdue. Changing your profile/device timezone does not move it. Complete/reopen/cancel are explicit controls; Delete requires confirmation. Closed tasks are available through the completed/cancelled filter.

Task deadlines never automatically notify. In task details, explicitly review a **separate** one-time reminder date/time/timezone/channel, then confirm the exact saved preview. Mock remains mock; Pushover needs the personal account's bound configuration. Closing/deleting a task cancels unsent work but cannot recall an in-flight/accepted notification. Reopening never reactivates it, changing a deadline never moves it, and reminder delivery never completes a task. Remove/cancel the reminder to keep the task. Generic reminder/attempt history stays independent of deleted task titles/notes.

Chat examples: “Add a task to finish my assignment” → Today review; “Make it due YYYY-MM-DD” → review; “Make it due Friday” → clarification; “Remind me about it tomorrow at 7 PM” → separate exact linked-reminder review; “Mark the assignment task complete” → review; “Show my overdue tasks” → bounded owned query. Known commands need no AI; live proposals use the same typed boundary with at most eight relevant task references and no notes. Multiple matches ask which task. Persistent actions are disabled in temporary chat; voice transcripts get no added authority. Projects, subtasks, collaboration, recurring task generation and calendar integration remain out of scope. App export/erasure has the separate Privacy Center above, with runtime acceptance pending.

## Push-to-talk and optional read-aloud (runtime verification pending)

In Assistant, use **Start microphone recording → Stop → Transcribe recording → Review/edit → Use transcript in message → Send**. Mouse/touch/keyboard work without holding a button. Typing stays available. Capture is at most 60 seconds; stopping releases the microphone. Cancel, hide, navigate or sign out to discard unsent audio/review; no automatic resume/upload. The default transcription provider is a **deterministic mock**, which does not recognize speech.

Live audio is independently off until the personal OpenAI key/server transcription flag is configured **and** you explicitly enable cloud transcription under the audio privacy disclosure. Microphone permission alone does not consent to OpenAI processing. On the new machine, after migrations/private key setup, `pnpm live:configure transcription` enables only the server flag and makes **no API call**. Restart web; opt in, then explicitly select OpenAI in the voice control. It uses fixed current `gpt-transcribe`, not your text-model selection. Price/availability and the runtime sequence must still pass. Keep `JARVIS_MOCK_ONLY=1` for automated tests. No public key/env variable or paid resource addition.

Audio becomes canonical mono 16 kHz PCM16 WAV locally; server verifies actual duration/size (0.2–60 seconds, ≤1,920,044 bytes). Browser recording format/Web Audio support is required; unsupported/denied/unavailable devices retain typing. No raw audio is stored in DB/files/object storage and no history/memory accompanies it. Numeric usage/consent metadata persists; an unsent transcript does not. When sent, existing retained/temporary chat and separate memory/reminder confirmation rules apply. Uncertain network retries reuse the recording ID and cannot make a duplicate paid call; the server does not retain a replay transcript. Recording again explicitly creates a new potentially charged request.

The existing ₹1,000/month AI allowance includes transcription; reserve ₹1/minute-bounded recording, reconcile duration or hold on uncertainty. ₹500 contingency stays separate. Read-aloud is explicit, completed-only **local browser synthetic voice**, 0.8–1.2× and bounded to 2,000 plain-text characters/45 seconds. No remote voice fallback or cloud speech generation. Locality is the browser's indication, not an independent guarantee. See [MACHINE_HANDOFF](MACHINE_HANDOFF.md) for pending DB/browser/device checks; no compatibility or live acceptance is claimed.


## Recurring reminders and snooze (source ready; runtime verification deferred)

After the new-machine migration/verification sequence in [MACHINE_HANDOFF.md](MACHINE_HANDOFF.md), use Today → Recurring reminders. Choose daily or selected weekdays, start/end dates, HH:mm, an explicit IANA timezone and mock/live channel. Preview the next three local dates, UTC instants, offsets and clock adjustments; confirm that exact review separately. Editing invalidates the preview. Pause/resume/cancel affect the series; Skip next and Snooze affect one occurrence. History remains inspectable below.

Gap times shift forward by the clock change; folds choose earlier once. The fixed timezone does not follow the device. Default lateness is five minutes (1–60 configurable); older unsent occurrences are Missed rather than delivered in a burst. Resume starts with the next future occurrence. Snooze presets add 10 minutes/one hour to the later of now/current due; custom times require explicit one-time DST resolution. Reject overlap with the next recurrence and any already authorized, accepted or unknown send. No in-flight notification can be recalled.

Mock chat example: `Remind me every weekday at 8 PM to study starting YYYY-MM-DD` (use an actual future date). The current confirmed profile timezone is shown for review. Without a start date it asks for clarification. Daily and a single named weekday also work; this is a narrow deterministic fixture, not natural-language AI proof. The live typed provider may propose daily/weekly schedules, but only your exact Today confirmation schedules them. Snooze is Today-only. Temporary chats cannot create a series or snooze. Monthly/yearly/arbitrary recurrence and calendar integrations remain unsupported. Focused non-recurring tasks are described above.

Migration `202610310001_recurring_reminders.sql` is new and **unapplied here**, dependent on the earlier chain including pending permission repair 010. Reuse the existing web/worker commands; no new daemon or package. DB/RLS/worker/browser/live tests are written/deferred, not passed. Existing spending/privacy decisions and processor configuration remain unchanged.


## Prerequisites

- Node.js 24; the environment used 24.14.1. Use a maintained patch release for normal development.
- pnpm **10.34.9**, pinned in package.json. A working Corepack shim can use that pin; otherwise install this version using [official pnpm guidance](https://pnpm.io/10.x/installation).
- Docker Desktop or a compatible running local container runtime, accessible from your terminal.
- Registry/container-image network access, local ports 3000 (dev), 3100 (browser test server), and 54320–54324, and permission for Supabase CLI to write its local configuration/cache.
- For browser tests, the Chromium revision matching the pinned Playwright package.

The CLI wrappers require a local Unix-socket Docker context (or local Windows named pipe); remote/TCP contexts and remote CLI flags are rejected before execution. No paid account, cloud Supabase project, AI key or production secret is needed. Configuration rejects remote application/backend URLs for this milestone. Do not link this repository to a production database for testing.

## M2A: local conversations and approved memory

The current slice uses a **deterministic mock**. No live AI, API key, paid service or external provider is connected. It does not demonstrate conversational quality. Retain synthetic data.

1. With local Supabase running, apply the additive migration using `pnpm db:migrate` (already reported successful for 202610290001). No reset. Keep your existing `.env.local` and synthetic credentials.
2. Run `pnpm dev` and sign in using your local synthetic account. If using `pnpm start`, restart the app after `pnpm build` so it loads the current build.
3. In Assistant, start a retained conversation and send `Remember this: favorite color: blue`. Streaming is marked unconfirmed until the response is committed.
4. Open Memory. Inspect the exact content/source, optionally save an edit, then separately approve the current version. Pending/rejected content is excluded from retrieval.
5. Start another conversation and ask `What favorite color?`. The mock includes matching approved notes and labels them **Used approved memories**. This is substring matching, not semantic understanding.
6. Edit/delete memories in Memory. Deletion excludes retrieval and clears derived saved replies; source user messages remain until their conversation is deleted. Deleting a conversation removes its messages/proposals; independently approved memories survive with source links cleared.

Temporary conversation keeps content only in this page's memory; refreshing/closing loses it. Saving and retrieval are disabled there. No temporary content goes into database tables, content logs, localStorage/sessionStorage or summaries. Use a retained conversation if you want to propose a memory.

Mock fixtures: ordinary text → labeled reply; `Remember: …` → pending proposal; two `Remember: favorite color: …` values → explicit replacement review; `/mock fail` → provider failure; `/mock interrupt` → partial stream failure; `/mock slow` → stoppable stream; `/mock unauthorized` (or `/task`, malformed `/remind`, `/browse`, `/shell`, `/sql`) → unsupported-action explanation without execution. No action is reported complete before its commit/result.

Retry keeps the request UUID and original user turn. Failed/cancelled responses store no partial assistant text; stale/running attempts deny retry until stopped or their 45-second lease expires. Completed replay cannot resurrect a rejected/deleted proposal. Temporary retry has no durable content or action record.

Tests: `pnpm test` covers mock/stream/validation rules; `pnpm test:integration` includes real domain RLS/admission/revocation alongside Auth; `pnpm test:e2e` includes retained review/continuity/deletion, temporary absence, failures/cancel/retry, forged IDs and automated accessibility at both widths. Current execution results and exact limits are in STATUS, not inferred from test definitions.

## Existing checkout: audit before another repair

All current work preserves the retained database. From a normal terminal, run **`pnpm local:audit`** first. This read-only command reports applied versions, role memberships, grants, policies, deployed helper ownership/search paths/body hashes and source-match flags, plus synthetic-account/profile/admission state. It compares local configuration in memory and never prints keys, passwords, cookies, tokens or email codes. Its database read-only transaction is an operator diagnostic, not tenant-isolation proof. If blocked, share only its sanitized output. Do not edit/apply a migration or reset data merely because an older report called it pending. The M2A audit confirmed three applied migrations and 14 matching function bodies; M2B adds migrations and requires updated audit evidence. Preserve applied files.

Historical M1 managed checks: lint/types/build and 57 unit tests passed; the user also reported 13/13 real integration tests passing in the normal terminal; clean frozen offline installation passed in a separate temporary directory using the existing store. Managed Docker/network/listener restrictions remain, but E2 browser execution now reports all 10 passing after a test-only form-scoping repair. STATUS.md is the dated evidence ledger.

## Fresh local setup

Run from this directory in a normal local terminal with the prerequisites above:

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm local:setup
pnpm local:users
pnpm dev
```

Open **http://127.0.0.1:3000**. Use that exact host (not an interchangeable localhost tab): cookie/origin handling is intentional.

These setup scripts are implemented, but the full sequence **could not be verified here**. Docker access and CLI home-directory writes were denied. The dev/test server also cannot bind a port in the sandbox. Do not interpret these instructions as a completed local smoke test.

If `db:start` fails, later commands in the `&&` chain have not run. The wrapper reports a fixed diagnostic for common Docker, permissions, port, configuration and image-download failures without echoing keys. Open Docker Desktop and wait for its engine, then run `docker info --format '{{.ServerVersion}}'` in your normal terminal. If that succeeds, retry `pnpm db:start`. Do not use `sudo`, delete volumes or change directory permissions broadly to work around a failure. For an unclassified failure, inspect `pnpm exec supabase start` privately; its output can contain credentials, so share only the relevant redacted error.

If the error mentions `meta.db: read-only file system`, Docker cannot write its internal storage; an API key will not fix it. Check Mac free space (`df -h /System/Volumes/Data`), free space if needed, then use Docker Desktop's Troubleshoot → Restart option. If it persists after a Mac restart, investigate Docker storage recovery before continuing. Do not reset Docker, remove its disk image or delete volumes without preserving any existing Docker data. The `[inbucket]` deprecation warning is separate from this failure.

A reported SQLSTATE 42501 at the original `ALTER ROLE jarvis_auth_guard` was a foundation migration bug, repaired in this checkout. Retry `pnpm db:start` with the corrected files. It does not require new credentials, elevated filesystem permissions or a superuser application role. No database reset is needed as a first troubleshooting step; the later E2 audit confirms both migrations applied and all 13 real integration cases pass.

The shared config explicitly disables Supabase Edge Runtime because M1 uses Next.js endpoints and has no Edge Functions. A reported 503 from that optional container occurred after migration/seed succeeded. Retry normal `pnpm db:start` with this config; required-service health checks are still enforced. No reset or credential change is needed for the exclusion.

`local:setup` captures only the local URL and publishable/anon key into ignored `.env.local` with mode 0600. It preserves an existing file. `.env.example` contains names/descriptions only. Never place a service-role key in application configuration.

`local:users` creates two synthetic accounts, **alex@example.test** and **sam@example.test**, through the isolated local admin API. Their fixture emails are confirmed for testing; normal users still use the actual email verification flow. Random passwords live only in ignored `.local/users.json` (mode 0600). View that file privately in your editor. Do not paste passwords into chat, commit them, or include them in screenshots. Existing accounts with mismatched credentials are preserved and reported, not silently reset.

The operator admission seed additionally allows **recovery@example.test** for testing real registration and email confirmation. No account is initially created for it. Register that address using a password you choose locally, then open the local mailbox at **http://127.0.0.1:54324** and enter the email code at `/verify`. Use `/recover` and `/verify?mode=recovery` to test password reset. There are no credential-bearing links or arbitrary redirect destinations.

## Email verification troubleshooting

For an email titled **Confirm your local account**, use `/verify` (account confirmation). For **Reset your local password**, use `/verify?mode=recovery` (password recovery). The email address must match. The form labels its purpose and provides **Request a new code**; this sends the matching request and clears the old code input. Open the newest matching email in the local mailbox. Codes expire after ten minutes and are single-use; do not share codes or screenshots containing them.

Signup OTP verification uses the current documented `email` type; recovery uses `recovery`. The old `signup` verification type was deprecated in the installed SDK. Resend still uses Supabase's `signup` resend type, which is a different operation. Verification failures now distinguish rejected codes, rate limiting and service failure using fixed messages. No raw provider message/request data is returned. No session is claimed without the provider returning a session. The E2 full desktop/mobile email lifecycle now passes.

If no new code appears, clear any Mailpit search filter and refresh the inbox, then run `pnpm local:diagnose` in a second terminal. This is a read-only local operator command: it checks only the synthetic fixture accounts and prints existence/confirmation state plus Mailpit connectivity and matching message counts/kinds. It prints no credentials, IDs, email bodies or codes. Its admin client is confined to local CLI tooling, never an application request. An already-confirmed account should use password sign-in or the recovery flow, not repeat signup confirmation. Provider-side throttling and service failures are now reported; other eligibility results retain generic copy and do not claim delivery. Successful live diagnostic execution remains pending outside the managed sandbox.

## Apply the profile-access repair without resetting data

A valid password followed by “Check your details and access” can be caused by the original guard reading Supabase-managed Auth tables under RLS with no applicable policy. Migration `202610280001_auth_session_visibility.sql` repairs this using a private, caller-bound boolean Auth-session function owned by the existing privileged migration role. It does not grant bypass privileges to the guard or application roles, expose Auth rows or change account ownership/admission checks.

The repair also removes the restricted guard's dependency on Auth-schema helper lookup. It reads caller IDs from PostgREST's verified transaction claims, handles missing/empty claims safely, and updates sign-out as well as profile access. The managed Auth-session check remains in the private privileged boolean bridge; ordinary user requests still use their own JWT and RLS.

First establish applied history and definitions with `pnpm local:audit`. Only when that evidence shows the corrective migration is still pending and reviewed, run `pnpm db:migrate` in a second terminal, then retry password sign-in. This applies pending migrations via `supabase migration up --local`; it preserves existing accounts/preferences. If the wrapper cannot identify a failure, inspect `pnpm exec supabase migration up --local` locally and share only the ERROR/SQLSTATE and failed statement, without credentials. It is not a database reset. The installed CLI help confirms command/flag availability; execution in the managed environment remains Docker-blocked. The E2 audit already confirms this migration applied and matched source, and real user/RLS tests pass; fresh reconstruction remains blocked and manual acceptance is explicitly deferred; type generation/review passes.

## Manual acceptance check

1. Visit `/settings` signed out; expect a sign-in redirect. A private API request must return 401 once local configuration is valid.
2. Sign in as Alex, open Settings, change the name/tone/timezone, save, then reload. Only a committed result should show “Preferences saved.”
3. Enter `Mars/Olympus` as timezone. Expect a useful field error and no save.
4. Sign out, then sign in as Sam in the same browser. Alex's display/preferences must not appear. Repeat in a separate private browser session.
5. Try registering an address not in the local admission seed. The UI returns generic eligibility copy; direct Auth signup is rejected by the database trigger. Run the integration suite for direct API/RLS attacks.
6. Verify registration/recovery through the local mailbox. Test keyboard-only navigation, visible focus, 390px and 320px layouts, reduced motion and a screen reader. Check behavior with Supabase stopped and when a session expires.

**Deferred—not tested**, by explicit user decision 2026-10-29: screen-reader and real-phone keyboard/scroll checks. Follow up **before private beta**; do not repeatedly request them during this stage. Retain this checklist for that follow-up (record device, OS/browser, reader and actual observations):

- Screen reader: enable VoiceOver on the Mac or TalkBack on Android. Navigate sign-in and Settings without a mouse. Confirm each field has its label, focus order is usable, invalid timezone errors are announced, saving is announced, and sign-out is reachable.
- Real phone: in portrait, open Settings and focus the lowest text field. Type with the on-screen keyboard, scroll to Save, save and reload. Rotate, repeat, and sign out. Fail the check if focused controls/Save cannot be reached, content scrolls horizontally, or saved values disappear. Browser emulation is not this evidence.
- For Android access while keeping the server loopback-only: connect USB and set up Chrome remote debugging; in desktop `chrome://inspect/#devices`, enable USB discovery and forward device port `3000` to `127.0.0.1:3000`. Open **`http://127.0.0.1:3000`** on the phone so the configured Origin still matches. Disconnect/disable debugging and forwarding when finished. [Official Chrome USB forwarding instructions](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) checked 2026-10-29. Do not expose Supabase or the app publicly for this check.

Manual checks are deferred as above. Local HTTPS verification passes nine runtime groups separately from the HTTP suite. The main authenticated desktop/mobile preference flows pass; screenshots and axe do not establish manual screen-reader behavior. Controlled local M2C processor use is approved; start with synthetic acceptance and preserve the documented retention/privacy boundaries. Hosted real-data use remains a separate, unmet gate.

## Checks and database lifecycle

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

These checks ran successfully (69 unit tests for M2A). The build uses webpack; Turbopack subprocess port binding was blocked here. `pnpm start` serves the built application on the same loopback origin when local networking is permitted.

With the runtime running and its migration state verified, execute the real suites without resetting the development database:

```sh
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The managed environment cannot bind/access the runtime; normal-terminal execution supplies actual live evidence. M2A integration **27/27 passes**, including all 13 Auth regressions. The final browser run is **16/16 passed**, confirmed by local last-run metadata, after semantic/hydration and explicit route/version readiness repairs. The repaired suite now launches its own fresh production server on **http://127.0.0.1:3100**, with only that process's APP_ORIGIN set accordingly; it never reuses your dev server on 3000 or edits `.env.local`. Keep Supabase running; leave port 3100 free and run `pnpm test:e2e` without manually starting another test app. Playwright stops its owned listener afterward. Auth controls wait for hydration; blocked-script tests verify input cannot be lost before handlers attach. The final mobile reload test now waits for Memory route/proposal readiness and verifies the newer pending revision before approval. The final passing run is recorded in STATUS. No security assertion or axe rule was removed.

Fixtures own random `m1-<run>-<name>@example.test` aliases per suite/project and clean only their exact records. They preserve `.local/users.json` and retained Alex/Sam/recovery preferences/sessions. No DB reset, credential artifact or shared single-use OTP is required. Full desktop/mobile and Auth regressions remain enabled; traces/screenshots/videos remain off.

HTTPS is a separate runtime check: run **`pnpm test:https`** with Supabase running and an existing `pnpm build` output. It uses test-only port **3443**, the existing production Next handler, a one-day private temporary certificate and random synthetic accounts. It checks a certificate-validated Node TLS request, browser Secure/HttpOnly/SameSite=Lax/Path cookie flags, JavaScript exclusion, A/B preferences/reload, origin rejection and sign-out. No cookie values or credential-bearing errors/artifacts are printed. Normal completion/error cleanup removes only its fixtures, certificate and listener; `.env.local` and the HTTP listener are unchanged.

Only that isolated Playwright context accepts the self-signed certificate; no OS trust store or global TLS-verification setting is changed. This is local HTTPS behavior evidence, not public certificate/deployment validation. It does not replace the HTTP suite (which intentionally expects non-Secure cookies at the configured HTTP origin). The managed terminal's attempt stopped at listener EPERM before assertions; the subsequent E2 normal-terminal run **passed all nine runtime groups**, with cleanup confirmed and system trust unchanged. This was rerun successfully after M2A shared-control changes.

Fresh database reconstruction is a **separate** check. `pnpm db:reconstruct` prepares a private temporary workdir, copies only config/migrations/templates/seed (no retained data or credentials), chooses a random `jarvis-m1-rebuild-<nonce>` project and ports **55320–55324**, then starts only needed local services. It checks fresh migration history/restricted role and ordinary Alex/Sam profile access in that disposable stack. It now also compares read-only retained fingerprints before/after cleanup (profiles, admissions, revocations, Auth identity/confirmation/ban metadata and migration versions; excludes volatile sessions). Values/hashes are never printed. Pause other app/tests during reconstruction; concurrent edits fail comparison without attributing the change to the tool. This comparison is prepared but not yet executed. Cleanup explicitly targets only that generated project, including its disposable volumes; it never resets `jarvis-foundation`. If cleanup cannot be confirmed, its project ID is printed and the workdir is preserved for operator inspection.

The tool refuses remote/TCP Docker contexts and requires **5 GiB free** on the temporary filesystem as a conservative local safety guard, not a claimed Supabase platform minimum. The E2 attempt on 2026-10-29 IST stopped before stack startup with **insufficient_disk_headroom**; reconstruction has not passed. This workflow's syntax was checked. Host disk pressure must be resolved before running it if its headroom check blocks. Do not prune/delete unrelated data to satisfy it.

The CI definition also starts Supabase on a fresh hosted runner and no longer resets a retained project. A copied directory alone is NOT a disposable database: the fixed project ID can still select the same Docker volumes. `pnpm db:reset` remains an explicitly destructive local command for a knowingly disposable project, never a login repair or prerequisite to repeating these tests. No fresh reconstruction or remote CI pass is claimed yet. Existing M1 acceptance requires the CI workflow and its safe isolated/no-production-secret design; it does **not explicitly require a remote GitHub Actions run**. Remote CI remains **not run**; no remote/publishing step is authorized or necessary to manufacture that evidence.

The integration suite signs in with ordinary A/B credentials and attacks RLS via the Data API. A separate local admin connection creates/cleans only per-run fixtures, toggles their admission/session conditions and inspects catalogs. Isolation assertions use ordinary user clients; admin catalog inspection is not isolation proof. Missing runtime/fixtures fail the suite with an explicit BLOCKED message; nothing is mocked to pass.

Playwright exercises desktop/mobile settings, keyboard/focus, axe accessibility, reload, validation, cookie flags, CSRF, sign-out, A/B cache separation, and registration/recovery through local email. Traces, screenshots and videos are off to avoid capturing credentials. Public layout tests can run separately with `pnpm test:e2e --project public-desktop --project public-mobile`; they still require a permitted loopback server and installed browser.

`pnpm db:stop` stops this local project without requesting volume deletion. `pnpm db:types` writes `src/lib/database.generated.ts` from the local database; review it against the current hand-maintained `database.types.ts` contract before adopting it. Generation succeeded in E2 and was reviewed in E1 on 2026-10-29 IST; columns and RPC match, while the application contract retains bounded tone/locale unions. Type checking/lint pass. Keep SQL migrations authoritative; never generate types against production as part of this test path.

## Security and structure

- `src/app`: App Router pages and versioned JSON APIs.
- `src/components`: accessible native-control UI; no future-feature mocks.
- `src/lib`: strict validation/config, user-scoped server client and request guards.
- `src/proxy.ts`: session refresh, CSP nonce and private/no-store responses. Authorization is independently checked in protected handlers/pages and RLS.
- `supabase`: local config, migration, synthetic admission seed and code-based email templates.
- `scripts`: local-only setup/reset/type tooling with credential output suppressed.
- `tests`: unit boundaries, real database isolation, browser behavior.
- `.github/workflows/ci.yml`: checks against an ephemeral local Supabase instance; read-only repository permissions, no production secrets, no deployment or sensitive artifact uploads. CI has not run remotely.

Auth SDK calls are server-only. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS; local HTTP uses non-Secure cookies. Provider/admin secrets never enter ordinary requests. The profile row belongs to the verified Auth subject, with SQL constraints/RLS and explicit field grants. Admission is enforced in the database, not hidden UI. Native controls avoid an unnecessary UI abstraction package; lucide supplies icons, not authorization or status.

No shared authenticated cache, localStorage token store, service worker, analytics/session replay, cloud adapter or authentication bypass exists. Public-facing abuse hardening, real-data privacy approval and deployment remain future gates.

## Document map

| Document | Purpose |
| --- | --- |
| [APP_REPORT.md](APP_REPORT.md) | Current progress, recommendations, open decisions, architecture deviations and M1 acceptance |
| [PRODUCT.md](PRODUCT.md) | Audience, scope, consent and success measures |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Implemented M1 boundaries, followed by future design |
| [DESIGN.md](DESIGN.md) | Visual direction, interaction/accessibility and performance targets |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Current M1 acceptance and later milestones |
| [DECISIONS.md](DECISIONS.md) | Actual choices, provisional defaults and dated official sources |
| [STATUS.md](STATUS.md) | Passed/blocked checks and exact next step |
| [AGENTS.md](AGENTS.md) | Durable working rules |

## M2B: local one-time reminders and mock delivery

Use synthetic data. No notification credentials, phone app or live AI key is required. Do not claim a mock receipt as phone delivery. Exact executed checks are in STATUS.

For this existing checkout, keep `.env.local` and `.local/users.json`:

```sh
pnpm db:start
pnpm db:migrate
pnpm worker:setup
```

Migration/setup succeeded in the user's normal terminal. They do not reset retained data. Setup creates the private pg-boss queue and ignored, generated mode-0600 `.local/worker.json`; do not paste that file or connection URL into chat. Do not put worker/admin credentials in web configuration.

In separate terminals:

```sh
pnpm dev
```

```sh
pnpm worker
```

The web app uses port 3000; the separate Node worker needs local Postgres/Supabase/Docker running and the host awake. Stopping the web app does not cancel confirmed reminders. Stopping the worker pauses processing; persisted future jobs/outbox survive. Restart `pnpm worker` to recover. Use Ctrl-C for graceful shutdown of your own worker. Do not run both `pnpm dev` and `pnpm start` on port 3000. Production-mode local web still uses `pnpm build` then `pnpm start`.

1. Sign in with a synthetic account. Open **Today**.
2. Enter a plain title, full local date/time and explicit IANA timezone (for example UTC or Asia/Kolkata), five seconds to 365 days ahead.
3. Choose **Review exact schedule**. Check title, full local time, timezone, UTC instant, DST choice, version and mock channel. This persists only a draft.
4. Choose **Confirm exact reminder**. The committed receipt says saved/scheduling pending; the worker enqueues it separately.
5. Close the website, keep worker/infrastructure running, then reopen Today and **Refresh reminders → Inspect attempts**. A successful mock attempt reads **Simulated acceptance**, never phone delivery.
6. Cancel unsent reminders in Today. If sending already started, cancellation cannot recall it. Unknown outcomes are preserved rather than automatically resent.

A clock gap requires a different valid time. A repeated local time requires an explicit earlier/later choice. A confirmed reminder remains at the reviewed instant if you travel/change preferences; the original one-time instant stays fixed unless you explicitly snooze it. Recurrence and occurrence-only snooze are described above; changing other one-time fields still requires cancellation and a new review.

Retained chat supports exactly `/remind YYYY-MM-DDTHH:mm[:ss] IANA/Zone [earlier|later] | title`. Choose a future full date, not the literal placeholders. It creates a review-only draft and operation receipt, then directs you to Today for confirmation. Arbitrary natural-language dates are unsupported. Temporary chat cannot save reminders; using the Today form separately creates persistent data.

Checks:

```sh
pnpm test:integration
pnpm test:worker
pnpm build
pnpm test:e2e
```

`test:worker` owns separate nonce-scoped queues and new synthetic accounts, launches real restricted worker processes and covers restart/cancellation/retries/unknown outcomes. It never resets the retained DB or changes retained users. `test:e2e` owns production listener 3100; do not start another listener there. CI defines worker setup/tests using an isolated runner DB; remote CI has **not run**. Manual screen-reader/real-phone checks remain **Deferred—not tested before private beta**. Fresh reconstruction still requires its unchanged **5 GiB** guard and remains unverified.

## M2C live setup — Pushover first

The latest instruction approves local OpenAI/Pushover integration and bounded spend; current implementation/evidence is in STATUS. Keys stay in ignored `.local/live.json` (mode 0600), never in `NEXT_PUBLIC`, chat, screenshots, traces or browser storage. Initial setup binds one **existing admitted account**; other synthetic users cannot inherit its phone or AI key. Use synthetic content for controlled tests until the retention/live checks are complete.

1. Install [Pushover for Android](https://pushover.net/clients/android) and sign into your Pushover account. Note the exact Android device name privately. Official [individual pricing](https://pushover.net/pricing), checked 2026-10-29: 30-day trial, then $4.99 one-time Android purchase if needed, separately authorized from the monthly project ceiling.
2. In the [Pushover dashboard](https://pushover.net/), obtain your user key and [register an application](https://pushover.net/apps/build) for its application token. Leave supplementary URLs unset; a computer's localhost URL will not open this app on the phone.
3. In a normal project terminal, run `pnpm db:migrate && pnpm live:configure pushover`. Choose the existing admitted account by local lookup. Enter keys and device name at the hidden prompts. Configuration validates the device without sending a notification; it prints configured/not-configured booleans only. Restart web/worker after changing configuration.
4. After configuration succeeds, run `pnpm live:pushover-test` **once**. It commits one generic test, processes it using the worker and reports provider acceptance separately from phone arrival. Repeating inspects the same test; it does not create another notification. Report only its sanitized summary and whether/approximately when the phone received it. No credential screenshot is needed.

Pushover uses normal priority and generic text only. Acceptance is not proof of phone display/read. Live sends are capped at ten starts per IST day and at most one per ten seconds; exceeding the development guard fails visibly. Timeout/ambiguous post-send outcomes are not blindly resent. Old mock reminders remain mock; a live reminder must explicitly select **Pushover** during review and confirm that channel. Changed recipient credentials invalidate old live bindings instead of redirecting queued work silently.

If setup reports `account_not_admitted_confirmed_and_profiled`, run `pnpm live:admit` locally. Register that same address in the app and verify it using [local Mailpit](http://127.0.0.1:54324); local development sends no Gmail message. Admission tooling does not create a session or bypass email verification. Then retry `pnpm live:configure pushover`.

After the generic test arrives, open Today → Inspect its attempt → record **Phone observed** separately. Create another near-future reminder, explicitly select Pushover, review exact time/zone/UTC/channel and confirm. Keep `pnpm worker` and Docker/Supabase running with the computer awake, close the website, and observe the phone. Reopen Today to inspect provider acceptance and record the approximate observation time separately. This scheduled observation is a prerequisite for AI evaluation; an API acceptance alone is insufficient.

### OpenAI project and budget setup (after phone checks)

Official guidance checked 2026-10-29: [production/key practices](https://developers.openai.com/api/docs/guides/production-best-practices), [spend controls](https://developers.openai.com/api/docs/guides/spend-limits), [pricing](https://developers.openai.com/api/docs/pricing), [data controls](https://developers.openai.com/api/docs/guides/your-data).

Create/select a dedicated project in the [API Platform](https://platform.openai.com/). API billing is separate from the application and any ChatGPT subscription. Review Billing/credits and the actual minimum/check-out amount shown for your account. No initial funding minimum was established by the fetched public documentation, so none is promised here. Keep any funding **within the ₹1,000 AI allocation including tax/FX**; if a required minimum exceeds that scope, stop and report only its amount. Do not enable automatic recharge. No purchase is made by setup scripts.

In Project settings → Limits → Spend, configure an additional monthly **$6 hard limit** where available and a **$5 alert**. Current official documentation supports enforced limits but says enforcement can lag; an alert alone does not cap calls. Our conservative accounting conversion is **₹150/USD**, adopted 2026-10-29, including substantial FX/tax/fee headroom; it is not a spot-rate quote or a guarantee of your invoice. The dated FBIL reference visible in the official site's search snapshot was ₹96.2856/USD for 2026-10-01; direct page extraction was unavailable. The larger accounting conversion is a documented safety assumption, not a verified 2026-10-29 market rate. Do not silently change it or the approved rupee caps.

Create a project-scoped API key in the project's API Keys settings, with an expiry and only required model/Responses access. Review organization/project **Data controls** and keep training/evaluation data-sharing opt-ins disabled. Do not use an organization admin key. Keep the key private; run `pnpm live:configure openai` and enter it only at the hidden prompt. Setup stores it locally and leaves ordinary live AI disabled until the bounded evaluation chooses a model. `pnpm live:status` prints booleans only.

The application reserves conservative cost before each call, serializes budget decisions, and reconciles valid final token usage; cancelled/uncertain calls retain their full reservation. Calendar months use Asia/Kolkata. ₹200 initial evaluation is a lifetime sublimit within ₹1,000/month AI; ₹500 contingency cannot extend AI. Reasoning effort is low for both candidates; its tokens share the 1,024-token total output limit. Context/tool calls are bounded, SDK retries are disabled, and there is no automatic provider/model failover. Prompt caching uses explicit-only mode with no breakpoints; accounting still recognizes read/write/reasoning categories if reported. Published rates require review before expiry. `store:false` does not imply zero provider retention.

After the phone checks and private OpenAI configuration, run `pnpm live:evaluate`. It signs into the bound local account at hidden prompts, checks phone observations and content-minimizing database logging, verifies account access to both candidates and runs the documented 40 synthetic cases × two repetitions × two models. It resumes by durable request IDs, stops after three consecutive operational failures, and never expands the allowance. No prompts/outputs are written to the private evaluation report; only metrics, numeric usage and identifiers. The least costly candidate meeting the safety/conformance gates is enabled, otherwise live AI remains disabled. This deterministic rubric is a limited evaluation, not a general quality certificate. Restart the web process after selection.

In Assistant, explicitly inspect the provider selector. OpenAI context is bounded to six recent source-filtered user turns and five relevant active approved memories, not the entire history/database. A natural reminder request creates only a draft for exact Today review. Memory proposals require exact separate approval in Memory. App operation receipts establish actions; model text does not. Temporary mode disables persistent actions and retains no content in the application, while provider processing/retention remains separate.

Retention: conversations expire 30 days after creation and become inaccessible before bounded cleanup; the running worker purges expired rows at maintenance intervals, and owned cleanup also runs before live requests. Pending proposals expire after seven days; approved memory remains until correction/deletion, including when its source conversation expires. Terminal reminder content/attempt metadata is eligible after 30 days, except the fixed generic channel test retained for readiness. Content-free accounting remains for budget integrity. Logical deletion does not erase PostgreSQL old pages/WAL or unverified backups. Current audited logging: DDL only, duration/sample logging off, error-parameter length zero; operator SQL/logs are within the trust boundary. No backup-expiry or restore-erasure guarantee has been verified.

If the generic Pushover test reports SQLSTATE 42501, run `pnpm live:pushover-test --check` first. This uses an enforced read-only transaction and prints operator/helper permission metadata, eligibility and binding booleans only; no keys, reminder content, jobs or sends. Share its short JSON result. Normal test errors now identify the fixed operation phase. Do not disable RLS, use an admin client in web requests, reset the DB or blindly rerun sends to repair a permission failure.

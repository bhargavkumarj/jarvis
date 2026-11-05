# Personal-version implementation candidate — consolidated verification ledger

Updated **2026-11-01 IST**. **Personal-version implementation candidate prepared; runtime acceptance pending.** This is the bounded finishing pass, not acceptance of M1/full M2, public launch or the long-term roadmap. No database/worker/browser/HTTPS/live/device verification completed in the finishing pass. The later read-only runtime-preflight attempt below is separately recorded. Remote CI **not run**. Manual screen-reader/real-phone checks remain **Deferred—not tested**.

## Computer control v1 (Mac companion, Chrome bridge, pairing, five actions) — 2026-11-05, 03:35 IST (2026-11-04 22:05 UTC)

**Authorized by the user's 2026-11-05 brief** (JARVIS_Mac_Computer_Control_Prompt.md): implement and verify what is feasible, without stopping at a plan. Architecture, trust boundaries and protocol: [COMPUTER_CONTROL.md](COMPUTER_CONTROL.md); build/install/pair/revoke/uninstall: [MAC_COMPANION_SETUP.md](MAC_COMPANION_SETUP.md). **Not physically verified on any Mac. Not milestone acceptance.** Existing M1/M2/personal-version acceptance is unchanged by this work.

**Environment actually used:** disposable Linux x86_64 cloud container, no real user data (the user designated it a synthetic-only runtime). Node 24.22.1 (`/opt/node24`), pnpm 10.34.9, `pnpm install --frozen-lockfile`; Docker 29.9.2 started here; Supabase CLI 2.122.0 with images from `mirror.gcr.io` (`SUPABASE_INTERNAL_IMAGE_REGISTRY=mirror.gcr.io`; `kong`, `mailpit`, `postgrest` pulled from their upstream publishers and retagged because Supabase's ECR copies were unreachable); Swift 6.1.2 (`mirror.gcr.io/library/swift:6.1.2-noble`); Chrome for Testing 153.0.8010.12. **No macOS, Xcode, Keychain, AppKit, Core Audio or Shortcuts were available.** All live providers stayed disabled (`JARVIS_MOCK_ONLY=1`, no `.local/live.json`): no OpenAI, Pushover or paid call.

| Category | What |
| --- | --- |
| Implemented | Shared TS protocol + fixtures; additive migration `202611050001_computer_control.sql` (settings, devices, credentials, pairings, commands, tickets, 27 RPCs); user and device route handlers; deterministic alias interpreter (no AI budget); Settings → Computer; Assistant action card with Stop and read-aloud of the final receipt; export categories and 30-day history; MV3 bridge; Swift portable core and macOS executable; install/uninstall scripts; docs. |
| Compiled | TypeScript (typecheck, lint 0 warnings, production build); extension via `tsc`; Swift **portable core + E2E harness on Linux** (0 warnings). **The macOS executable target (`MacAdapters.swift`, `CompanionMain.swift`) was never compiled.** |
| Simulated (test doubles) | Swift engine/router with fake backend/confirmer/executor; extension logic with fake Chrome ports; a Node test-double native host in real Chrome; a record-only Swift executor in the cross-language E2E. |
| Integration-tested (real services) | Real Postgres/RLS/RPCs with two synthetic users; real Next device routes ⇄ real Swift HTTP client/engine; real Chrome extension loading, externally_connectable and native-messaging framing. |
| Physically verified on a Mac | **Nothing.** App launch, website/folder opening, volume read-back, Shortcuts, Keychain, NSAlert/NSOpenPanel, menu bar, signing and permissions are unverified. |

| Command (this session) | Result |
| --- | --- |
| `pnpm lint` (`eslint . --max-warnings=0`) | passed, 0 warnings |
| `tsc --noEmit -p .` and `pnpm build` (mock-only) | passed; 5 new `/api/v1/computer/*` routes built |
| `vitest run --config vitest.config.ts` | **501 passed / 0 failed, 39 files** (373 before + 128 new computer-control cases). One existing mock in `tests/unit/privacy-endpoint.test.ts` was extended to answer the new `computer_export_v1` RPC and gained stricter assertions; no assertion was removed. |
| `pnpm companion:test` (Swift XCTest in container) | **38 passed / 0 failed** (fixture agreement incl. digests and NIST SHA-256, framing bounds, policy, engine and router) |
| `pnpm bridge:check` (real Chrome for Testing 153, test-double host) | **10/10**: extension ID from committed key, allowed origin reaches host, progress/response routing, extra fields and spoofed origin rejected, other port refused, iframe refused, argv[1] = caller, host receives only rebuilt frames |
| `pnpm db:start` (fresh) | **FAILED at `202610310004_privacy_center.sql`, SQLSTATE 42601** — see defect below. Migrations 001–003 of 2026-10-31 and all earlier files applied cleanly. |
| New migration via `supabase migration up --local` | applied cleanly on top of the scratch chain (below); SQL digest equals TS/Swift fixtures (4/4) |
| `vitest … tests/integration/computer-control.test.ts` | **16/16**, six consecutive passes after a deadlock fix (owner isolation, device scope, one-use/concurrent claim, expiry, tampering, one-active-per-Mac, revocation, sign-out at redeem and between steps, Stop, pending account deletion, disable, receipts, export, clear) |
| `node scripts/audit.mjs` | 18 migration versions; **27/27 computer functions match latest source**; anon EXECUTE = 7 device RPCs only; authenticated = 8 user RPCs; service_role none |
| `pnpm companion:e2e` (Swift ⇄ `next start` ⇄ DB) | **7/7**: pair, alias-only catalogue sync, redeem + per-step progress + validated result, dispatched-only evidence stored, local replay refusal, Stop during confirmation, refusal after revocation |
| full `vitest.integration.config.ts` (after `pnpm worker:setup`) | **118 passed / 7 failed / 125**; the 7 are pre-existing, below |
| `vitest.worker.config.ts` | **14/14** |
| `playwright test` (46 = 42 existing + 4 new) | **28 passed / 18 failed**. The 4 new computer cases pass (desktop+mobile, axe WCAG 2.2 AA on the section, 320 px no horizontal scroll). The 18 failures are **identical, with identical error output, on unmodified HEAD `10ccd3c`** run in a separate worktree against the same database/browser — pre-existing, not regressions. |
| `node scripts/https-check.mjs` | **9/9**, cleanup confirmed, no trust-store change |

**Critical pre-existing defect — `202610310004_privacy_center.sql` cannot be applied (fresh or incremental).** Three independent errors, found by applying it with the real CLI and then `psql` on a scratch copy:
1. SQLSTATE 42601 *syntax error at end of input* in `privacy_command_v1` (file line 184): an `IF … is distinct from case … then … end then` — PL/pgSQL ends the IF condition at the CASE's first `THEN`. Proposed fix: parenthesise the CASE.
2. *permission denied for function `m2c_ai_policy_before_privacy_v1`*: the final ACL loop runs as `postgres`, which has only non-inheriting membership of `jarvis_auth_guard`, so it cannot revoke on guard-owned functions. Proposed fix: run each revoke/grant as the function owner (`set local role <owner>`).
3. *permission denied for function `private.privacy_insert_v1`* when creating the `privacy_insert`/`privacy_retire` triggers after PUBLIC EXECUTE was revoked. Proposed fix: grant EXECUTE on those two trigger functions to the table owner before creating the triggers.
**The repository file was NOT edited** (unrelated milestone; approval required). For verification only, a scratch copy with exactly these three changes was applied with `psql`, and versions 004/005 were then recorded by hand **in the disposable scratch database only** so the CLI could apply the new migration. Every integration/browser/HTTPS result above therefore ran on a schema containing that patched 004; `public.privacy_command_v1` correspondingly differs from source in the audit. 005 applied unmodified.

**Pre-existing integration failures (suites never executed before; unrelated to this change):** `voice.test.ts` ×3 — test expects `monthly_ai_cap_paise`, which 004's `m2c_ai_budget_v1` no longer returns; and 004's separate text-AI consent gate now refuses fixture user B with 42501 before the budget/validation checks the test expects. `privacy.test.ts` ×4 — three tests exceed the existing 30-text-turns-per-minute limit (SQLSTATE 54000) because the file reuses one fixture account; the retention test finds an expired conversation not removed by `m2c_cleanup_v1`. Not modified here.

**Defects found and fixed in the new work during verification:** concurrent redeems deadlocked (40P01, safe but wrong) → all device and user mutations for an owner now serialize on the existing per-owner advisory lock after the global gate; expired tickets were reported as "unauthorized" → truthful `expired`/`not_authorized`; Swift memberwise initialisers used across modules were internal (would have broken the macOS build) → public; Swift config replacement failed on Linux bind mounts → POSIX `rename(2)`; Swift data-race warning in the HTTP client → locked hand-off; an extra page-level `role="status"` in Settings made an existing selector ambiguous → plain `aria-live`.

**Discrepancies with the brief:** no “cinematic dark” redesign exists in this checkout (light paper/teal theme; extended, not replaced); the unit baseline was 373, not 371; budget decisions (₹1,000 AI incl. ₹200 evaluation, ₹500 contingency) are unchanged and computer control uses no AI budget.

**Not run / unverified:** macOS compilation and every native adapter; real Mac/Chrome pairing and actions; Shortcuts CLI semantics (support.apple.com unreachable; `run <name>` and `list --show-identifiers` assumed); Keychain prompts after re-signing; menu-bar lifetime; screen-reader and physical-device checks; retained-database (incremental) path on the user's laptop; `pnpm db:types` (generated types not regenerated; manual contract marked provisional); remote CI. The Playwright run used a scratch `PLAYWRIGHT_BROWSERS_PATH` mapping revision 1248 → installed 1243 (one minor revision older than the pinned package expects).

**Follow-up run, 2026-11-05 08:43 UTC:** the app was run (`next start`, mock-only, port 3000) and driven in Chrome for Testing 153 with the real bridge extension and, as native host, a static Linux build of the companion core (`CompanionE2E native-host`: real framing/router/engine/HTTP client; approval simulated after 1.5 s; record-only executor whose receipts say nothing ran on a Mac). Observed: extension installed / companion connected; consent; pairing (masked account shown); two-step proposal → waiting for approval → receipt with “sent to macOS; end result not observed”; clarifications for relative volume, ambiguous and unapproved targets; ordinary chat unchanged; history. Fixed two CSS defects seen there (plan steps lost their numbers and the disclosure its bullets under Tailwind's list reset; Disconnect button crowded its row); `computer.spec.ts` 4/4 afterwards. Not a Mac run.

**Smallest next user action:** on the Mac, after the 004 defect is fixed and migrations are applied, run `cd apps/jarvis-mac-companion && swift build` to confirm the macOS target compiles, then follow MAC_COMPANION_SETUP.md steps 1–4 and the acceptance sequence.

## Provider tool-only task/recurrence completion fix — 2026-11-05, 01:45 IST

**Defect (PROJECT_STATE_REPORT §7):** `src/lib/ai/provider.ts` accepted a textless completed response only when the validated plan held memory, a one-time reminder or a clarification. A valid tool-only `plan.task` or `plan.recurrence` proposal, both allowed by `contracts.ts` and handled by `orchestrate.ts`, was rejected as `incomplete` after usage had already been settled.

**Tests first:** two synthetic SDK-boundary cases were added to `tests/unit/openai-sdk.test.ts`. They send a single `propose_actions_v1` call carrying only a task (create “Buy stamps”) or only a daily recurrence (explicit start date 2026-11-10), with no text deltas. Before the fix both failed with `kind:'incomplete'` (focused run: 2 failed, 16 passed), reproducing the defect offline. Each now expects `usage → actions → success`, the validated plan, and `['dispatch','settle']` accounting.

**Fix:** the textless-completion guard now also accepts `plan.task` and `plan.recurrence`. No other change: same contract validation (`validateActions` still enforces explicit task/recurring intent, the start-date clarification, and exclusivity rules), same budget/settlement, orchestration, permissions and provider configuration. The existing “empty completed result is incomplete” test still passes, so empty output still fails.

**Executed (cloud container, Node 24.22.1 from the preinstalled `/opt/node24`, pnpm 10.34.9, `pnpm install --frozen-lockfile`; this is not the user's machine, which has Node 24.14.1):** `JARVIS_MOCK_ONLY=1 pnpm lint` passed with zero warnings; `pnpm typecheck` passed; `pnpm test` **373 passed, 0 failed/skipped, 34 files, ~3.8s** (371 + two new cases). `next typegen` rewrote `next-env.d.ts` route-type paths as a generated side effect; that change was restored, not committed.

**Not executed:** production build, the 109 DB-integration, 14 worker-process, 42 browser and nine HTTPS checks, and any live OpenAI request, so a real provider-emitted tool-only task/series response and its end-to-end review in Today/chat are still unverified. No Docker, database, migration, credential or private-configuration access occurred. The runtime blockers below are unchanged.

## Latest Auth/runtime failure evidence and focused repair — 2026-11-01, 12:55 IST

**User-reported execution:** `local:audit` returns blocked at `local_runtime_status`, SQLSTATE null/category unavailable; `local:diagnose` again reports the existing 10-second Supabase status timeout. Website logs repeatedly show `AuthRetryableFetchError`, `fetch failed`, status **0**, no provider code. This establishes a transport/unreachable-service failure for those Auth requests, not a confirmed invalid password, profile/RLS rejection or executed migration failure. Docker engine health versus local Supabase/CLI responsiveness remains unresolved: no `docker info` result has been supplied. The `.env.local` file privately validates as expected loopback API port 54321/origin port 3000; this does not establish a running process's loaded environment or service health.

**Small application repair:** password sign-in now maps Auth transport/status-0/retryable-fetch and 5xx errors to a fixed **503 local-service-unavailable** response, rather than misleading 401 credential advice. Email and verification error classifiers recognize the same transport boundary; rate limiting and account-opaque credential/confirmation rejection stay separate. No raw provider messages/account details are returned. Existing Origin/session/profile/RLS/privilege checks and credentials remain unchanged. No retry loop, fallback, circuit-breaker subsystem or permission change was introduced. This messaging correction does not restore the unavailable backend or prove login success.

**Executed:** 18 targeted Auth tests passed; full lint/typecheck passed; full mock-only unit suite **371 passed, 0 failed/skipped, 34 files, 12:55:55 IST, 1.22s** (362 + nine new classifier/HTTP gate cases). Mock-only production build passed, compile 2.8s/type compilation 2.8s. Disk probe ~3.7 GiB before build; no installation/deletion and 5 GiB reconstruction guard remains unchanged. No Docker/DB connection retry, container restart, migration, password change, account deletion, notification or paid call executed by the agent. All 109 DB/14 process/42 browser/nine HTTPS groups and live/device/manual acceptance remain pending.

**Next operational action for the user:** stop their foreground web and normal worker/finalizer processes with Ctrl+C. Open Docker Desktop; if its engine is stuck starting/unresponsive, use Troubleshoot → **Restart Docker Desktop**, not Clean/Purge data or factory reset. This is a user action, not performed automatically. Once the engine reports running, inspect existing target containers read-only with `docker ps -a --filter name=jarvis-foundation --format '{{.Names}}: {{.Status}}'`; share names/status only, or interrupt after 10 seconds if it hangs. Do not repeatedly run Supabase status/audit until engine responsiveness is established. Do not create/reset a database or assume pending migrations safe without retained-data protection. Official Docker recovery menu reviewed 2026-11-01: https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/ . No diagnostic upload requested or performed.

## Latest diagnostic follow-up — 2026-11-01, 12:17 IST

The user pasted only the `pnpm local:diagnose` startup banner; no account/connection result or elapsed time was supplied. This is not evidence of a successful diagnostic or a demonstrated Auth root cause. Source inspection found unbounded synchronous context/status subprocesses and an unbounded Auth diagnostic fetch, which could leave this command waiting without identifying its phase.

**Focused tooling repair:** read-only Docker context inspection now has a 5-second limit, local Supabase status 10 seconds (only their owned read-only helper processes can be killed), Auth diagnostic fetch 5 seconds with upstream cancellation preserved. Progress messages identify runtime-status, Auth and Mailpit stages without values. Missing users in the returned Auth page are labelled unconfirmed rather than falsely absent. No new timeout was imposed on mutating migration/start/reset execution. No authentication handler, credentials, grant, schema, provider or ordinary request path was changed; no failed assertion was weakened.

**Actually executed:** focused 36 tests passed (three files); final `JARVIS_MOCK_ONLY=1 pnpm lint` and `pnpm typecheck` passed; final `JARVIS_MOCK_ONLY=1 pnpm test`: **362 passed, 0 failed/skipped, 33 files; 12:17:40 IST, 1.29s**. Five new mocked subprocess/HTTP timeout/cancellation cases explain the increase from 357. `node --check scripts/local-runtime.mjs` and `scripts/local.mjs` passed. No Docker/DB request was repeated in this repair, no credentials printed or account changed. Web production build was not rerun for this CLI-only change; previous build evidence remains historical. DB/process/browser/HTTPS/live/device acceptance is still pending.

**Subsequent user-terminal evidence:** the updated `pnpm local:diagnose` printed the runtime phase and reported **“Local Supabase status timed out after 10 seconds”**, exit 1. Docker context inspection passed; no account query or SQL migration was reached. The runtime-status stall is now observed in the normal terminal, but Docker engine health versus CLI/service responsiveness remains unresolved. This is not evidence of an incorrect password or SQL authorization defect. No repeat of the same status check is needed yet.

**Next diagnostic:** in that normal terminal run only `docker info --format '{{.ServerVersion}}'`. Share the version or first error line; if it does not return within 10 seconds, Ctrl+C and report that it hung. This read-only engine probe is distinct from Supabase status; do not start/reset/prune Docker or change credentials based on the current evidence. Account state, target/migration audit and all runtime suites remain pending.

## Runtime verification attempt — 2026-11-01, 11:51–11:53 IST

**Preflight blocked before SQL execution; no application repair supported.** This is the existing `/Users/bhargavkumarjayanthi/projects/jarvis` checkout, not a fresh extraction: `.git`, installed dependencies, an existing build, private local configuration and historical transfer archives are present. Source remains untracked/no commits; an `origin` remote name now exists (URL not printed, no fetch/push/remote change). Existing user work, including PROJECT_STATE_REPORT.md, was preserved. No install/copy/reset/migration, Docker startup/prune, provider call or account deletion occurred.

| Command / read-only inspection actually executed | Observed result and implication |
| --- | --- |
| `pwd`, `git status --short`, `git log -1 --format=...`, `git diff --stat`, `git remote` | Same working directory; all source untracked; `main` has no commits; `origin` present. Empty tracked diff does not mean untracked work is absent. |
| `node --version`, `pnpm --version`; installed package manifests vs package.json | **24.14.1 / 10.34.9**; all **27** direct dependency/dev-dependency exact pins match installed versions; Supabase executable file present. No reinstall performed. This is not a clean frozen-install run. |
| `df -h . /private/tmp`; read-only `statfsSync(tmpdir())` | `df` first showed ~**2.0 GiB**, later statfs ~**3.85 GiB** on the shared Data volume. Both below existing **5 GiB** reconstruction minimum; host free space fluctuates. Guard preserved; reconstruction command deliberately not started. No claim that this guard applies to every source check. |
| Private in-memory config validation | `.env.local` and all three required variable names present; local URL/publishable-key validation succeeds. Private users/worker/live files present with no group/world permissions; evaluation file absent. Values were not printed. Matching credentials/configuration to an actual database remains unverified. |
| Read-only Docker context inspection, then bounded `docker info --format ...` | Context inspection succeeded and endpoint is local. Daemon inspection failed with **execution permission** restriction. Raw output/endpoint values suppressed. No Docker start or repeated retry. Actual daemon/service health is **unknown**, not established stopped. |
| `lsof` for 3000/3100/3443/54321/54322/54324; one restricted-role read-only target probe | No listeners visible to this inspection. Validated worker target is loopback:54322/database postgres/restricted principal. Connection failed **EPERM/execution_permission, SQLSTATE null**, before a result. Actual server identity, applied migrations, retained row counts, worker activity and database emptiness remain **unknown**; not a SQL privilege or application failure. No credential guessing/admin connection was attempted. |
| Browser/TLS dependency probes | Installed Chromium executable exists; no browser launch. A bounded OpenSSL version probe did not establish availability; cause unresolved, no certificate generated. Recheck TLS prerequisite in the eventual permitted environment; do not infer HTTPS failure from this probe. |
| `JARVIS_MOCK_ONLY=1 pnpm lint` | **Passed**, zero warnings. |
| `JARVIS_MOCK_ONLY=1 pnpm typecheck` | **Passed**, route generation and `tsc --noEmit`; generated database schema types were not refreshed. |
| `JARVIS_MOCK_ONLY=1 pnpm test` | **357 passed, 0 failed/skipped; 32 files; 11:53:02 IST, 1.37s.** Current unit/mocked execution only; no DB/provider evidence. |
| `node --check` on local-runtime, reconstruct, audit, worker-setup, privacy-finalizer and https-check scripts | **Passed** syntax checks. Inspected local tooling, fixtures, worker harness, Playwright/HTTPS and pending operator repair before considering runtime execution. No script's database mutations were executed. |

**Safety finding from source inspection:** `db:reconstruct` alone creates random project/ports 55320–55324, fingerprints the retained target read-only, then removes only that disposable stack. It does **not** keep that environment running for full suites. `localStatus()` and `readWorkerConfig()` instead bind full integration/worker/browser/HTTPS fixtures to **jarvis-foundation at 54321/54322**. Random test account/queue names isolate fixtures, not the database itself; some maintenance/catalog fixtures can affect shared state. Do not treat these commands as disposable-database tests on an uninspected retained target. The handoff now requires a separate synthetic-only runtime/engine (or documented protected retained-target procedure) before those suites. No harness/authorization assertion was weakened or mock substituted.

**Still not executed:** fresh reconstruction/application of all **17** migration files; deployed grants/RLS/functions/RPC audit; real database target/retained-data inspection; `db:types`; **109** integration, **14** worker-process, **42** browser cases and **nine** HTTPS groups. These are blocked/unexecuted, not skipped or passing. The production build remains historical 11:03 evidence; it was not rerun because no application code changed in this attempt. No backup, incremental repair 010, later migration, retained fingerprint comparison, finalizer runtime, live AI/phone delivery, physical voice or manual accessibility acceptance is established. Remote CI not run.

**One next action:** run `pnpm local:audit` in the normal permitted project terminal and share only its sanitized result. This is read-only; do not migrate/reset or send notifications yet. It is needed to establish actual local target/history/privileges before choosing a protected retained or isolated synthetic path. The disk guard remains a separate blocker for reconstruction. Candidate implementation remains prepared; runtime and earlier milestone acceptance remain pending.

### Subsequent user-reported sign-in failure

The user reports the website message “Unable to sign in. Check your details and email verification, then try again.” Source inspection confirms this exact response is emitted by `auth.signInWithPassword` failure **before the profile query**; it does not demonstrate a profile/RLS/SQL migration failure. Missing/incorrect credentials, unconfirmed account, stale runtime configuration or unavailable Auth remain possibilities, not established causes. The private local file has the expected synthetic Alex email and a nonempty password; its values were not printed and this is not successful authentication evidence. No credential reset/account mutation or repeated blocked Docker/database attempt occurred. Next minimal diagnostic is the existing read-only `pnpm local:diagnose` in the normal permitted terminal; account confirmation and Mailpit results remain pending. Do not paste passwords/codes/private file contents or reset retained data.

## Personal-version completion checklist and verification ledger

“Implemented” below means inspected source exists and its feasible checks passed. It does not establish deployed schema, real authorization/durability, visual accessibility, provider quality or phone arrival. **This table is the consolidated current ledger**; older dated sections below are historical evidence, not new runs.

| Capability | Screen → API → persistence | Implementation / evidence obtained | Remaining test | Dependency / blocker |
| --- | --- | --- | --- | --- |
| Sign-in, recovery, preferences, short setup | Auth pages; Settings; optional `/welcome` → `auth/[action]`, `preferences`, `onboarding` → Auth + owned `profiles` | Implemented. Existing session/admission/cookie/Origin path retained. Three-field name/style/zone setup, skip and later revisit; single ordinary owned update, no automatic consent. Request mocks and initial markup pass. | Actual new-account/skip, A/B column grants, recovery, RSC refresh, cookies and keyboard focus | Full ordered migrations including new 005; deferred Auth/DB/browser/HTTPS |
| Conversations and temporary mode | Assistant → conversations/messages/turns/cancel → conversations/messages; temporary content in page memory | Implemented. Bounded context, provider disclosure, streaming/stop/retry and request IDs retained. Generation fencing prevents late selections/stream results; sign-out/privacy stops work and voice; confirmed account changes reload other tabs. Suggestions only draft text. Source/mocked regressions pass. | Real streaming/cancellation/retry, A/B switching/back-cache and temporary-content absence | DB/browser/live; browser without BroadcastChannel has no cross-tab UI invalidation guarantee (server still authorizes each request) |
| Memory review and management | Memory → memories/messages → proposals/memories, source FKs | Implemented. Exact approval/correction/conflict review; deletion suppression, active-only retrieval. Missing/expired sources are labelled unavailable. Metadata dates explicitly UTC. Source/mocked tests pass. | Approval/recall across conversations, rejected/deleted exclusion and stale approvals; manual announcements | DB/browser/live model evidence |
| Tasks and linked reminders | Today; typed/voice chat review → tasks/privacy_action → tasks/task_operations, same-owner one-time reminder link | Implemented. Task deadlines do not notify; delivery does not complete tasks. Exact task/schedule reviews, stale versions, idempotency and atomic unsent cancellation retained. Existing unit/mocked regressions pass. | A/B links, complete/delete versus active worker, reopen without reschedule, committed receipts | DB/real worker/browser |
| One-time/recurring reminders and snooze | Today → reminders/series/snooze/operations/observe → series, occurrences, operation receipts, private outbox, pg-boss, attempts | Implemented. Date/zone/UTC/channel review, preview, fixed-zone DST policy, pause/skip/cancel/snooze and honest acceptance/unknown states retained. Synchronous client locks avoid double submits. Today shares its occurrence query with Series rather than fetching it twice. Unit/mock scheduling/routing tests pass. | Incremental SQL/FKs/locks, restart/outage/concurrency, cancellation races, clock agreement and observed phone flow | DB/worker/browser/Pushover; infrastructure/awake host needed later |
| Voice and optional read-aloud | Assistant → voice settings/transcriptions; browser local synthesis → numeric consent/usage only, transient audio/transcript | Implemented. Explicit start/stop/review-before-Send, cleanup/stale-result limits and local-voice-only output preserved. Sign-out/privacy interrupts voice. Existing capture/SDK HTTP/speech mocks pass. | Real codecs, permissions/mic release, localService behavior, noisy/accent/multilingual input and device accessibility | DB/browser/physical devices; no compatibility claim from mocks |
| Providers, separate consent and budget | Settings/Privacy Center; Assistant/Today selection → integrations/usage/voice/privacy → private personal binding, owned consents, usage ledger | Implemented. Status separates missing config, configured-disabled, missing consent and effective readiness. No keys returned; ownership/missing-schema HTTP fixtures pass. Text AI off does not cancel reminders. Notification-send permission is not disconnect/cancel/proactive messaging. ₹1,000 AI/month, included ₹200 eval, separate ₹500 unchanged. | Actual durable concurrent reservations, account availability/evaluation, binding and consent between reserve/dispatch; provider acceptance vs phone arrival | DB/live; no model selection/live acceptance established |
| Export, retention and deletion | Settings Privacy Center; private deletion receipt → privacy/export/reauth/deletion → owned preferences/private jobs/events/request tombstones/cost carry; restricted worker + isolated finalizer | Implemented. Recent password, bounded no-store JSON, exact scopes, immediate context/source fences and durable cleanup/resume. New setup marker included in safe export projection. Unit/mocked failure/filter/partial-recovery cases pass. | Actual grants/keyset ownership/cleanup/queue races/finalizer recovery, export/browser/HTTPS and isolated synthetic Auth erasure | Full privacy migration/runtime; downloaded/provider/log/backup copies remain separate |

## Changes and actual execution in this finishing pass

- Added optional `/welcome` using existing preferences; new **`202610310005_personal_finish.sql`** adds only an owner-controlled completion timestamp and its column UPDATE grant. Existing profiles are backfilled so setup is not forced; new accounts remain unset until save/skip. Existing RLS/live-session/admission/deleting-account gates stay intact. No new privileged function/role/dependency.
- Removed obsolete fixed-retention/mock-only copy, standardized workspace/page titles and explicit metadata dates, clarified unavailable provenance, added first-message suggestions without creating data, responsive wrapping and focus handling. This is source/markup review, **not visual/a11y runtime evidence**.
- Session/privacy stop events, stale-view fencing and synchronous submit locks preserve late-result/duplicate boundaries. AI/speech errors do not disable manual task/reminder APIs. No fallback provider or mock→live record conversion. Prepared Settings/HTTPS status assertions now scope to the preferences form; no assertion or axe rule was weakened.
- Static ordered review: **17 migration files, 86 final source function signatures, 33 public functions**. All provisional public RPC argument names/defaults and literal application calls match ordered SQL, including renamed private delegates and nested `default now()`. Inspected same-owner FKs/delete order, fixed paths/revokes, worker capabilities and pending operator-only repair. This limited source scanner is not PostgreSQL compilation, deployed ACL evidence or a complete SQL parser. Generated types were **not fabricated/regenerated**; the manually maintained contract explicitly labels pending additions provisional.

| Executed — managed macOS source environment, 2026-11-01 IST | Observed result |
| --- | --- |
| `pnpm lint` | Passed, zero warnings |
| `pnpm typecheck` | Passed; route/type generation and `tsc --noEmit`, including prepared runtime suites |
| `pnpm test` | **357 passed, 0 failed/skipped, 32 files; 11:02:25 IST, 863 ms.** Prior privacy source baseline 334 + **23** new cases: product state/generation/markup/session 7, setup HTTP 8, provider status HTTP 5, ordered contract checks 3. Unit/mocks do not prove live reliability. |
| `JARVIS_MOCK_ONLY=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm build` | Passed: optimized production build and TypeScript; `/welcome` and `/api/v1/onboarding` included. Compile stage 2.9s is a build measurement, not application latency. |
| Source tooling / packaging | Migration helper and HTTPS harness syntax checked. Ignore/manifest/content audit and source archive refreshed; old archives retained. No secrets/data/exports/audio/caches included. |
| Environment / source control | Node 24.14.1, pnpm 10.34.9; ~4.1 GiB before build. No install/pin changes or storage deletion. Existing 5 GiB reconstruction guard preserved. Git initialized, source untracked, no commit/remote/publication. |

**Written—not executed in this pass:** two new ordinary-identity DB cases and four browser cases. Expected full suites: **109 DB / 14 worker-process / 42 HTTP browser / nine existing HTTPS groups**. Older pending suites and history are preserved below; no deliberate skip/setup failure is called a pass. The old user-terminal 52 DB / ten worker / twenty browser / nine HTTPS results are historical 2026-10-29 evidence for earlier code/schema.

## Remaining acceptance and precise limits

The pending permission repair **202610290010** still never reached SQL on the old laptop. Recurrence 202610310001 → voice 002 → tasks 003 → privacy 004 → setup 005 remain unverified/applied status must be inspected on the new machine. No earlier migration was edited. Actual owners/grants/search paths/removed temporary CREATE/FKs and full incremental path must be audited, then fresh disposable reconstruction must preserve retained fingerprints. No retained reset/prune is a substitute.

Remaining: all current DB/process/browser/HTTPS suites; real AI evaluation/model selection and complete closed-site phone flow; finalizer partial-failure/restart proof; manual/device checks; backup/restore/deletion-replay rehearsal, operational log/copy expiry guarantees and clean new-machine frozen install. No automatic backup/restore protection, provider key/account revocation, physical-erasure guarantee, phone receipt inference, E2EE or zero provider retention is claimed. These are visible runtime/operational gates, not hidden implementation acceptance.

No daily briefings, proactive check-ins, public beta, billing, smart-home control or advanced realtime voice was implemented. No broader roadmap expansion. [MACHINE_HANDOFF](MACHINE_HANDOFF.md) contains exact fresh/retained setup, first smoke, full deferred sequence and recovery. Source archive: `.local/transfer/jarvis-source-20261101-personal-candidate.tar.gz`. Smallest next action on the other machine: extract into an empty directory and run `pnpm install --frozen-lockfile`; no runtime action is requested on this laptop.


---

# Project status — Privacy Center source implementation

Updated **2026-10-31 IST**. Privacy Center is **implemented with runtime acceptance pending**. No Docker/database/browser/worker-process/HTTPS/live-service/manual-device test, paid call, deployment or real-data deletion ran here. Earlier M1/M2/M2C, recurrence, voice and task migration/verification gaps remain open. Remote CI **not run**; screen-reader/real-phone checks **Deferred—not tested**.

## Implemented and verified here

- Settings now has distinct text AI, voice-transcription and notification controls; server consent gates block new dispatch. Text AI disablement does not cancel confirmed reminders. User-selectable 7/30/90/365-day conversation retention (30 default) warns before shortening, never revives expired history and preserves approved memories until deletion.
- Authenticated streamed JSON export: schema/time metadata, safe own profile/preferences/consents, unexpired history, memory/provenance, tasks/schedules/delivery and numerical usage. Explicit exclusions, no public URL/email/server file, bounded pages/bytes/time/concurrency, recent-password requirement, no-store responses and honest non-snapshot/incomplete behavior.
- Precise bulk history/memory/task-reminder erasure and explicit account phrase; existing item deletion remains. “Forget this” clarifies saved memory versus source conversation without executing deletion or claiming inference is impossible. Source links are unavailable after expiry/deletion. Epoch/source checks, content-free retired request IDs and queue authority fences prevent stale known operations from restoring erased data.
- Resumable account workflow: durable access/provider disablement → bounded content/queue cleanup → isolated local credential/Auth finalizer → actual Auth absence check before completion. HttpOnly progress receipt survives disabled access; failed/partial steps remain pending. Other accounts' configuration is preserved. Logs/exports contain no app credentials/content diagnostics. Unlinked numerical totals preserve ₹1,000/month and included ₹200 evaluation rather than refunding spend on deletion; no contingency increase.

| Executed check — managed macOS source environment, 2026-10-31 | Actual result |
| --- | --- |
| `pnpm lint` | Passed, zero warnings; later worker/fixture-only changes checked with targeted lint and final type checking. |
| `pnpm typecheck` | Passed including new RPC/application contract and written runtime tests. |
| `pnpm test` | **334 passed, 0 failed, 0 skipped; 28 files; 23:30:19 IST; 0.875s.** Historical task baseline 294 + **40 cases**: privacy/retention/export/worker/finalizer helpers 23, HTTP/resource gates 14, migration-source mapping 3. Existing orchestration assertions now verify the compound proposal boundary; no assertion/rule was removed. These are unit/mocked checks, not SQL locking/RLS or actual provider evidence. |
| `JARVIS_MOCK_ONLY=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm build` | Passed, optimized webpack build/type compilation; four privacy API routes and content-free deletion-status shell included. No connected runtime or deletion executed. |
| Script/packaging checks | Syntax checked audit, migration-definition helper, reconstruction and privacy finalizer. Fixed evidenced rename/schema capture-group bug in audit; owner-keyed voice/privacy fingerprint keys and deterministic composite metadata ordering in reconstruction. Scripts were not run against a DB. |
| Capacity/dependencies/source control | ~7.1 GiB before final build; no install/dependency-pin change, only a new finalizer script entry. 5 GiB reconstruction guard preserved/unexercised. Git remains initialized with untracked source; no commit, remote or publication. Ignore/manifest review excludes secrets, exports, audio, caches and retained DB. |

## Implemented, awaiting database/browser/worker/live evidence

- New **unapplied `202610310004_privacy_center.sql`**, after all 15 earlier files, including still-pending 010/202610310001/002/003. Restrictive new tables/RPCs/triggers, consent/expiry/source/deletion fences, private cleanup/finalizer capabilities and unlinked cost totals are source only. No applied SQL was edited or privilege weakened around unavailable runtime. Guard retains no profile SELECT; ordinary export uses its verified user profile. Runtime worker retains no Auth/admin/profile-table access or DDL. Audit actual deployed owners/ACLs, removed temporary CREATE, grants, policies and body mappings on the new machine. Generated DB types **not regenerated here**.
- **Written—not executed:** **13 new DB cases** (expected full **107**), **one real worker-process case** (full **14**), **four browser cases** (full **38**). Cover A/B keyset ownership, projections/recent AMR, consent between reserve/dispatch, exact shorter-retention confirmation, history/memory dependencies, epoch/tombstone non-recreation, active worker cancellation, queue cleanup, account access/partial state and supported synthetic Auth deletion. Old live-boundary fixtures explicitly enable their own synthetic text consent; fixture cleanup removes only this run's private metadata. Nine older HTTPS groups are not rerun or proof of new privacy-cookie/runtime behavior.
- Remaining gates: incremental migration and full disposable reconstruction/retained preservation; actual server consent/retention/export/erasure/queue/lock behavior; finalizer failure/restart/credential-file checks on isolated synthetic accounts; interactive/SR/device/HTTPS privacy boundary checks; existing M2C evaluation/live AI/Pushover/phone observations; restore/deletion replay and operational log/backup guarantees. Earlier user-terminal 52 DB / ten worker / twenty browser / nine HTTPS results remain historical, not current acceptance.
- **Not implemented/claimed:** automated backup creation/expiry/selective deletion/restore reconciliation, remote provider-account/key revocation, remote device notification deletion, physical erasure or end-to-end encryption. Developer fixture/Mailpit/system credential/OS copies are outside this app's user-facing erase. Account-wide app controls now exist in source; the older “no export/wipe yet” checkpoints below are historical.

## Retained operational metadata and handoff

Completed erasure receipts and privacy events: **30 days**; unresolved jobs: until resumed/completed; minimal retired request IDs: until account deletion (or orphan cleanup after identity disappears); numerical monthly cost totals without owner/content: **13 months**; initial-evaluation carry: until that policy is retired. These are technical retry/budget purposes, not legal retention assertions. Account finalization clears matching-owner live/evaluation files and Auth identity; provider-side revocation/cached process copies and independent backups are separate. Approved-memory tombstones preserve suppression/provenance without payload; source history may remain unless also deleted.

[ARCHITECTURE.md](ARCHITECTURE.md) contains the concise data inventory and boundaries. [MACHINE_HANDOFF.md](MACHINE_HANDOFF.md) contains actual scripts, migration order, recovery and deferred verification. New archive: `.local/transfer/jarvis-source-20261031-privacy.tar.gz`; old archives preserved. Implementation is reviewable; **Privacy Center runtime acceptance and earlier milestones remain unaccepted**. No further feature started or runtime action requested on this laptop.

---

# Earlier task/voice/recurrence evidence — historical checkpoints

# Project status — focused personal tasks

Updated **2026-10-31 IST**. Personal task management is **implemented in source; runtime acceptance pending**. Existing Auth, memory, recurrence/snooze, voice, AI budget and notification boundaries are preserved. **No Docker/database/browser/worker-process/HTTPS/live/device test, paid call or deployment ran during this feature.** Earlier milestones remain partial/unaccepted where previously recorded.

## Implemented and verified here

- Today has quick task entry, notes/deadline editing, detail view, Overdue/Due today/Upcoming/No due date/Drafts groups, and an opt-in completed/cancelled filter. Complete/reopen/cancel are deterministic controls; deletion has explicit confirmation. Saves retain request IDs on uncertain results, do not optimistically change rows, and provide useful failures/focus targets. Reminder schedules/status/history remain separate from deadlines.
- Calendar deadlines use saved IANA zones, never UTC midnight. Date-only is overdue from the next local day; exact-time is overdue at its instant; no deadline never becomes overdue. Profile/device zone changes do not rewrite deadlines. Exact clock gaps are rejected and folds require an explicit earlier/later choice. Inputs: title 1–120, notes up to 2,000, dates within ten calendar years either side of today; up to 1,000 tasks/account, 30 operations/minute.
- Typed chat create/edit/status/delete proposals produce exact reviews, not executed changes. Deterministic examples work without inference: “Add a task to finish my assignment”, “Make it due YYYY-MM-DD”, “Mark the assignment task complete”, “Show my overdue tasks”. Friday alone asks for the full calendar date. Current owned focus supports “it”; duplicate/truncated candidate sets require clarification. Complex live proposals use the existing strict tool boundary. At most eight relevant owned titles/deadlines/status/version references, **no notes**, enter model context. Temporary chat retrieves/changes no tasks; reviewed voice text uses this same route.
- Linked reminders use the existing one-time schedule/channel review and **separate exact confirmation**. A task due date never schedules a notification; delivery never completes a task. Generic `Task reminder` title avoids copying task content into notification history. Task closure/delete is designed to atomically cancel unsent linked work; sending/accepted/unknown history remains accurate. Reopen does not reactivate reminders; deadline edits do not move them. Removing/cancelling a reminder keeps the task. These SQL/worker claims are **implemented—not runtime-proven**.

| Executed check — this feature, E1 managed macOS source environment | Actual result |
| --- | --- |
| `pnpm lint` | Passed, zero warnings. |
| `pnpm typecheck` | Passed, includes new API contract and written runtime test files. |
| `pnpm test` | **294 passed, 0 failed, 0 skipped; 25 files; 22:13:55 IST; 0.824s.** Previous 250 + **44 task cases**: deadline/reference/intent 22, mocked chat/RPC/context/retry 15, HTTP validation 7. These do not prove RLS, SQL concurrency or worker/browser behavior. |
| `JARVIS_MOCK_ONLY=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm build` | Passed, optimized webpack build and type compilation; `/api/v1/tasks` included. No provider dispatch or runtime acceptance. |
| `node --check scripts/audit.mjs` / `scripts/reconstruct.mjs` | Passed syntax only. Audit and retained-fingerprint allowlists now include tasks/operations; neither script was run against a database. |
| Storage/dependencies/Git | ~10–11 GiB free across pre-build checks; no installation or dependency/pin changes. 5 GiB reconstruction guard preserved and not exercised. Git remains initialized with untracked source, no commit/remote/publish performed. Ignore rules explicitly cover recording media as well as existing local secrets/artifacts. |

An early tool-schema literal and test Json typing issue were corrected before final source checks. Final SQL review also preserves the in-flight warning on a second detach after cancellation was already requested; the existing deferred worker case now asserts this. This SQL/test-only refinement passed type checking and targeted worker-file lint; it did not change compiled web code. No SQL execution was attempted to validate or repair pending migrations.

## Implemented, awaiting runtime verification

- **New unapplied `202610310003_tasks.sql`** depends on the full chain, including still-pending **202610290010 operator repair**, **202610310001 recurrence** and **202610310002 voice**. Adds owned tasks and minimal-content task operations, conversation focus, same-owner/same-task composite links to one-time reminders, indexes, restrictive owned SELECT/RLS and narrow guard-definer task RPCs. No direct API writes, admin ordinary requests, managed-Auth grant or worker table access is added. Wrappers preserve private legacy delegates and check task authority before claim/authorize; temporary setup CREATE is revoked in the same migration. Inspect actual deployed ACLs/bodies and incremental compatibility on the new machine; generated types are **not regenerated here**.
- **Written—not executed:** **12 task DB cases** (expected full **94**), **two real worker-process cases** (expected full **13**), **four browser cases** (two definitions × two authenticated viewports, expected full **34**). Cover ordinary A/B and anonymous access, forged identifiers/links, exact/stale reviews, concurrent completion/idempotency, deadline stability, atomic cancellation rollback, deletion/content-minimal history, disabled accounts, cancellation before authorization/in flight, reopen, UI review/confirmation, temporary nonpersistence and axe/reflow. Existing nine HTTPS groups remain deferred. No skipped or failed setup is called passing.
- **Not implemented in this slice:** projects/subtasks/shared tasks, recurring task generation, calendar integration, automatic briefings, task-specific bulk export/account wipe. The application still lacks the upcoming account-wide privacy/export/deletion/restore lifecycle; task tables/links/operation hashes must be included there. Task title/notes can be deleted now; source chat follows existing 30-day history, generic reminder/attempt history its existing lifecycle, and content-free task operation IDs/hashes/timestamps remain until account cleanup. No new backup/log expiry or physical erasure guarantee.
- **Preserved gaps:** fresh reconstruction/retained preservation; pending grants/recurrence/voice/task migration proof; live M2C evaluation/AI/Pushover/provider acceptance/observed phone arrival; physical-device/browser and manual screen-reader/real-phone checks **Deferred—not tested**; account lifecycle/restore and remote CI **not run**. Historical executed 52 DB / 10 worker / 20 HTTP / 9 HTTPS results are not reruns or acceptance of this source.

Use [MACHINE_HANDOFF.md](MACHINE_HANDOFF.md) for the ordered new-machine checks. Transfer archive: `.local/transfer/jarvis-source-20261031-tasks.tar.gz` (source/docs/tests only; no credentials, retained data, recordings or caches). **Implementation is ready for review; task runtime acceptance and earlier milestones remain pending.** Smallest new-machine action: extract into an empty directory and run `pnpm install --frozen-lockfile`. No runtime action is requested on this laptop.

---

# Prior voice evidence — historical

All checkpoints below describe earlier source states. Current results and deferred suite counts are recorded above.

# Project status — push-to-talk voice implementation

Updated **2026-10-31 IST**. The authorized voice slice is implemented, with runtime/device acceptance **pending**. Earlier M1/M2/M2C and recurrence acceptance is unchanged. **No Docker/database/browser/worker-process/live/physical-device test, deployment or paid call ran in this continuation.** Pending migrations and earlier operational/accessibility gaps are not waived.

## Implemented and verified here

- Assistant uses the same composer, request IDs, streaming, memory approval and reminder-confirmation flow for reviewed voice text. Start/Stop are click/touch/keyboard controls; microphone access occurs only on Start. Recording indicator/elapsed time/Cancel, 60-second cap, 2 MiB capture bound, runtime format selection, explicit Transcribe, editable review and separate Use transcript → Send. Typing remains available. No automatic transcription upload, message send, action confirmation or provider fallback.
- Capture cleanup covers stop, cancellation, permission resolving late, device interruption, hidden page, navigation/unmount and local/cross-tab sign-out. Hidden/interrupted audio is discarded with no automatic resume. Pending results are bound to component generation/conversation; normalizing/upload work is abortable and buffers/references are disposed.
- Server accepts only bounded canonical mono 16 kHz PCM16 WAV; validates actual header/data/sample count (0.2–60 seconds, at most **1,920,044 bytes**), not a client duration or cost. Browser Web Audio normalizes supported WebM/MP4 captures; no dependency/install/FFmpeg staging. A short encoder tail may be trimmed to 60 seconds, disclosed before capture. Same-origin binary request guard, verified session/admission, owner-bound live key, independent cloud consent, safe errors, no-store responses, timeouts and bounded resource limits.
- Optional completed-only browser read-aloud selects only voices with `localService === true`, handles late lists, has Stop and 0.8–1.2× page-local rate. Automatic speech remains off. Plain text omits code/links, bounds 2,000 characters/45 seconds, discloses truncation and treats browser locality as an indication rather than OS proof. Recording/navigation/sign-out stops speech.

| Executed check | Result / scope |
| --- | --- |
| `pnpm lint` | Passed, final source. |
| `pnpm typecheck` | Passed, including new pending-schema contract and written test files. |
| `pnpm test` | **250 passed, 0 failed, 0 skipped**, 22 files, **18:36:56 IST**, 0.505s. Historical 204 + **46 voice cases**: capture/format/normalization/header 15; speech 6; provider/accounting/resource-boundary 11; authenticated HTTP/settings mocks 11; initial markup 1; real installed-SDK HTTP fixtures 2. Mocks test code boundaries, **not SQL locking/RLS, device capture or actual provider operation**. |
| `JARVIS_MOCK_ONLY=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm build` | Passed, webpack production compilation/type generation. New voice settings/transcription routes included. No runtime acceptance implied. |
| Script syntax / source safety | `node --check` passed for live-configure, audit and reconstruction helpers. No dependency pins changed. Disk checked before build (~11 GiB available); unchanged 5 GiB reconstruction guard was not bypassed or exercised. |

The SDK HTTP fixture initially failed because its local `data:,` FormData probe and `languages[]` encoding were modeled incorrectly. The corrected fixture passes and verifies exactly one transcription endpoint call, fixed model, bounded WAV and sanitized failure without retries. An early unit fixture literal type and effect-cleanup lint issue were repaired before the passing checks above.

## Implemented, awaiting database/browser/live/device evidence

- **New unapplied migration:** `202610310002_voice.sql`, after all previous migrations including **still-pending 202610290010 and 202610310001**. Adds default-off owned voice preferences, server transcription enablement flag, duration pricing/metadata in the **existing AI ledger**, exact consent and reserve/account RPCs. Ordinary requests stay user-JWT only; private delegates prevent token accounting from zero-pricing audio. No raw audio or transcript columns/storage, Auth redesign, managed-Auth grants or worker privilege expansion. Existing migrations untouched; deployed grants/body matching/type generation remain pending.
- **Budget:** gpt-transcribe at reviewed $0.0045/minute; existing conservative ₹150/USD conversion. Reserve **₹1** for the entire bounded minute (estimated maximum ₹0.675 before paise rounding); reconcile valid reported duration, retain reservation for uncertain/cancelled-dispatched/missing usage. Shared global advisory lock/ledger enforce ₹1,000/month, two total active AI requests, one transcription/account and four transcription requests/minute. ₹200 evaluation remains inside ₹1,000; ₹500 contingency remains separate. Monthly period Asia/Kolkata; 80% alert unchanged. Audio price review expires **2026-11-30 IST**. Estimates do not establish exact invoice containment. **SQL concurrency is written—not executed**.
- **Written—not executed:** **12 new database cases** (expected full **82**), **6 new browser cases** (three definitions × desktop/mobile, expected full **30**). Cover ordinary A/B access/capabilities, separate consent, shared budget/concurrency/month rollover/unknown usage, duration bounds, private delegates, editable review/no auto-send, microphone cleanup/stale results, temporary content and local speech interruption. Existing **11 worker cases / 9 HTTPS groups** remain deferred, not rerun.
- **Device/manual:** desktop Chrome/Safari, Android Chrome and iOS Safari microphone/codec/local-voice/keyboard/screen-reader checks are **Deferred—not tested**. Current loopback app/headless self-signed TLS is not a reachable trusted phone test origin. A later controlled setup is needed; no deployment or permission changes for phone access were attempted.
- **Preserved gaps:** operator repair 010, recurrence migration/runtime proof, fresh disposable reconstruction/retained-state preservation, M2C evaluation/live AI/phone arrival, full account lifecycle/restore guarantees and remote CI (**not run**). No earlier milestone is accepted by voice mocks.

## Privacy, limits and handoff

Cloud transcription is separate from microphone permission and text-AI enablement. It needs a privately configured personal key/server flag **and** user consent in Assistant → Cloud transcription and privacy; provider defaults to the explicit mock. Only audio plus an optional language hint goes to transcription—no history/memories. Raw recording, intermediate WAV and unsent transcript are transient, with no DB/object storage/files/browser persistent storage or body/content logging added. Numeric usage/consent metadata persists, including for temporary mode; temporary **content** stays ephemeral. Reviewed text follows existing history rules only after Send. Reference disposal/zeroing is not a guarantee of secure physical erasure or zero provider retention. No browser recognition service, cloud TTS, Realtime, wake words, background listening or full duplex was implemented.

Use **[MACHINE_HANDOFF.md](MACHINE_HANDOFF.md)** for new-machine setup, current test counts, opt-in configuration and the later device checklist. Source archive: `.local/transfer/jarvis-source-20261031-voice.tar.gz` (source/docs/tests only; no secrets, caches or retained DB). Smallest next action on the new machine: extract into an empty directory and run **`pnpm install --frozen-lockfile`**. No runtime action is requested on this laptop.

---

# Recurrence/snooze evidence — historical before voice

Updated **2026-10-31 IST**. This focused feature is implemented in source; **database, browser, worker-process and live verification are deliberately deferred to the new machine**. No Docker operation, database command, reconstruction/reset/prune, paid call or deployment ran in this feature task. Earlier M1/M2 acceptance is unchanged: **partial/unaccepted**. The pending operator permission repair is still pending; no permissions were weakened around the unavailable runtime.

## Implemented and verified here

- Daily/selected-weekday Temporal calendar planning; fixed explicit IANA zone; start and optional inclusive end date; three-occurrence preview with actual UTC offsets and clock adjustments. Gap policy shifts forward by the transition duration; folds use the earlier instant once. One-time reminders retain their existing explicit gap/fold behavior.
- Today has separate series and occurrence controls: exact versioned review/confirmation, future schedule edit, pause/resume/cancel, skip next, and occurrence-only 10-minute/one-hour/custom snooze. Mock chat handles a documented narrow daily/weekday command; missing start dates ask for clarification. The live typed proposal contract supports recurrence but cannot confirm/enqueue. Temporary actions remain disabled.
- Offline source results: **204 unit/mocked tests passed, 0 failed, 0 skipped, 17 files**, 17:50:59 IST, 0.510s. Previous baseline 161 + **43** new: calendar/validation/intent 32, request/RPC boundary 8, recurring proposal orchestration 2, initial recurring markup 1. These do **not** establish RLS, SQL atomicity, worker durability, interactive accessibility or live-provider operation. Lint and type checking pass. Final production webpack build passed with live configuration disabled for that build process (compilation evidence, not connected-runtime evidence).
- Node **24.14.1**, pnpm **10.34.9**; existing pinned dependencies reused, no installation. Disk was checked before build (~11 GiB available at that point); the reconstruction 5 GiB guard is unchanged and reconstruction was **not attempted**, irrespective of recovered capacity.

## Implemented, awaiting runtime verification

| Boundary | Source / required evidence |
| --- | --- |
| Incremental migration | New **202610310001_recurring_reminders.sql**, after all twelve earlier migration files including still-pending **202610290010**. Existing migrations untouched. New owned `reminder_series`/`series_operations`; existing reminders are occurrence rows with matching-owner FK and unique `(series_id, series_version, occurrence_date)` identity. Private isolated fixture scope follows the existing test-control pattern. SQL has been reviewed, **not executed or deployed**. |
| Authorization / compatibility | Owned reads and no direct writes; narrow authenticated series/snooze RPCs; guard-owned fixed-path helpers. Existing worker capability wraps private, non-API delegates; ordinary requests remain user-JWT only. Temporary schema CREATE for owner transfer is revoked in the same migration. Audit ownership, ACLs, source bodies and migration history on the new machine. Generated DB types remain pre-feature until `pnpm db:types` runs there; the app contract was updated by source review. |
| Scheduling / races | One next future occurrence, plus bounded batches of at most 32 historical dates per series; at most ten rotating series per sweep. Advance on calendar due time, independently of previous success/failure/unknown. Domain cursor lock/unique key, transactional occurrence+operation+outbox, version fences, durable cancellation events, same restricted pg-boss machinery. Worker Temporal results must match SQL's independent timezone interpretation or that series fails closed without blocking other reminders. Restart recovery is **not yet proved for recurrence**. |
| Lateness / snooze | Default recurring lateness 5 minutes, configurable 1–60 and bound to review. Older unsent dates become Missed, never backlog sends. Pause/resume does not replay paused dates. Snooze preserves identity/nominal date and series schedule, requires an unsent unexpired pending occurrence, and is strictly before the following nominal occurrence. Any prior send authorization, acceptance or unknown outcome rejects snooze. Once sending is in flight it cannot be recalled. |
| Tests written—not executed | **17 new database cases** (full suite now **70**, prior 53 also not rerun); **1 new isolated real worker-process case** (suite now **11**); **4 new browser cases** (24 total across desktop/mobile). Include A/B/forged IDs, exact/stale preview, concurrent creation, atomic outbox rollback, worker/SQL DST agreement, stale jobs, edit/cancel/snooze/authorize races, restart and temporary nonpersistence. No failed setup or skip is counted as passing evidence. |
| Preserved pending work | Migration 010 operator-only EXECUTE repair; fresh disposable reconstruction and retained-data preservation proof; M2C live AI/evaluation/phone acceptance/arrival sequence; manual screen reader/real-phone keyboard **Deferred—not tested before private beta**; remote CI **not run**. Historical 52 integration / 10 worker / 20 browser / 9 HTTPS results remain historical, not proof of this feature. |

## Explicit limits and next action

Daily/weekly only, at most 50 series/account, 30 series or snooze operations/minute. New/edit start today through 365 days ahead; optional inclusive end within ten years, or continue until cancelled. No monthly/yearly/arbitrary rules, recurrence snooze merging, model-driven snooze execution, general tasks, voice, hosting or beta. Live notification text remains generic; old mocks stay mock and personal-channel binding/version is preserved. Queue/provider failure and unknown semantics are unchanged, not revalidated live. Series/occurrence history and operation metadata are retained; account-wide export/wipe and tested restore remain earlier gaps.

The refreshed source-transfer path is `.local/transfer/jarvis-source-20261031-recurrence.tar.gz`; it contains source/docs/tests only, not credentials, caches or retained database data.

Smallest next action: transfer the reviewed source archive described in **[MACHINE_HANDOFF.md](MACHINE_HANDOFF.md)** to an empty directory on the new machine and run **`pnpm install --frozen-lockfile`**. That guide orders migrations, private worker setup, generated types, ACL/DB/process/browser/HTTPS verification and later controlled live checks. No runtime action is requested on this laptop.

---

# Earlier M2C stabilization evidence — historical (before recurrence)

Updated **2026-10-31 IST**. The user explicitly deferred Docker/Supabase and live runtime work until another machine. **No Docker startup, database operation/reset/reconstruction/prune, deployment or paid live call was attempted in this continuation.** M2C's core implementation is present; acceptance awaits the runtime evidence below. M1 and full M2 remain **partial/unaccepted**.

## Implemented and verified here — 2026-10-31

Environment: this managed macOS checkout, Node **24.14.1**, pnpm **10.34.9**, installed pinned dependencies reused, no package additions or pin changes. Git remains initialized with untracked source; no commit/remote/publishing. About **2.0 GiB** available before build; the reconstruction guard remains 5 GiB.

| Check | Actual result and limit |
| --- | --- |
| `pnpm lint` | **Passed**, final source state. |
| `pnpm typecheck` | **Passed**, including existing/generated schema contracts and added offline tests. |
| `JARVIS_MOCK_ONLY=1 pnpm test` | **161 passed, 0 failed, 0 skipped**, 15 files, 16:57:26 IST, 0.514s. Historical baseline 132 + 29 new: SDK/refusal/failure/tool limits 9, notification routing 6, reservation/error boundary 3, orchestration 8, initial markup 3. RPC/provider mocks test gating/control flow, **not RLS or database atomicity**. |
| Production build | **Passed**, `JARVIS_MOCK_ONLY=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm build`; Next/webpack compilation, type checking, static generation and tracing completed. No provider calls or runtime tests. |
| Browser discovery | `pnpm exec playwright test --list`: **20 cases discovered**, not executed. No browser, keyboard, reflow or axe pass is claimed today. |
| Operational syntax | `node --check` for reconstruction, evaluation and Pushover-test scripts **passed**. These do not execute scripts or connect to services. |
| Masked local status / ignore audit | Account/Pushover configured flags true; OpenAI/model/enabled false. This reads only private local configuration, not database/provider health. `git check-ignore` confirms local credentials/env/build/test/screenshot/source-transfer outputs excluded. No secret values printed. |

Source improvements: safe fixed live-provider recovery messages; streamed refusal text; no invented answer on empty completion; tested single-tool limits; isolated notification routing that keeps old mock jobs mock even with live configuration; wrong-owner/test-mode live denial and conservative post-send record failures; clearer mock/live help, retry/stop/wait labels, receipt clearing on conversation/mode changes, loading versus unavailable versus empty memory/history, exact channel retention on unavailable live drafts, review focus and provider-status refresh. Unavailable services are not silently replaced with a login/database mock.

## Implemented, awaiting database or live-service verification

| Component | Implementation / remaining evidence |
| --- | --- |
| OpenAI | Official pinned SDK 7.45.1 Responses streaming, cancellation, bounded approved context/history/output/reasoning/tool rounds, no fallback and store:false. Offline HTTP/SDK/orchestration tests pass. No real response, account/model availability, quality, usage reconciliation or model winner established. |
| Memory and actions | Owner-scoped active retrieval; exact separately approved proposals/corrections/deletion; filtered old proposal sources; typed reminder review through the existing deterministic operation, explicit confirmation and unchanged temporary restrictions. Historical real SQL passes are below; new source needs runtime regression. |
| Pushover / worker | Owner-bound private configuration, normal generic payload, durable scheduling/attempt states, provider acceptance distinct from user phone observation, no mock-to-live promotion. Device configuration was validated historically; **no valid send acceptance or phone arrival yet**. Updated routing needs the actual ten-case worker run. |
| Budget | Durable SQL reservations/locks, month boundary in Asia/Kolkata, server-only per-request settlement capabilities and conservative uncertain charges. ₹1,000 monthly AI, ₹200 initial evaluation within it, ₹500 separate contingency. Offline delegation/math/failure tests pass; repeat real concurrency/ownership tests and verify project controls/invoices separately. |
| Repair 010 | Prepared migration `202610290010_operator_channel_test.sql` grants postgres EXECUTE on only the guard-owned private generic-test helper, after ownership transfer. Deployed diagnostic previously proved missing operator EXECUTE with valid account/config and API/worker denied. Last application attempt refused port 54322 **before SQL**. Repair is **not verified applied**; no migration edited or permissions weakened today. Verify history/grants, the 14-case affected file and actual send later. |
| Retention / reconstruction | Logical 30-day conversation expiry, bounded cleanup and independent approved-memory lifecycle already implemented. Reconstruction's read-only preservation fingerprint now includes M2C usage/policy/acceptance rows; syntax checked only. Fresh reconstruction and physical backup/restore/deletion guarantees remain unverified. |
| UX / accessibility | Four existing screens polished with current tokens/native controls and error/status/focus behavior. Three initial server-markup tests pass; interactive 320/390px, keyboard, axe and runtime-error checks require real browsers/runtime. Manual screen-reader/real-phone keyboard/scroll remain **Deferred—not tested before private beta**. |

Historical 2026-10-29 evidence: 52 full database tests passed before the new ACL regression (suite now **53**, affected file **14**); ten worker tests, twenty HTTP browser cases and nine HTTPS groups passed on that day's state. All are **historical**, not rerun here or proof of the latest routing/UX. Remote CI **not run**. Do not substitute the 161 offline units for these suites.

## Not implemented / not established

- Account-wide export/wipe workflows, a tested retained-data backup/restore/deletion replay and complete live-pilot operational gates in the existing plan remain unfinished; no acceptance criterion is removed. The optional data handoff is a procedure, not restore automation or a tested guarantee.
- No selected conversational model or executed bounded evaluation; no real AI-to-approved-memory-to-confirmed-reminder-to-phone acceptance. These require configured services and observations on the new machine, not another mock-only milestone.
- Recurrence, voice, hosting, beta/public registration, billing, uploads and room control remain outside this task.

## Exact next action

Read **[MACHINE_HANDOFF.md](MACHINE_HANDOFF.md)** and transfer its reviewed source set to the new machine. Start there with the pinned **`pnpm install --frozen-lockfile`**; the handoff contains the later fresh synthetic setup, migration/permission checks, full regressions and controlled live sequence. Do not start Docker or request storage work on this laptop. The guide separates source transfer from optional retained data and preserves unknown outcomes, budget history and owner IDs. No new-machine setup or restore is claimed executed.

<details>
<summary>Historical M2C implementation/runtime ledger — 2026-10-29, not current execution</summary>

# Project status — M2C in progress

Updated **2026-10-29 IST**. M2C implementation is authorized: local OpenAI conversation and explicitly selected Pushover notifications, within the approved budgets. **M2C and full live M2 are not complete.** Existing M2A/M2B acceptance below is historical; it does not prove the new live branches.

## Current implementation and evidence

E1 means agent-executed managed terminal. E2 means user-reported normal project terminal. No E1 Docker/listener execution is claimed.

| Check | Current result / evidence |
| --- | --- |
| Dependency | E2 `pnpm add openai --save-exact` installed **7.45.1** (+1 package); package/lockfile inspected. Existing pins retained. |
| Source implementation | Pushover validation/generic normal-priority adapter, exact owner/channel binding, acceptance versus phone observation, unknown/no replay; Responses SDK streaming, bounded action proposals, explicit memory approval, durable usage reservations and retention cleanup prepared. No Auth redesign or admin web client. |
| Incremental schema | E2 reports `pnpm db:migrate && pnpm worker:setup` succeeded after M2C migrations 006–009 were prepared. Treat these files as applied; future repairs must be additive. Current E2 audit lists **34/34 function bodies matching source**, intended definer owners/fixed paths, no anonymous execution, and restricted worker privileges (no queue CREATE, Auth/profile read, role escalation or runtime installer). The pasted report omits the migration-history header, so exact 11-version history is not independently recited from that output. Retained database was not reset. |
| Unit tests | E1 `pnpm test`: **132 passed, 0 failed, 0 skipped**, 11 files, 20:44:10 IST, 0.508s. Includes installed-SDK SSE HTTP fixtures, cancellation, false action claims, rate limiting, budget arithmetic, database-logging preflight and Pushover failures. Offline fixtures are not live acceptance or RLS proof. |
| Lint/type checking | **Passed**, E1 `pnpm lint && pnpm typecheck && pnpm test`, after generated-schema review, clarification/receipt separation and command-specific safe CLI diagnostics. |
| Production build | **Passed**, E1 `pnpm build` after the final clarification/receipt repair and regenerated types. Compilation, typecheck, static generation and traces succeeded after disk recovered to about **1.0 GiB** (no agent cleanup). Earlier storage block is resolved for this build only; fresh reconstruction still requires 5 GiB. |
| Real integration | **52 passed, 0 failed, 0 skipped**, four files, E2 `pnpm test:integration`, 19:16:56 IST, 4.46s (39 retained + 13 M2C). Real ordinary identities exercise budget concurrency/forgery/unknown states, exact approval, legacy bypass rejection, expiry, phone-channel denial and prior Auth/scheduling isolation. Test-ledger policies preserve the real binding; no live provider calls. |
| Worker / HTTP / HTTPS | E2 `pnpm test:worker && pnpm test:e2e`: **10 worker tests passed, 0 failed/skipped**, 147.08s, 19:17:56 IST; **20 HTTP browser cases passed, 0 failed/skipped**, 39.3s. Real restart/concurrency/cancellation/unknown/expiry and prior Auth/memory/temporary/Today/axe/reflow regressions pass. All use mocks; this does not prove live delivery/AI quality. E2 `pnpm db:types && pnpm test:https` also passes: generated schema reviewed directly (M2C RPCs, safe usage columns, nullable conflict/source/channel fields), **9 HTTPS groups passed**, temporary certificate cleanup confirmed, no system trust change. HTTP and HTTPS evidence remain distinct. |
| Configuration | **Pushover configured**, personal account bound. E2 `pnpm live:configure pushover` completed device validation, reporting `notifications_sent:0`, `openai_calls:0`. E1 `pnpm live:status` independently confirms account/Pushover true and OpenAI/model/enabled false; the private file passes its permission/schema checks without value output. Earlier lookup failure was resolved by admitting, registering and verifying the personal account. Built client assets contain no provider endpoints/private live-file path (fixed-pattern boundary scan, not actual-key scanning); ignored private files were rechecked. |
| Live acceptance | E2 generic test **failed** with SQLSTATE **42501**, category sql_privilege, before any accepted result was established. The old diagnostic did not identify its precise SQL phase. E2 read-only `--check` confirms operator postgres/schema USAGE true, **operator EXECUTE false**, guard-owned helper, API/worker EXECUTE false, configuration match/eligible true, zero diagnostic sends. This establishes missing operator EXECUTE as the cause. Additive migration **010** grants only that helper to postgres as its existing owner; E2 `pnpm db:migrate` then stopped with an unclassified wrapper error; migration 010 application remains **unconfirmed**, and the chained check/tests did not execute. E2 direct migration diagnostic proves **ECONNREFUSED 127.0.0.1:54322 before SQL execution**, so 010 did not apply in that attempt. E1 port inventory shows no database/API/mailbox listeners. Restore retained local Supabase before retrying migration; no further SQL privilege change is inferred from runtime unavailability. A new targeted ACL regression brings live-boundaries to 14 cases (53 total integration cases), not yet executed. Website-closed schedule, provider acceptance, phone observations, live AI/evaluation and complete flow remain **pending**. No model selected. Pushover validation used its live validation endpoint; no message send or OpenAI inference is yet reported. Provider invoice/funding totals unverified. |
| Git/privacy | Source untracked; existing Git preserved, no commit/remote/publication. `git check-ignore` confirms `.local/users.json`, `.local/live.json`, `.local/evaluation.json`, `.env.local`, screenshots and test artifacts excluded. No production credentials in CI; workflow explicitly forces `JARVIS_MOCK_ONLY=1` and has not run remotely. |
| Independent M1 gates | Fresh reconstruction/retained comparison **blocked/unverified**, unchanged **5 GiB** guard. Manual screen-reader and real-phone keyboard/scroll **Deferred—not tested before private beta**. Remote CI **not run**. Formal M1 stays partial. |

## Constraints and next actions

- Approved accounting: ₹1,000 AI/month, Asia/Kolkata calendar month; ₹200 initial evaluation within it, ₹500 contingency cannot increase AI allowance. Serialized reservations, two-call concurrency, uncertain/cancelled holds, dated prices and conservative ₹150/USD conversion are implemented; real SQL tests and account-side controls remain necessary. No invoice guarantee.
- Keep mocks explicit. Existing mock reminders cannot become live on configuration changes. Live channel review/confirmation binds the exact owner and credential generation; the model never sends/enqueues/approves.
- Conversation expiry is 30 days from creation; bounded worker/self cleanup removes expired sources, preserving independently approved memory until separately deleted. Temporary content is not persisted by the application. Numeric usage records are persistent and content-free. WAL/old pages/backups and restore erasure remain unverified; this is not hosted daily-use readiness.
- Live evaluation checks effective SQL logging settings before calls, and requires both generic and independently scheduled phone observations. It does not change logging settings or buy credits. Training/evaluation data-sharing opt-ins must remain disabled in the account.
- Database/worker/browser/HTTPS regressions and generated-schema review pass. A final source-reviewed repair separates untrusted model clarification text from authoritative app receipts and completes tool-only clarification output; its added unit verifies this trust boundary. Post-repair lint/typecheck, all 132 units and final build pass. Pushover private account/device configuration now passes; next live acceptance is the single fixed generic notification and separate phone observation. Do not prune Docker or reset data; the 5 GiB threshold applies specifically to fresh reconstruction.
- Full M2 acceptance also preserves the existing plan's account export/wipe, operator dispatch control and backup/restore entry requirements; those are not proved by the current regression counts or phone acceptance. No criterion is silently removed. Deferred manual checks and formal M1 gaps remain explicit.
- Next live step: open Docker Desktop and run `pnpm db:start` to restore the retained runtime; direct migration connection refusal and the port inventory establish its unavailability. No reset/prune/reconfiguration. After startup succeeds, apply 010. Once 010 applies, run the read-only test permission check and the 14-case affected integration file (no live sends). After that passes, use the normal notification test with Supabase running and any older separately started worker stopped first. The command starts its own temporary worker and reuses its fixed test on repetition. Capture its operation/scheduling/provider result separately from yes/no phone observation and approximate time. Then one confirmed website-closed schedule; OpenAI evaluation follows those phone checks. Do not start recurrence, voice, hosting or beta.


</details>

<details>
<summary>Historical M2B/M2A/M1 evidence (superseded only by explicit current results above)</summary>

# Project status

Updated **2026-10-29 IST**. **M2B is complete for local synthetic one-time reminders and mocked delivery.** Full M2 text-to-phone remains incomplete; no phone notification, live AI, paid resource or deployment was enabled. Authentication, admission, owned preferences, M2A conversation/temporary mode and approved memory remain intact.

## Current authorized slice — M2B

Today supports manual local-date/IANA-zone review, exact snapshot/version confirmation, inspection/listing, durable receipts and cancellation. The retained `/remind … | title` fixture creates only a review draft through the same domain service; temporary mode creates no reminder/operation. The separate native Node worker uses pg-boss for future jobs/execution/retries, plus application outbox/reconciliation. A website can close while the worker and local infrastructure remain running. Attempts say **Simulated acceptance**, never phone/device delivery.

## Current evidence — 2026-10-29

E1 = agent-executed managed terminal in this checkout. E2 = user-reported normal macOS project terminal, real local Supabase and ordinary-user tests. Docker/listener restrictions prevent E1 from claiming the E2 runtime work as its own execution. Historical M2A baseline (69/27/16/9) is retained below, not counted as new execution.

| Check / environment | Actual result | Evidence / limits |
| --- | --- | --- |
| E1 lint / type checking | **Passed** | `pnpm lint`; `pnpm typecheck`; final generated public-schema review completed. |
| E1 units | **87 passed, 0 failed, 0 skipped**, 7 files | `pnpm test`: 69 baseline + 18 new time/validation/mock-adapter cases. Controlled clock includes DST gap/overlap and half-hour transition. Not durability evidence. |
| E1 production build | **Passed** | `pnpm build`, including final interrupted-chat receipt wording. Native Node imports worker TypeScript successfully. |
| E2 incremental migrations/setup | **Passed** | `pnpm db:migrate && pnpm worker:setup`. Versions 002/003 first applied, setup reported 42702; additive 004 repaired colliding PL/pgSQL aliases. Additive 005 rotates bounded reconciliation fairly. No retained reset/applied-file rewrite or Auth redesign. |
| E2 full integration | **39 passed, 0 failed, 0 skipped**, 3 files, 3.26s | `pnpm test:integration`, 13:09:42: original 27 + 12 reminder cases. Ordinary-token RLS, exact/stale confirmation, idempotency, DB time validation, ownership constraints, admission and atomic rollback. Installer-only atomic-failure/catalog fixtures are explicitly distinguished from isolation proof. |
| E2 expanded reminder integration | **12 passed, 0 failed, 0 skipped**, 1.58s | `pnpm test:integration tests/integration/reminders.test.ts`, 13:23:32. Adds actual A-owned attempt visibility/unchanged-owner assertions, private-schema Data API denial and role/installer privilege checks. Other 27 unchanged tests not selected again. |
| E2 real worker process suite | **9 passed, 0 failed, 0 skipped**, 133.53s | `pnpm test:worker`, 13:15:19. Restricted worker processes with separate test queues: restart before due, enqueue/reconciliation recovery, two workers/one logical acceptance, retry exhaustion/permanent/unknown, cancellation races, process interruption, account disablement and 24-hour expiry. No running web process required by the harness. |
| E2 post-005 targeted worker suite | **2 passed, 0 failed, 8 deliberately skipped**, 15.05s | `pnpm test:worker -t 'bounded domain reconciliation|a real restricted worker'`, 13:20:11. Real restart passes again; 70 scoped catalog fixtures prove rotating 50-row selection across accounts. Suite now contains 10 distinct tests; this is not claimed as a single full 10-test run. |
| E2 full HTTP browsers | **20 passed, 0 failed, 0 skipped**, 32.4s | `pnpm test:e2e`, owned production listener 3100: 16 existing + 4 reminder cases. Today review/edit/confirmation/persistence/cancellation, forged endpoints/operations, no-store/origin, temporary denial and automated axe/320px/390px checks. |
| E2 final targeted chat browsers | **2 passed, 0 failed, 0 skipped**, 4.2s | `pnpm test:e2e --grep 'mock command'`: desktop/mobile after final interrupted-receipt warning. Server response deliberately withheld; stop/retry leaves one persisted review draft. Other 18 cases not selected again. |
| E1 observation of final browser artifact | **Passed status, zero failed IDs; console count not supplied** | `test-results/.last-run.json` mtime **2026-10-29T08:09:04Z**, after final `.next/BUILD_ID` **08:03:21Z**. Direct artifact inspection confirms a successful post-build browser run, not agent execution or an inferred four-case count. The requested receipt-only selection was four cases; its console footer remains unreported. |
| E2 type generation + deployed audit | **Passed** | `pnpm db:types && pnpm local:audit`, audit **2026-10-29T07:53:39Z**. Seven migrations applied; **19/19 application function bodies match latest source**. Restricted guard, RLS and fixed paths preserved; worker has dispatch capability, but no queue CREATE/profile/Auth SELECT, client SET membership or runtime queue-installer execution. pg-boss schema **46**. Retained synthetic accounts remain confirmed/admitted/profiled; config matches runtime. Catalog evidence supplements actual isolation/process tests. |
| HTTPS | **Historical 9-group M2A pass; not rerun in M2B** | Separate self-signed local runtime evidence remains valid historical foundation evidence, not a hosted TLS claim. Auth/cookie implementation unchanged. New M2B flow is exercised over HTTP. |
| Git / ignore rules | **Passed inspection; no remote CI** | Local Git exists, source remains untracked; no commit/remote/publish performed. `git check-ignore` confirms `.local/users.json`, `.local/worker.json`, `.env.local`, sensitive test outputs/screenshots excluded. `.env.example` is safe names/descriptions. CI definition now includes isolated worker setup/tests; remote CI **not run**. |

## M2B acceptance

| Required outcome | Status | Supporting evidence |
| --- | --- | --- |
| Exact local-time/zone/UTC review; explicit DST resolution; confirmation invalidated by edits | **Passed** | E1 time units; E2 SQL bypass tests and HTTP Today review. |
| Owner-scoped reminders, operations, outbox boundary and attempts; no privileged web requests | **Passed** | 39 integrations + expanded 12; browser forged IDs; deployed grants and memberships. |
| Atomic reminder/operation/outbox; idempotent duplicate/conflict handling | **Passed** | Real SQL rollback/incremental path and interrupted browser-receipt replay. |
| Durable pg-boss work survives worker restart independently of web | **Passed** | Real restricted process restart twice; one logical mock receipt. |
| Recoverable enqueue, fair reconciliation, concurrent dispatch, cancellation races | **Passed** | Nine-case process run + post-005 targeted two-case run. |
| Bounded retries, permanent failure, unknown/no blind replay, disabled accounts and expiry | **Passed** | Real process fault scenarios; fixed generic payload and restricted receipts. |
| Honest persisted UI, mock command and no temporary reminder content persistence | **Passed** | 20-case full browser run + final two-case replay checks. |
| Source/docs/operational handoff | **Passed for local slice** | Commands, limits, dependencies, role boundaries, source/audit/type review documented. M1 gaps below remain separate and explicit. |

## Operational limits and preserved gaps

- Latest free space: about **1.4 GiB**, below the unchanged **5 GiB** disposable reconstruction guard. Fresh reconstruction and retained-state fingerprint comparison remain **blocked/unverified**. No reset, volume prune, unrelated deletion or duplicate stack was used. Reconstruction source now fingerprints M2B/private outbox/receipts/queue state when present; that extension is prepared/syntax-checked, not execution evidence. Pause app/tests **and workers** before any eventual comparison.
- Manual screen-reader and real-phone keyboard/scroll: **Deferred—not tested before private beta**, per explicit user direction; do not repeatedly request them in this stage.
- Remote CI **not run**. Existing M1 acceptance requires a safe isolated workflow, not an invented remote-success prerequisite.
- Formal M1 stays partial. M1-A2/fresh reconstruction and A10/manual behavior, with dependent A12 handoff reproduction, retain their open evidence; all existing security/authorization requirements remain. No real-data hosted use/invitations authorized.
- Reminder delivery needs Docker/Supabase/Postgres and the worker running, host awake. Local sleep pauses dispatch. Catch-up is bounded to 24 hours; unknown outcomes are not replayed. No recurrence/snooze/tasks/live channel.
- Live phase still needs explicit personal-data/cloud consent, provider/budget/model evaluation, channel/device permission, retention/region and real-provider duplicate/status/timeout policy, plus hosted runtime/secret/backup decisions. All live services stay disabled.

## Exact next step

Try one synthetic reminder in **Today** with `pnpm dev` and `pnpm worker` in separate terminals (Supabase running). Review and confirm a near-future time, close the site, then reopen and inspect its **Simulated acceptance**. Worker startup/restart commands are exercised by the real process suite. Do not start another milestone automatically.

<details>
<summary>Historical M1/M2A evidence and acceptance ledger — superseded only where the current M2B section says so</summary>

# Historical M1/M2A evidence

Updated **2026-10-29 (IST)**. **M2A local mock text/approved-memory slice is complete: 69 unit tests, 27 real integration tests, 16 HTTP browser cases and 9 HTTPS runtime groups pass.** Lint/typecheck/build pass; three applied migrations and all 14 deployed function bodies match source. M1 formal acceptance remains partial (fresh reconstruction unverified/storage-blocked; manual checks Deferred—not tested before private beta). Full text-to-phone M2 and M2B are not complete/started. No live providers or deployment authorized.

## Current authorized slice — M2A (2026-10-29 IST)

The latest prompt authorizes **local text conversation and explicitly approved memory with a deterministic mock provider**. This supersedes older “no M2 work authorized/started” statements for M2A only. No live provider, reminder, queue/worker, notification, speech, billing, integration or deployment work is authorized. Full text-to-phone M2 remains incomplete.

Implemented source: owned conversations and atomic user/assistant text-turn rows; separate pending proposals and approved memories; bounded lexical retrieval; native POST/SSE streaming; request-ID deduplication and fenced 45-second attempts; cancellation/failure states; volatile temporary conversations; real Assistant/Memory screens. Mock rule is explicitly anchored `Remember this: …` / `Remember: …`; no general language-understanding claim.

Migration `202610290001_m2a_conversation_memory.sql` was **applied successfully by the user in the normal terminal**. Existing migration files/Auth helpers were preserved. New domain RPCs use the existing restricted guard, fixed empty search paths, verified session/admission checks and derived owner IDs. Ordinary requests remain anon-key/user-JWT; new tables expose owned SELECT only and deny direct writes. Composite FKs enforce source/parent ownership.

Latest E1 checks: lint/typecheck **pass**, **69 units pass** (57 existing + 12 M2A cases), first M2A production build **passed**. Final build after client stop/body-validation and semantic-region changes **passed**; lint/typecheck and 69 units pass after the repair. The suites contain **27 integration cases** (13 existing + 14 M2A, all passed) and **16 browser cases** (10 existing + 3 M2A per width, all passed in the final run). Normal-terminal execution is recorded below. E1 migration attempt failed before SQL at Docker permission; user execution is separate evidence.

Disk: initial M2A inspection 723 MiB, prebuild 610 MiB, latest continuation inspection **1.1 GiB free**. No packages/images installed, caches duplicated, files pruned or retained database reset. Existing reconstruction guard remains **5 GiB**, reconstruction/retained-comparison unverified. Manual screen-reader/real-mobile checks remain **Deferred—not tested before private beta**; do not ask again this stage. Remote CI **not run**. Local Git remains initialized with untracked source and no implicit commit/remote.

M2A is **complete for the authorized local/synthetic/mock slice**, with final results below. Generated schema, deployed metadata, domain isolation and all automated browser/source checks pass. The M1 ledger below is historical acceptance evidence, not a claim that its 13/10/9 suites were all rerun for M2A.

### M2A live verification update — normal terminal, 2026-10-29 IST

Intermediate diagnostic history; superseded by the Final M2A verification table below.

User-reported `pnpm test:integration && pnpm test:e2e`:

- **27 integration tests passed, 0 failed, 0 skipped**, two files, 2.58s, start 11:42:08. Includes 14 real M2A cases plus all 13 Auth regression cases. Ordinary-token reads/RPCs prove owner isolation, joins/source denial, grant restrictions, exact/stale approval, retrieval/conflicts/deletion, request/attempt fencing, source constraints, admission disablement and revocation. Privileged setup/catalog/constraint checks are separately labeled, not tenant-isolation proof.
- **14 browser cases passed, 2 failed, 0 skipped**, 27.2s. Both complete memory lifecycle cases reached the final axe assertion after their persistence/correction/deletion steps, then failed **aria-prohibited-attr**. Source inspection found aria-label on the generic transcript div. It now has role=region and tabIndex=0; axe assertions remain unchanged and a keyboard-focus assertion was added. Lint/typecheck, 69 units and build pass after the semantic fix. **Full 16-case browser rerun pending**, not yet passing.
- The separate `pnpm start` EADDRINUSE is an operational port collision with the user's running `pnpm dev`, not an auth/application failure. Use one app listener on 3000; do not kill unrelated processes or reset the DB.
- Updated `local:audit` includes M2A tables/functions and parameterized function-source matches; generated schema/audit normal-terminal result requested. Source syntax/typing are not execution evidence.

### M2A browser readiness repair and deployed-schema confirmation

Intermediate diagnostic history; superseded by the Final M2A verification table below.

The next E2 browser run against the reused development/HMR server reported **6 passed, 10 failed** (3.8m), including existing preferences/sign-out no-op interactions and disabled Send after fill. This supersedes the 14/2 browser result as the latest executed run, but does not invalidate the separate 27 passing database tests. No SQL/auth repair was inferred from those frontend symptoms.

Source review found interactive controls exposed in SSR before React handlers were attached, consistent with [Playwright's documented hydration failure](https://playwright.dev/docs/navigations#hydration) (accessed 2026-10-29). Auth/preferences/sign-out/composer controls now stay disabled until a React hydration snapshot confirms readiness. No arbitrary sleep or test rule suppression; a real blocked-JS browser assertion verifies controls cannot accept input before hydration. This is a frontend readiness repair, not an Auth/session redesign. The browser suite now owns a fresh production listener at **127.0.0.1:3100** with process-local APP_ORIGIN override and reuse disabled. The normal dev app on 3000/config file remain unchanged. No second database/environment/package installation. New build/lint/typecheck pass; **16-case rerun pending**, so diagnosis is not claimed proven by a later successful run yet.

E2 `pnpm db:types && pnpm local:audit` at **2026-10-29T06:31:38Z** succeeded. All three migration versions applied; **all 14 deployed function bodies match source**, including eight M2A functions. Intended owner/definer/empty search paths and grants match. New tables have RLS; guard has domain-table SELECT but no Auth-table SELECT/USAGE, no CREATE/BYPASS or app membership. Retained synthetic accounts remain confirmed/admitted/with profiles; API/key match runtime. Engineering directly reviewed regenerated public schema: four new tables/composite FKs and six RPC signatures match the contract; memory_key nullable annotation is reflected, and CHECK-constrained states remain intentionally narrowed. Generated metadata inspection is not substituted for the actual ordinary-token isolation tests.

Latest prebuild free storage **547 MiB**; production build after readiness changes **passed**. Reconstruction guard remains unchanged/unexecuted. Operator reconstruction fingerprints now also include M2A tables when present (source prepared, not a claim of fresh reconstruction execution).

### Latest browser result and test-navigation repair

Intermediate diagnostic history; superseded by the Final M2A verification table below.

The first fresh-production 3100 run reported **15 passed, 1 failed** (54.6s): only the mobile stale-approval case timed out finding a proposal after reload. This supersedes the prior reused-dev 6/10 run; other Auth, full memory lifecycle, temporary absence, failure/cancel/retry and desktop access cases passed. Artifact contained test source but no page snapshot; no missing-proposal/auth state was inferred from it.

Source review found the case reloaded after a Next client-side Memory click without awaiting route/data readiness. The test now waits for /memory and exact proposal content, asserts the stale approval leaves the newer version pending via the actual API, then reloads and confirms that exact version before approval. No timeout increase, weakened 409 check, API/SQL change or memory approval bypass. Lint/typecheck pass. **Full 16-case rerun pending**; not yet declared solved from source alone.

Generated types were reviewed against all new tables/RPC signatures and source references; application CHECK-state unions remain narrowed. `memory_key` follows generated nullable metadata. The operator audit's 14 source matches/three migrations and the 27 real integration passes are current, not mere static inspection.

### Final M2A verification — 2026-10-29 IST

| Check | Observed final result | Environment / scope |
| --- | --- | --- |
| `pnpm lint` | Passed, exit 0 | E1, after readiness/test-navigation/schema changes. |
| `pnpm typecheck` | Passed, exit 0 | E1, includes reviewed regenerated schema and browser-origin config. |
| `pnpm test` | **69 passed, 0 failed, 0 skipped**, six files | E1 final run start 12:08:50; 57 foundation + 12 provider/context/validation/SSE cases. |
| `pnpm build` | Passed, exit 0 | E1 final production build includes shared hydration gating and semantic transcript region. No dependency install. |
| `pnpm test:integration` | **27 passed, 0 failed, 0 skipped**, two files, 2.58s | User-reported E2 actual ordinary-token/RLS run; 13 foundation + 14 M2A. No DB/runtime changes after this run. Later fixes were UI/test-readiness only. |
| `pnpm test:e2e` | **16 listed cases passed** | User-reported E2 production listener 3100. E1 directly read `test-results/.last-run.json`: status=passed, failedTests=0, confirming suite completion despite omitted console footer. No duration inferred. All foundation and M2A cases remain; no retries/skips/rule suppression. |
| `pnpm test:https` | **9 runtime groups passed**, cleanupConfirmed=true, systemTrustChanged=false | User-reported E2 final run after shared-control changes, local self-signed origin 3443; separate from HTTP evidence. |
| `pnpm db:types && pnpm local:audit` | Passed; regenerated schema reviewed, **14/14 source matches**, three applied versions | User-reported E2 audit 06:31:38Z; E1 read generated fields/RPC signatures directly. Catalog audit is not isolation proof. |
| Fresh reconstruction / retained fingerprint comparison | **Unverified/storage-blocked** | Unchanged 5 GiB guard. No attempt to bypass; no reset/prune. Added M2A comparison scope remains unexecuted. |
| Manual screen-reader / real-phone keyboard-scroll | **Deferred—not tested**, before private beta | Explicit user decision preserved; not requested again or claimed passed. |
| Remote CI / Git | CI **not run**; Git initialized, source untracked, no commits/remotes | Workflow automatically covers expanded suites, no production secrets/deployment. No implicit publish/stage/commit. |

Final M2A acceptance:

- Conversations/history/delete and retained text streaming: **passed**.
- Explicit pending proposals, edit/approve/reject, exact revision/content binding and conflict replacement: **passed**.
- Active-only owned lexical retrieval across conversations, correction/deletion and stale-context rejection: **passed**.
- Source/parent ownership, forged IDs, anonymous/direct mutation denial, admission disablement and revocation: **passed** with ordinary identities; constraint/catalog checks are separately privileged fixtures.
- Temporary content absent from application content tables/browser persistent storage; no content log/summary/extraction path in source: **passed for this slice**. Auth/session infrastructure is separate; no physical secure-erasure promise.
- Provider failure/interruption/cancellation, incomplete-response labeling and request deduplication: **passed**.
- Automated accessibility, explicit blocked-JS readiness, focus and 320/390px reflow: **passed**. Manual checks remain deferred.

The semantic-region defect, pre-hydration control exposure/reused-dev harness ambiguity, and missing client-navigation wait were repaired without changing Auth/session SQL or weakening assertions. The final suite confirms the combined repairs; it does not isolate how much each earlier development-server failure was caused by HMR versus early interaction.

No new M2A work remains required by the authorized slice. README contains the synthetic try-it flow. Proposed next **M2B** is one-time reminder intent/confirmation with durable pg-boss scheduling and mocked notification delivery, under a separate instruction. No worker/queue/outbox/reminder/provider activation was implemented here.

## Current environment and diagnosis

Environment **E1**: managed shell on `/Users/bhargavkumarjayanthi/projects/jarvis`, macOS; Node 24.14.1, pnpm 10.34.9. Initial `git status --short` reported no repository; the user has since initialized local Git (follow-up below). Dependency pins and both SQL migration files were preserved in this stabilization run. No migration, reset, Docker cleanup, retained-data change, remote setup or deployment was performed by the agent.

- E1 cannot access Docker's socket, bind the app listener or reach local database/app/mailbox ports (EPERM). A separate browser probe returned ERR_CONNECTION_REFUSED. These are execution restrictions, not application failures. Do not repeat those probes without an environment change.
- Earlier E1 disk inspection found approximately 3.2 GiB available; the current follow-up found **796 MiB free**. No user files/volumes were pruned. The separate reconstruction tool requires 5 GiB headroom as a conservative tool guard, not a platform minimum.
- **E2**, the user's normal terminal, can access the running local Supabase and app. Its audit and real integration/browser evidence below supersede earlier unknown deployed-state observations. Application origin is `http://127.0.0.1:3000`; API is `http://127.0.0.1:54321`; mailbox is `http://127.0.0.1:54324`. Configuration correspondence was verified by the E2 audit without printing key values.
- Historical SQLSTATE 42501 failures involved role attributes, managed Auth RLS visibility and guard lookup of auth.uid. Both migrations now match the deployed source. No new SQL/privilege repair is supported by the current evidence.

## New user-reported live evidence — E2 normal terminal

At **2026-10-28T18:30:41Z / 2026-10-29 IST**, the user executed `pnpm local:audit` successfully. Both versions 202610270001 and 202610280001 are applied. All six deployed function bodies match latest source; owner/definer/search_path metadata matches the design. The guard is non-login/non-superuser/non-inheriting/non-bypass, has no Auth-schema usage or managed Auth-table SELECT and no temporary CREATE. Only postgres has guard membership (separate SET and ADMIN grants). PUBLIC/ordinary API execution of the private session bridge is denied. Authenticated has_access execution is expected for RLS; the public API routine list contains only revoke_current_session. That public RPC also has service_role EXECUTE from existing grants, but takes no arguments and still checks live session/admission/revocation; no ordinary request uses that key.

Alex, Sam and recovery retained fixture accounts are confirmed, enabled, admitted and have profiles. App URL/key match the running Supabase instance. Therefore missing profile/admission/configuration and pending migration explanations are **not supported by this deployed snapshot**. No further SQL migration/privilege repair was made.

The user then executed `pnpm test:integration`: **13 passed, 0 failed, 0 skipped**, one file, 1.43s, normal terminal Start 00:03:43 IST. This is user-reported real execution, not an agent-run result or mocked test. It establishes ordinary-user API/RLS ownership, read/update and denied-write preservation, signature/context attacks, session refresh/expiry/admission disablement and captured-token revocation. The earlier E1 setup failure below remains historical to that environment only.

The user then executed `pnpm run test:e2e`: **8 passed, 2 failed, 0 skipped; 10 cases in 19.5s**, E2, 2026-10-29 IST. Both desktop/mobile own-preference/reload/validation/sign-out and cookie/CSRF/cache/axe/reflow cases passed, as did public and unauthenticated cases. Both email lifecycle cases reached the correct expired-code rejection but failed because an unscoped alert selector also matched Next's route announcer. This is a demonstrated **test locator defect**, not evidence that expiry enforcement failed. Both assertions now scope the same required text to the form alert; lint/typecheck pass after that test-only repair. The subsequent E2 rerun on 2026-10-29 IST reports **10 passed, 0 failed, 0 skipped in 14.6s**. Registration, expired/reused-code rejection, resend, recovery, password update and subsequent sign-in now all pass on desktop/mobile. The original 8/2 result is retained as diagnostic history, not the final suite result.

The earlier split command (`pnpm t` then `est:e2e`) separately ran **57 unit tests successfully**, followed by a shell command-not-found error. It was not browser execution.

The user executed `pnpm db:types` successfully on 2026-10-29 IST. Engineering read the generated file directly: profile columns/nullability, required owner insert, optional updates and argument-free void revocation RPC match the application contract. Generated tone/locale are strings because SQL CHECK constraints are not TypeScript unions; the app retains its explicitly bounded contract. `pnpm typecheck` and `pnpm lint` pass with the generated file present. No schema or runtime change was made.

The user executed `pnpm db:reconstruct` on 2026-10-29 IST. It exited 1 at **disposable_preflight / insufficient_disk_headroom**, requiring 5 GiB. No disposable project was started and no retained records/volumes were targeted. This is a host-capacity/tool precondition blocker, not a failed migration or SQL privilege check. Fresh reconstruction remains unexecuted.

## Remaining acceptance follow-up — 2026-10-29 IST

- `df -h /System/Volumes/Data /private/tmp` in E1 now reports **796 MiB free** on both paths. The **5 GiB guard is unchanged**. Reconstruction was not attempted at this capacity; no reset, pruning or unrelated deletion occurred. Its previous E2 guard refusal remains the last actual reconstruction attempt.
- Reconstruction tooling now compares read-only retained fingerprints before/after disposable work and cleanup. Scope: all profiles/admissions/revocations, Auth identity/confirmation/ban metadata and migration versions. No values or hashes printed; volatile sessions/last-sign-in timestamps excluded. Pause other app/test activity during that run; concurrent edits cause a failed comparison without attributing the change to the tool. **This added comparison has not executed**, so retained-state preservation is not claimed from source inspection alone.
- `pnpm test:https` was added for the existing build using an ephemeral TLS listener/certificate and isolated synthetic accounts. E1 execution exited 1 at **https_listener_preflight / execution_permission**, with **0 runtime checks passed**. No fixture/certificate/server was created past that preflight. Normal-terminal result pending. HTTP 10/10 evidence remains distinct from HTTPS.
- `git status --short`: no repository. Authorized `git init` attempt: **Operation not permitted** for root `.git`. No retry/workaround, staging, commit, remote or publication performed. User normal-terminal initialization requested.
- Actual `git check-ignore --no-index --stdin` using disposable Git metadata against workspace rules confirms `.local/users.json`, `.env.local`, `.env.production`, TLS key path, test-results, playwright-report and sensitive screenshot paths **ignored**; `.env.example` and generated public types **not ignored**. Temporary audit metadata removed. This is actual ignore evaluation, not proof of a successful root Git initialization.
- Lint, typecheck and **57 unit tests pass after the harness changes**. Production build remains the prior passing run; no web/application source changed in this follow-up. No dependency or SQL changes.
- Existing M1 plan gate 6 requires safe CI design and no production secrets; it does **not explicitly require a successful remote CI run**. Workflow inspected; **remote CI: not run**. This distinction clarifies the existing wording without removing any criterion or claiming a remote pass.
- Manual VoiceOver/TalkBack and real-phone keyboard/scroll checks were requested with a concrete README checklist and local USB access guidance. **No manual results received yet**; automated keyboard/axe/reflow results do not establish them.

### Subsequent E2 results and explicit deferral

- **HTTPS passed**: user-reported `pnpm test:https` returns all **9 runtime check groups passed**, selfSignedBrowserContext=true, systemTrustChanged=false, cleanupConfirmed=true. Includes certificate-validated Node transport, unauthenticated denial, both users' Secure/HttpOnly/SameSite=Lax/Path cookies, JavaScript exclusion, preferences/reload, origin rejection, sign-out denial and distinct-user/runtime-error assertions. HTTP 10/10 remains separately recorded. This validates the local TLS harness, not a future hosted certificate/deployment.
- **Local Git initialized** by the user. E1 independently re-ran `git status --short` successfully: expected initial source/config files are untracked; no secret/artifact paths listed. Actual repository `git check-ignore -v` confirms .local/users.json, .env.local/.env.production, TLS key path, test-results, playwright-report and screenshots excluded. `git remote` empty; `git log -1` confirms no commits. No staging/commit/publication performed.
- **Confirmed user decision, 2026-10-29 IST:** manual screen-reader and real-phone keyboard/scroll checks are **Deferred—not tested** until follow-up before private beta. Do not repeatedly request them at this stage. No automated test removed and no auth/isolation requirement weakened. Formal M1 may remain partial while local synthetic/mocked prototype work can continue under a later M2 instruction.
- Foundation readiness: **ready for local synthetic M2 with mocked/disabled external services**, based on passing real Auth/RLS/admission/revocation and browser checks. Current 796 MiB storage remains an operational blocker for fresh reconstruction and a risk for further builds. **Not ready/authorized for real-data hosted use or invitations.** IMPLEMENTATION_PLAN distinguishes those gates.

## Independent repairs and source audit

1. Found a real application defect: the cookie adapter swallowed every write exception. Server Components now explicitly request read-only adapters; Route Handlers propagate cookie write errors. Proxy and handlers share HttpOnly/SameSite/Secure defaults. Four unit cases cover flags, explicit read-only behavior and propagation. No authorization or revocation rule was removed.
2. Found a harness defect: shared Alex/Sam preferences and a single-use recovery identity required reset/reuse. Tests now create random synthetic aliases per suite/project, with credentials only in memory; cleanup targets only their exact aliases. Retained development users, passwords, preferences and sessions are not the test fixture store. Session-expiry tests target the test session ID, not every session of an account. The E2 integration and browser runs exercise these fixtures; the complete email lifecycle now passes in E2.
3. Added `pnpm local:audit`: a read-only catalog/config audit reports versions, effective memberships/grants, RLS/policies, deployed helper metadata and source-body hashes/match flags, and synthetic-account/profile/admission booleans. No token, cookie, password, key, connection string, email code or Auth row is printed. Metadata inspection is not tenant-isolation evidence. Script syntax passes; its live SQL is blocked in E1.
4. Added sanitized request diagnostics: static operation names and allowlisted SQLSTATE/category/schema only. Unknown provider/error bodies are never returned or logged. SQL failures are not labeled filesystem failures.
5. Local tooling now permits only exact local CLI commands and local socket Docker contexts; remote/TCP contexts and remote/database URL flags are refused. Eight diagnostic/privacy/URL tests plus seven command/context-fence tests were added. Existing endpoint and project checks remain.
6. Source review/ignore rules: environment/fixture files and test artifacts remain ignored; sensitive `Screenshot*.png/jpg/jpeg` are now ignored without deleting user files. CI no longer resets a retained developer database; its definition uses a fresh hosted runner and per-run fixtures. Remote CI has not run.

### Privileged helper audit: source and E2 deployed metadata

| Function | Source owner / mode | Purpose and boundary |
| --- | --- | --- |
| private.auth_session_is_active | postgres / SECURITY DEFINER | Argument-free boolean; binds JWT session_id to the same sub in live Auth state; checks confirmation, ban and not_after. Empty search_path. Direct EXECUTE revoked from PUBLIC and API roles; guard only. E2 audit confirms owner, fixed path and restricted execution. |
| private.has_access | restricted guard / SECURITY DEFINER | Calls that boolean; validates admission and revocation using PostgREST transaction claims. No owner/session arguments. Empty/missing context denies; malformed direct SQL JSON/UUID context errors deny. |
| public.revoke_current_session | restricted guard / SECURITY DEFINER | Authenticated RPC, no arguments; checks has_access before recording the caller's session/user. Refresh must not bypass the recorded session ID. |
| private.admit_user | restricted guard / SECURITY DEFINER trigger | Claims only an approved admission for Auth's NEW identity; cannot be invoked as a normal API tool. |
| private.create_profile | restricted guard / SECURITY DEFINER trigger | Creates profile from Auth's NEW ID, not client metadata. |
| private.validate_profile | migration owner / SECURITY INVOKER trigger | Timezone/ownership/timestamp validation; no elevation. |

All function search paths are fixed/empty and bodies match source in the E2 audit; helper names/tables are schema-qualified. E2 confirms no temporary CREATE or application-role guard membership. The exposed API schema is public; revoke_current_session is its only application RPC. Real E2 ordinary-token tests deny private RPC/context access and tampered JWTs. Installed getClaims code verifies signature (or getUser fallback) and expiry. Catalog inspection and these API assertions are distinct evidence.

A single privileged has_access function could reduce role-transfer complexity, but would concentrate admission/revocation authority in its privileged owner. E2 audited and exercised the existing two-tier design. No material architecture/privilege change is justified by the observed selector failure.

## Executed verification — E1 restrictions and software checks (E2 supersedes live results above)

| Check | Actual result | Limits |
| --- | --- | --- |
| `pnpm lint` | Passed, exit 0 | Current source; zero warnings. |
| `pnpm test` | **57 passed, 0 failed, 0 skipped; five files** | Baseline 38 + 8 diagnostic/privacy/fence cases + 4 cookie cases + 7 Docker/CLI fence cases. Unit checks are not auth/RLS proof. |
| `pnpm typecheck` | Passed, exit 0 | Includes the new fixtures/audit call sites and browser test source. |
| `pnpm build` | Passed, exit 0; rerun 2026-10-29 IST after type generation | Current final web code compiles; browser/Auth proof comes separately from E2. |
| Clean frozen install | Passed, exit 0 | Separate temporary directory; only manifests/lock/config copied, no env/credentials. `pnpm install --frozen-lockfile --offline --store-dir <existing-store>` reused 243 packages, downloaded none; scripts were not disabled. Temporary test directory removed. Cold-network fetch not tested. |
| Local config validation | Passed | E1 shape/loopback/key class; E2 audit additionally confirms live key/API match. |
| `node --check scripts/audit.mjs` and safe diagnostic module | Passed | Syntax only, not execution of audit SQL. |
| `pnpm test:integration` | **1 setup suite failed; 0 assertions passed, 13 skipped** | Missing runtime access stops setup. Former 11 cases expanded with API context/private-helper denial and session-refresh ownership; existing cases strengthen malformed/mismatched claims, signed-token tampering, denied-write snapshots and refresh after revocation. No mocks substituted. |
| `pnpm exec playwright test --list` | 10 cases discovered | Discovery is not execution. Both desktop/mobile email lifecycles now have isolated fixtures; no intentional skip. |
| `pnpm test:e2e` | Exit 1 before tests | Server listen EPERM. **0 browser assertions executed**; do not label discovered cases passed/skipped. |
| Browser/manual probe | ERR_CONNECTION_REFUSED | No public/protected page reached. |
| Retained migration audit / fresh disposable reconstruction | E2 audit passed / fresh preflight blocked | Both versions/bodies match. E2 reconstruction exits 1 before startup: insufficient_disk_headroom; no disposable migrations executed or retained reset. |
| `pnpm db:types` | Passed (E2) + reviewed (E1) | Generated file read/compared; typecheck/lint pass. |
| Remote CI | **Not run** | Safe workflow source review only; no explicit remote-success M1 criterion. |
| Manual screen reader / real-phone keyboard | **Deferred—not tested** | User decision 2026-10-29: follow up before private beta. |

## M1-A1 through M1-A12 acceptance ledger

Rows reflect checks on **2026-10-28 E1 / 2026-10-29 IST E2**, as identified below. E2 results are user-reported automated execution. “Blocked” means required evidence remains absent; “Failed” records an executed assertion failure, even where its cause has been repaired pending rerun.

| Criterion | Status | Procedure / observed evidence | Remaining issue |
| --- | --- | --- | --- |
| M1-A1 — tooling/config/build | **Passed (E1)** | Clean frozen offline install, config validation, lint, 57 units, typecheck and build exit 0. | Live backend/key correspondence belongs to A2/A4; no cold-network install claim. |
| M1-A2 — retained incremental + disposable fresh migrations | **Blocked** | E2 read-only audit: both versions applied, all six helper bodies match source, retained three accounts/profiles intact. No new schema change needed. | E2 `pnpm db:reconstruct` blocked before startup: insufficient_disk_headroom (5 GiB tool guard). Fresh reconstruction not executed. |
| M1-A3 — approved/unapproved registration | **Passed (E2)** | Integration rejects unapproved direct signup; desktop/mobile browser registration, local email verification and expired/reused-code rejection pass in the 10/10 rerun. | No remaining local automated subcheck. |
| M1-A4 — protected pages/APIs and verified identity | **Passed (E2)** | 13 integration + both unauthenticated browser cases and protected A/B preference flows pass. | Local synthetic environment only; remote CI not claimed. |
| M1-A5 — A/B own preferences and validation | **Passed (E2)** | Both desktop/mobile sign in A/B, save/reload preferences, reject invalid timezone, sign out and lose page/API access; integration confirms own read/write and cross-owner denial. | No remaining local automated subcheck. |
| M1-A6 — real API/RLS adversarial isolation | **Passed (E2)** | `pnpm test:integration`: 13/13 passed using ordinary tokens; catalogs/fixtures are separately privileged. | No claim that remote CI executed. |
| M1-A7 — refresh/expiry/revocation/cache isolation | **Passed (E2)** | Integration proves refresh ownership, live-session expiry, admission disablement and captured-JWT/refresh denial after revocation. Both browser A→B sequences pass without content/session leakage. | Cookie deletion alone was not treated as revocation proof. |
| M1-A8 — cookies/CSRF/redirects/cache headers | **Passed (local E1/E2)** | HTTP 10-case suite and separate HTTPS 9-group runtime check pass. HTTPS cookies Secure/HttpOnly/Lax/Path; JS exclusion, own preferences/reload, origin/no-store and sign-out verified. Units cover strict redirects/body/origin handling. | Local self-signed harness only; actual hosted configuration/certificate remains a hosted-use gate, not a claimed deployment pass. |
| M1-A9 — confirmation/resend/recovery/password | **Passed (E2)** | Desktop/mobile full lifecycle passes: approved signup, expired/reused rejection, fresh resend, verification, recovery, password change and sign-in with changed password. | No remaining local automated subcheck. |
| M1-A10 — desktop/mobile/a11y | **Partial** | E2 public keyboard/focus and axe checks, protected axe/runtime errors and 390/320px reflow/reduced motion pass; final browser suite 10/10. | Manual screen-reader and real-phone keyboard/scroll: **Deferred—not tested**, explicit user decision 2026-10-29; follow up before private beta. Do not mark passed or re-request this stage. |
| M1-A11 — local safety/CI/source hygiene | **Passed (local design/hygiene)** | Unit fences/real fixtures pass; local Git initialized and actual ignore rules verified; no unexpected secret/artifact paths or remotes. CI workflow inspected: isolated local DB, no production secrets/deployment. | Remote CI **not run**; existing criteria require safe workflow, not explicit remote success. No commits yet; none created or published implicitly. |
| M1-A12 — verified handoff/types/docs | **Partial** | Existing docs reconciled to E2 evidence and test-only locator repair; lint/typecheck pass after repair. | Type generation/review and subsequent typecheck/lint pass; fresh setup reproduction remains blocked; manual follow-up is Deferred—not tested before private beta. |

## M1 reconstruction follow-up — independent of M2A

Make **at least 5 GiB disk storage available**, then pause other app/tests and run **`pnpm db:reconstruct`** from the normal terminal. Preserve its guard; no retained reset, Docker-volume prune or unrelated deletion. Expected evidence: fresh migrations/two ordinary users, disposable cleanup confirmed and scoped retained fingerprint unchanged. At the inspected 796 MiB capacity this remains blocked, so no new reconstruction or preservation comparison is claimed.

HTTPS and local Git are verified. Manual checks are **Deferred—not tested**, due before private beta; do not request them again during this stage. Remote CI remains **not run**, not an invented prerequisite. Local synthetic/mocked M2 continuation is supported by current foundation evidence when separately instructed; no M2 feature work has begun. Real-data cloud use, paid services, invitations and deployment remain unauthorized.

<details>
<summary>Historical troubleshooting observations — not current acceptance results</summary>

## Startup troubleshooting update

The user reported a successful frozen install followed by a generic `db:start` failure. This proves installation succeeded in their existing checkout; it does not establish a clean installation. The shell chain correctly stopped before setup/users/dev. Added credential-safe startup error classification and seven regression cases covering diagnostics without reflecting CLI output. The managed execution environment reports **Docker access denied**. Subsequent user CLI output identifies Docker's containerd metadata filesystem as **read-only** during image pulls. A local read-only disk check (`df -h /System/Volumes/Data`) reports 99% usage and about 3.5 GiB available; insufficient space is a possible contributor, not a proven cause of the read-only mount. A storage-specific diagnostic now takes precedence over the aggregate pull/network error, with two additional regression cases. The observed inbucket deprecation warning is separate and nonfatal; its migration is pending verification against the pinned CLI. README includes a Docker engine check and retry instructions. M1 integration acceptance remains blocked.

## Migration privilege repair

The user's latest startup reached schema initialization and failed at `ALTER ROLE ... NOSUPERUSER ...` with SQLSTATE 42501. This establishes a migration bug, superseding filesystem speculation for this specific failure. Removed the redundant ALTER ROLE and added fail-closed catalog validation for any surviving guard role. Role creation retains non-login/non-superuser/non-bypass attributes. The migration grants SET membership only to its executor, disables inherited membership, supplies temporary CREATE rights for function ownership transfer, completes function grants before transfer, then revokes those CREATE rights. Application roles receive no guard membership.

Added a live catalog acceptance check for guard attributes, function ownership and absence of application SET/schema CREATE privileges. These privileged catalog assertions supplement, and do not replace, ordinary-user RLS assertions. Updated startup diagnostics to identify SQL role errors separately from filesystem permissions. Lint, all 25 unit tests and type checking pass. The integration suite still exits 1 before setup here (one failed suite, ten skipped tests): Docker access remains sandbox-blocked. The repaired migration has not been executed here, and M1 remains incomplete. Next user action is a non-destructive startup retry; no volume deletion/reset is prescribed.

## Optional Edge Runtime startup repair

The latest user output shows the repaired migration and seed completing, followed by a 503 from `supabase_edge_runtime_jarvis-foundation`. This is progress beyond the migration failure; it is not proof of authentication or isolation. M1 implements HTTP endpoints in Next.js and has no Edge Functions. Set `[edge_runtime].enabled = false` in the shared local config, using the officially documented option, so direct and wrapped startup omit that unused service. Required-service health checks remain enabled; no ignore-health-check flag, data reset or credential change was added. The 503's underlying cause is not established.

Lint, 26 unit tests and type checking pass. Python 3.11 TOML parsing confirms Edge Runtime disabled and Auth/API/seed still enabled (the default Python initially lacked tomllib). Successful runtime startup with this config remains pending user retry; managed Docker access is still blocked. Next step: `pnpm db:start`, then setup/users/dev on success, followed by the real integration and browser acceptance checks.

## Email verification repair

User screenshots show code rejection on `/verify` for a synthetic account, with a local Mailpit tab open. The screenshots do not establish whether the code was expired, already used, from recovery or rejected because of an integration issue. The displayed code was not used, copied into source or logged. Both screenshots show the same state.

Source/official review found deprecated `signup` OTP verification and no in-form resend or purpose indicator. Changed signup verification to documented `email`, kept recovery distinct, added a purpose label/mode switch and request-new-code control, and clears entered codes on resend/mode change. Added fixed error classes for rejected codes, throttling and service failures without returning raw provider data. Successful verification now requires a returned session. The resend operation still correctly uses `signup` in its separate API.

Added seven unit boundary/error privacy cases (33 total) and expanded Playwright purpose-switch/resend flows. Lint, all 33 unit tests, type checking and the production build pass after this repair. Public Playwright startup still fails with EPERM before assertions. These unit/contract checks are not authentication evidence. Live reproduction remains blocked by local listener/Docker permissions in this managed environment; the user must retry with a fresh code in the matching mode. No bypass, user confirmation override or database reset was added.

## Missing resend email investigation

The user could not find a new code in Mailpit. Source inspection found that resend/recovery errors were ignored. The endpoint now reports fixed throttling/infrastructure failure messages while keeping account-specific eligibility outcomes generic; copy no longer asserts email delivery. Added two unit cases (35 total) for error privacy/eligibility equivalence. Added `pnpm local:diagnose`, a read-only local operator tool limited to synthetic account confirmation state, Mailpit connectivity and matching fixture message counts/kinds; no IDs, keys, passwords, codes or bodies are printed, and its admin client is never in web requests.

Managed HTTP access to the mailbox is blocked/unavailable; the diagnostic itself stops at Docker permission denial here. The user's account state and reason for the absent mail remain unconfirmed until their diagnostic runs. No account was changed, confirmation forced, reset performed or email sent by the agent. The initial mailbox code/expiry hypothesis is not treated as proven.

## Valid password denied profile access

The user's exact error is emitted after Auth password acceptance when the profile query has no row (or previously hid a query error). Official Supabase Auth migrations enable RLS on `auth.users` and `auth.sessions`. Our non-bypass guard had SELECT grants but no matching policies, so its live-session lookup could not see Auth rows. This is a concrete SQL authorization defect consistent with the reported login rejection; it does not prove there are no additional runtime issues.

Added an incremental migration instead of editing/resetting the applied foundation: a fixed private function owned by local postgres checks only the caller's Auth session/email/ban/expiry and returns a boolean. It has no arguments, empty search_path, and no direct execution grant to API roles; only the guard can invoke it. Existing guard admission/revocation and profile ownership/RLS checks remain. Direct guard SELECT on Auth tables is revoked. Added live catalog assertions for helper ownership/execute grants. `pnpm db:migrate` applies pending local migrations without resetting records, using a verified CLI command/flag. Profile-query errors now produce a service error instead of blaming credentials.

Lint, 35 unit tests, type checking and production build pass. Local migration execution and integration acceptance remain blocked in this managed environment by Docker access; the installed CLI help confirms `migration up --local` support. The user's exact next action is `pnpm db:migrate` then retry sign-in. Real isolation tests must still pass before completion. No password, key, verification code, account confirmation or ownership was overridden.

## Follow-up migration diagnostic

The user reported the wrapper's generic permission-denied response from `db:migrate`. It does not identify the failed SQL or establish a filesystem cause. Corrected diagnostic classification for schema/function/table privileges and SET ROLE failures, with three credential-suppression regression cases. No further SQL privilege change is justified until the underlying error is available. Next diagnostic is `pnpm exec supabase migration up --local` in the user's terminal; share only ERROR/SQLSTATE and the failed statement, never keys or full debug output. No reset or permission weakening is prescribed.

## Guard Auth-schema lookup follow-up

The direct CLI error identifies `auth.uid()` resolution under the guard role during replacement of has_access: the original Auth-schema usage grant is not effective in this environment. Instead of widening managed-schema permissions, the still-pending migration now reads only sub/session_id from PostgREST's verified transaction-local request.jwt.claims in both has_access and revoke_current_session. NULLIF handles empty settings. The narrow privileged Auth-session bridge remains responsible for live session/email/ban/expiry checks; guard admission/revocation and profile ownership remain enforced. Temporary CREATE is confined to application schemas and revoked afterward. No access to managed Auth rows is added to the guard.

Added a real-role regression for absent/empty identity in addition to the existing real A/B read/update and revocation tests (eleven integration tests total). Lint, 38 unit tests and type checking pass. Local migration application again stops at sandbox Docker denial; the integration suite fails setup with eleven skipped assertions. SQL execution and successful sign-in remain unverified here. The user should retry the pending local migration; no reset, new credential or confirmation bypass is required.


</details>

</details>

</details>

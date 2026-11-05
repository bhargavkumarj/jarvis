# Move JARVIS to another machine

Prepared 2026-10-31; finishing update 2026-11-01. This is a local-development runbook, **not evidence that migration, restore or live acceptance passed**. Mocked runtime verification is now authorized, but the latest preflight below is blocked; live calls are outside this verification phase. Use synthetic data first; M1 and full M2 remain unaccepted. Current implementation/evidence: [STATUS](STATUS.md).

## Computer control v1 — 2026-11-05 (source + Linux verification; Mac unverified)

New: `packages/computer-control-contracts/`, `apps/jarvis-browser-bridge/`, `apps/jarvis-mac-companion/`, `src/lib/computer/`, `/api/v1/computer/*`, Settings → Computer, Assistant action card, migration **`202611050001_computer_control.sql`** (after 005). Read COMPUTER_CONTROL.md and MAC_COMPANION_SETUP.md.

**Blocker first:** `202610310004_privacy_center.sql` fails to apply (SQLSTATE 42601 in `privacy_command_v1`, then two ownership/ACL permission errors). Fix and approve 004 before `pnpm db:migrate` on the laptop; the computer migration depends on 004/005. Do not mark versions applied by hand on a retained database.

Then, on the Mac: `pnpm db:migrate` → `pnpm build && pnpm start` (or `pnpm dev --port 3000`) → `pnpm bridge:build` and Load unpacked → `cd apps/jarvis-mac-companion && ./scripts/install-dev.sh` → approve items → Settings → Computer → Turn on → Pair this Mac. Developer checks that need Docker: `pnpm companion:test` (Swift core in a container on non-Mac hosts), `pnpm bridge:check` (needs a Chrome that honours `--load-extension`, e.g. Chrome for Testing), `pnpm companion:e2e` (local Supabase + build + Docker). On a Mac, `pnpm companion:test` uses the local Swift toolchain. Never run unknown Shortcuts in tests.

## Latest runtime preflight — 2026-11-01 (existing laptop checkout)

The context was restored and scripts inspected. **No database/runtime acceptance advanced.** Existing dependencies match all 27 exact manifest pins (Node 24.14.1/pnpm 10.34.9); no reinstall/extraction. Required config is present/local/publishable, values suppressed. Git remains untracked/no commits; an `origin` name is now present and was left unchanged. New user work and previous archives were preserved.

This managed terminal can inspect a local Docker context but cannot access its daemon (**execution permission**). A separate validated restricted-worker read-only connection to loopback:54322 also fails **EPERM before SQL, no SQLSTATE**. No actual server identity/health/migration history or retained data/backup was established; never assume the database is empty or stopped. No local listeners were visible to the port inventory, which is not proof of host service absence under these restrictions. Disk probes showed ~2.0 then 3.85 GiB available, both below the existing 5 GiB temporary-filesystem reconstruction guard. No service start, reset, prune, migration or repeated connection attempt occurred. Chromium binary is present; bounded OpenSSL version probe did not establish availability (cause not diagnosed), so later HTTPS setup still needs prerequisite verification.

Independent current results: `JARVIS_MOCK_ONLY=1 pnpm lint`, `pnpm typecheck`, `pnpm test` **pass (357 units/mocks, 32 files, no failures/skips)**; source script syntax checks pass. Production build is historical, not rerun. Fresh verification of the entire 17-file chain, current `db:types`, 109 real integration/14 process/42 browser/nine HTTPS groups was not executed in this attempt; older applied-migration evidence remains historical. No model/phone/physical voice/manual-a11y or remote CI acceptance.

**Next single diagnostic:** `pnpm local:audit` from a normal terminal permitted to access the existing local runtime; share only its sanitized result. Do not migrate/reset or send yet. The read-only catalog check is needed before deciding retained protection versus a separate synthetic runtime. Do not paste raw Supabase status, keys, URLs with passwords or private file contents. If unavailable, preserve that failure; do not loop or invoke reset. Disk headroom is independently required before reconstruction.

### Sign-in diagnostic follow-up (2026-11-01)

The user-reported sign-in error is emitted by password Auth before the profile query. Only a diagnostic startup banner was subsequently supplied; its account-state result/root cause is still unknown. The local diagnostic now prints safe phases and bounds read-only context inspection (5s), Supabase status (10s), Auth fetch (5s) and Mailpit (5s). It preserves local/remote target fences and never changes a password or account. Mutating migration/start/reset execution did not receive a new kill timeout.

If an older diagnostic is waiting, Ctrl+C that read-only command, then run **`pnpm local:diagnose` once** in the normal permitted terminal. Share the phase/result or fixed timeout, never `.local/users.json`, keys, codes or raw Supabase status. Do not reset data based on this generic sign-in error. After account-state inspection, the read-only `local:audit` target/history check remains required before migration/fixture writes.

**User-terminal result after that repair:** diagnose now returns the safe runtime-phase **10-second Supabase status timeout**, exit 1. No Auth/SQL check was reached. Do not repeat status unchanged or infer invalid credentials. The next bounded manual observation is `docker info --format '{{.ServerVersion}}'`: share only the version/first error, or Ctrl+C after 10 seconds and report a hang. This is read-only; actual engine health versus CLI/runtime state is not yet distinguished. No service restart/reset/prune or account mutation has been performed.

Tooling verification here: targeted 36 tests, full **362 unit/mocked tests (33 files, no failures/skips)**, lint/type checking and both edited script syntax checks pass. Five additional mocked subprocess/HTTP cases cover timeouts, no retries, redaction, mutation-timeout exclusion and cancellation; they are not Docker/Auth/DB evidence. No runtime retry, migration or live provider call was made. Existing candidate archive is preserved; current source transfer must include these updated scripts/tests as well as documents using a new archive name.

### Current recovery priority: unreachable local Auth (2026-11-01)

The website now has user-reported status-0 `AuthRetryableFetchError: fetch failed`; local audit blocks before SQL and status diagnostic times out. These are transport/runtime symptoms, not proven bad credentials or a SQL privilege failure. Agent-read `.env.local` targets expected loopback ports, but runtime health/loaded config/retained data remain unknown. No engine health response was supplied, so repeated Supabase status checks add no evidence.

Stop only your foreground web/worker/finalizer processes (Ctrl+C) before host recovery, keeping live dispatch disabled. Open Docker Desktop; if starting/unresponsive use **Troubleshoot → Restart Docker Desktop**. Do **not** choose Clean/Purge data/factory reset or prune volumes. After the engine reports running, run one read-only `docker ps -a --filter name=jarvis-foundation --format '{{.Names}}: {{.Status}}'`; share only names/status (if stuck, Ctrl+C after 10 seconds). This identifies existing stopped/unhealthy services without creating a new database or applying migrations. No Docker action has been performed automatically. Current official recovery menu reviewed 2026-11-01: https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/ . If Docker reports a storage/startup error, preserve/share that specific sanitized message instead of resetting.

A focused source fix now reports unreachable/retryable/status-0 Auth as service **503** rather than invalid-credential **401**. Account-specific errors stay opaque; throttling, CSRF and profile/session/RLS checks remain unchanged. Fresh lint/types/**371 units (34 files, no failures/skips)**/production build pass. Nine new unit/mocked HTTP/classifier cases do not prove actual Auth recovery. No credentials/schema/permissions changed, no live call, no new subsystem. Current scripts/source are newer than the preserved candidate archive; use the existing allowlist and a new archive name for a later transfer. Full runtime suites, migrations, model/phone/device/manual evidence remain pending.

### Target isolation rule before any test writes

The existing harness is **not automatically a disposable database harness**. `localStatus()` fixes `jarvis-foundation` at API 54321/DB 54322; the worker config checks that local database and restricted principal. Random synthetic aliases/queues identify test-owned records, but full integration/worker/browser/HTTPS suites still connect to that same underlying database. They create/delete Auth fixtures and some run maintenance/catalog operations. `JARVIS_MOCK_ONLY=1` disables live providers; it does not isolate database writes or stop an already-running normal worker/finalizer.

`pnpm db:reconstruct` is the separate random-project/55320–55324 path, guarded at 5 GiB, with a read-only retained fingerprint before/after. It cleans up its stack on exit and proves only its documented reconstruction/profile checks; **the later full suites do not automatically run there**. Do not set an arbitrary DATABASE_URL or weaken fixed-port/project guards to imply otherwise.

Prefer an explicitly fresh, separate local Docker engine/VM or synthetic-only new-machine environment for the **full** suite sequence below. Verify its database has no retained personal accounts/content, keep providers mock-only, keep normal worker/finalizer off while fixtures own their scopes, and create its local config/worker credential safely. If this engine already contains retained jarvis-foundation data, do not use fresh setup as a replacement/reset. Follow the optional encrypted backup/isolated-restore/deletion-ledger procedure before any retained migration; no such protection is verified here. Without it, continue isolated verification only. Inspect real versions and partial schema state; preserve applied migrations, fix actual failures additively, never mark versions applied by hand.

The previous candidate source archive is preserved unchanged. These latest preflight notes are in the current working STATUS/MACHINE_HANDOFF; source transfer should include the current documents using the allowlist below and a new archive name. No application or migration code changed in this preflight attempt.

## Requirements and safe source transfer

- Node **24.x** (current checks use 24.14.1), pnpm **10.34.9**. Preserve `pnpm-lock.yaml` and package pins; OpenAI 7.45.1, pg-boss 12.38.0/schema 46, Temporal 0.5.1, Next 16.4.3, Postgres client 3.4.9. No global Supabase/pg-boss install is needed.
- Docker Desktop/compatible **local** engine, Supabase CLI **2.122.0** installed by pnpm, local Postgres **17** from `supabase/config.toml`, registry access. Windows: use a consistent Linux/WSL development environment and a local supported Docker endpoint; cross-platform handoff has not been executed.
- Free disk for dependencies/images/database/build. The separate `db:reconstruct` script enforces **5 GiB available in the OS temporary filesystem**; this is a minimum guard, not a complete capacity estimate. It also needs unused ports 55320–55324. Normal services use 3000 and 54320–54324; tests additionally use 3100/3443.

Git is initialized but source is currently **untracked**, with no commits; an `origin` remote name exists and must be preserved. No remote operation has been performed. A clone or `git archive HEAD` will not transfer this work. Do not publish implicitly. Copy this explicit source set (or make a reviewed local commit first). From the old project root, after reviewing file names:

```bash
mkdir -p .local/transfer
COPYFILE_DISABLE=1 tar --exclude='supabase/.temp' --exclude='supabase/.branches' \
  -czf .local/transfer/jarvis-source-20261101-personal-candidate.tar.gz \
  .env.example .gitignore .npmrc .github *.md \
  package.json pnpm-lock.yaml pnpm-workspace.yaml \
  eslint.config.mjs next-env.d.ts next.config.ts postcss.config.mjs \
  tsconfig.json playwright.config.ts vitest*.ts scripts src supabase tests
tar -tzf .local/transfer/jarvis-source-20261101-personal-candidate.tar.gz
```

Use a new archive name if that file already contains work to preserve. Review the listing: it must exclude `.local/`, `.env.local`/other secret env files, `.git/`, `node_modules/`, `.next/`, `.pnpm-store/`, test-results/reports, screenshots and database dumps. `.env.example` contains names/descriptions only. Copy **only that source archive**, not its parent `.local` folder, over trusted storage/transport. Extract into a new empty directory on the new machine. Source copying does **not** transfer Docker volumes, retained records, account identities or credentials.

## Fresh synthetic development environment (new machine only)

Ensure this Docker engine has no retained `jarvis-foundation` project you might overwrite. If one exists, audit and preserve it instead of treating it as empty. From the extracted project root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:start
pnpm db:migrate
pnpm local:setup
pnpm local:users
pnpm worker:setup
pnpm db:types
pnpm local:audit
```

`db:start` initializes a genuinely fresh stack from migrations/seed; `db:migrate` applies pending additive changes to either a fresh or retained stack. **No reset is a setup prerequisite.** `local:setup` generates ignored `.env.local` from local runtime values and refuses to replace an existing file. Required names: `APP_ORIGIN` (http://127.0.0.1:3000), `SUPABASE_URL` (local API), `SUPABASE_PUBLISHABLE_KEY` (anon/publishable only). No ordinary web service/admin/database key belongs there.

`local:users` creates/preserves retained synthetic Alex/Sam accounts and writes random passwords privately to ignored `.local/users.json`; inspect locally, never paste into chat. `worker:setup` creates the private queue and restricted runtime credential in `.local/worker.json` (0600). Installation uses local operator rights; the worker has no queue-schema CREATE, Auth/profile read or role escalation. Review regenerated public types against `database.types.ts` (safe-column usage contract intentionally omits private settlement hash/scope fields), then run `pnpm typecheck`.

Open separate project terminals:

```bash
pnpm dev --port 3000
```

```bash
pnpm worker
```

Open http://127.0.0.1:3000/sign-in. Keep one web listener on 3000 to match Origin/CSRF rules. Mailpit is http://127.0.0.1:54324; local verification emails do not go to Gmail. The worker, Docker/Postgres and awake host are needed for reminders; the website can close. `pnpm build` then `pnpm start` is the alternative production-mode web path, not a second listener. Ctrl+C stops your own foreground processes.

## Personal-version candidate: final source delta and first smoke

**Personal-version implementation candidate prepared; runtime acceptance pending.** Use STATUS's single consolidated capability/evidence ledger. Source checks executed on 2026-11-01: lint/types, **357 units/mocks (0 failed/skipped)**, production build, script syntax and archive inspection. No runtime command in this guide was executed as part of that finishing pass. Remote CI not run; manual screen-reader/phone checks Deferred—not tested. Do not infer live reliability from unit totals.

New additive **202610310005_personal_finish.sql** follows all 16 prior migrations. It adds `profiles.onboarding_completed_at`, backfills existing accounts (no forced questionnaire), and grants UPDATE on that column under existing profile RLS. No new function/role/admin/worker privilege. New accounts see an optional Quick setup link in Assistant; `/welcome` asks name/style/zone, offers save/skip and is always reachable from Settings. It grants no cloud, microphone or phone consent. The new field is included in safe profile export. Apply the entire pending sequence **010 → 202610310001 → 002 → 003 → 004 → 005** in order; inspect actual history first. Generated types remain historical until `pnpm db:types`; the application contract labels pending fields/RPCs provisional. Missing schema fails unavailable rather than claiming a successful save.

Fresh setup/startup above remains exact. For a retained target, first stop only your own web/worker/finalizer, preserve data/history/newer deletion/consent/budget records, then `pnpm db:migrate`, `pnpm worker:setup`, `pnpm db:types`, `pnpm local:audit`, and `pnpm typecheck`. Do not run new code against partially applied migrations, mark unapplied SQL as applied, reset data or broaden privileges to get past an error. Operator repair 010 still requires actual no-send `--check`/ACL proof. Static signature checks do not establish deployed permissions or SQL validity.

Focused new checks on the other machine, **written—not executed**:

```bash
pnpm test:integration tests/integration/personal-version.test.ts
pnpm build
pnpm test:e2e personal-version.spec.ts
```

Expected: **two** real DB cases, **four** browser cases. Then run the complete sequence below (**109 DB / 14 worker / 42 browser / nine HTTPS groups**) with normal worker/finalizer stopped while fixture harnesses own their scopes. New cases cover setup save/skip without implicit consent, actual A/B profile updates/unchanged target, initial actions drafting only, sign-out during streaming, back navigation and account switching. Existing Settings/HTTPS status assertions are now scoped to their preferences form; no check is disabled. These and all other runtime tests remain unexecuted here.

### First integrated smoke — later, after synthetic regressions

Preconditions: fresh/retained setup and current-schema isolation tests pass; chosen admitted account is registered/verified. Configure Pushover and a qualified selected OpenAI model through the **Private configuration** section below. Complete its one generic phone test/standalone scheduled prerequisite and bounded evaluation before this full smoke; review dated price/account controls before any paid call. Recreate credentials locally (no source-copy secrets), restart processes, and explicitly enable that account's separate text/notification permissions. Budget/evaluation totals must carry over; no contingency increase or automatic recharge. Stop normal processes before fixture suites, then start web and worker in separate terminals. Keep `.local/worker.json`, `.local/live.json` and keys private.

1. **Sign in** at `http://127.0.0.1:3000/sign-in`. Optional Quick setup: confirm assistant name/style/IANA zone or skip; inspect provider readiness. No setup consent is assumed. Choose OpenAI only when configured/permitted; a mock smoke is explicitly not live acceptance.
2. **Converse:** send one short synthetic message. Observe a completed response, not just a streaming preview; record model and numerical estimated usage. No paid failure tests.
3. **Approve a memory:** explicitly request a synthetic study preference; open Memory, inspect/edit exact proposal, review conflict disclosure and approve the exact current version. A proposal is not approval.
4. **Recall in another conversation:** start New conversation and ask about that same study preference. Inspect “Used approved memories”; verify the correct approved content. Rejected/deleted records must not enter later context. This is observed evidence, not inferred from the model's claim.
5. **Create a task** in Today, e.g. a synthetic assignment; optional deadline is independent of notification scheduling. Open its details and separately review a **linked one-time Pushover reminder** a few minutes ahead. Check full date/local time/fixed IANA zone/UTC/channel/task and reminder versions; confirm exact values. Record the committed operation ID and actual scheduling state.
6. **Close the website**. Keep the host awake with local database/queue and `pnpm worker` running. Observe the Android phone separately; reopen Today and inspect attempts. Record operation commit, scheduled state, provider acceptance and yes/no phone arrival with approximate time as **separate evidence**. Acceptance/unknown is not device receipt or a recalled notification; no blind repeat sends.

Then, using **synthetic content**, check recurrence daily/weekly preview/offsets, fixed zone, pause/resume/skip/edit and one-occurrence snooze on the explicit **mock channel**; do not generate live notification floods. Verify upcoming work and restart through the real fixtures, not browser timers. Voice: begin with explicit mock transcription/review/edit/Send and local-voice read-aloud/Stop; actual microphone formats/release, OS locality and phone compatibility need the separate device checklist below. Live transcription remains off until its disclosure, private configuration and separate consent; any later live use must fit the unchanged AI cap and reviewed audio price.

Export: use Privacy Center's current password verification, download private JSON, inspect ownership/required categories, keep it outside source, and protect/delete that local file yourself. Change retention on synthetic history, confirm a shorter period, verify expiry exclusion before/after the running worker. **Destructive checks are separate:** use a different isolated synthetic account with mock channels and no personal provider binding; test item/bulk deletion and finalizer partial-failure/resume there. Never delete the retained personal phone account or use production/retained personal content to prove failure fixtures. Ordinary worker must run for cleanup; separate `pnpm privacy:finalizer` is needed only for already-confirmed account erasures. Start it only after fixture suites; do not leave it racing staged assertions.

### Known limits and recovery

Status is explicit: local mock, missing config, configured-disabled, missing consent, ready or unavailable; a status read is not a paid service probe. AI/speech failure/budget exhaustion leaves manual tasks/reminders available. Disabling Pushover sends does not erase keys or cancel schedules; due attempts may fail within existing bounded policy. Failed/unknown results do not replay on re-enable. No proactive check-in/briefing feature exists. Disconnecting a private channel requires local configuration removal and worker restart; cancelling is an explicit Today operation. Already authorized requests cannot be recalled. No mock→live conversion.

Uncertain UI writes retain request IDs where operations support dedupe; refresh actual state before changing arguments/retrying. A shorter retention/data erasure invalidates old context. Session/privacy changes stop active streams/capture/playback; confirmed sign-in/out reloads other tabs. Where BroadcastChannel is unavailable, cross-tab UI clearing is not guaranteed, but every API/RLS call still derives verified identity. Initial markup/build is not visual/a11y evidence. Backups, restore/deletion replay, provider/key revocation and physical-erasure guarantees remain separate unverified operational gates; the detailed recovery sections below apply unchanged.

No new subsystem/processor/dependency. Daily briefings/check-ins/beta/billing/smart-home/advanced realtime voice remain later roadmap. The archive is a source candidate, not a database transfer or accepted release.

## Privacy Center: source, migration and recovery (new machine only)

**Source implemented, runtime acceptance pending.** New **202610310004_privacy_center.sql** is migration file 16, after the entire earlier chain. Pending minimum sequence remains 202610290010 → 202610310001 recurrence → 002 voice → 003 tasks → **004 privacy**. Preserve actual applied history; do not edit/mark applied/reset to bypass an error. Generated types remain pre-feature until regenerated against the real new schema.

1. Use fresh synthetic setup above, or quiesce only your own web/normal worker/finalizer on a retained target and preserve data/backup/history first. Run `pnpm db:migrate`, `pnpm worker:setup`, `pnpm db:types`, `pnpm local:audit`. Never start new processes against partially migrated schema. No destructive rollback is assumed safe.
2. Inspect deployed privacy settings/jobs/events/retired-request/cost tables; fixed search paths/guard ownership and defaults; same owner constraints; no guard profile SELECT, no Auth or DDL access for ordinary/worker roles, and no API access to private delegates/maintenance/finalizer. `privacy_finalize_v1` is **postgres only**. The intentional anonymous exception is `privacy_receipt_v1`: a 256-bit secret/hash-bound status/retry capability returning only progress, not content/new deletion. The existing narrow postgres Auth eligibility bridge stays privileged, not its application callers. Temporary guard CREATE must be revoked. Read the source inventory in ARCHITECTURE.
3. Run the focused checks below before ordinary personal use. **Keep your normal worker/finalizer off during fixture suites**: test harnesses own their random accounts/queues and direct cleanup leases. Do not let a normal finalizer race a synthetic test's staged assertions. Supabase remains required on the new machine; none of these commands ran on the old laptop.

```bash
pnpm test:integration tests/integration/privacy.test.ts
pnpm test:worker -t 'privacy task/reminder erasure'
pnpm build
pnpm test:e2e privacy.spec.ts
```

Expected: **13** real DB cases; **one** real worker-process case; **four** desktop/mobile browser cases. Then the full regression sequence below: **109 DB / 14 worker / 42 browser / nine existing HTTPS groups**. The HTTP fixture checks HttpOnly receipt; unit checks Secure over HTTPS. Actual new privacy receipt flags/export/cache/consent behavior over HTTPS still needs explicit runtime evidence; the older nine groups cover foundation behavior, not all new privacy controls. Source checks here: lint/types/**334 units/mocks**/build; mocks are not DB permissions, lock/restart, physical erasure or device evidence.

After synthetic suites pass, normal local processes in separate terminals:

```bash
pnpm dev --port 3000
```

```bash
pnpm worker
```

```bash
pnpm privacy:finalizer
```

The third command is a **separate local operator process**, using the existing guarded local status/operator connection and supported Auth admin API. It processes only already-confirmed account-erasure jobs; it is not a web request capability or part of the reminder worker. No new environment variable/admin web credential is needed. It polls until Ctrl+C; `pnpm privacy:finalizer --once` processes at most one eligible job. Command syntax/source are checked, **startup/processing not executed here**. Keep the host/database/worker running for retention/bulk cleanup; the finalizer is additionally required for account credential/Auth completion. Website presence is not required.

Settings → Privacy Center: text AI, audio and notification choices are separate. Existing configured approvals are backfilled; new accounts default off, including audio's separate disclosure/version gate. Locally configuring a key alone does not enable privacy consent. Off blocks new server dispatch; an already-authorized request cannot be recalled. Text off does not cancel reminders. Export/bulk/account erase needs password AMR ≤5 minutes; use the page's Verify password form (refresh/OTP alone is not proof). Export limits are 100 rows/page, 10k/category, 40k total, 32 MiB/two minutes, one/account and two/process; SQL limits three starts/minute. It may reflect concurrent edits and is not a transaction snapshot. No partial download is offered; larger async exports are not implemented.

Verify dependency behavior with synthetic data: history deletion preserves approved memories but removes source links/proposals; memory deletion clears retrieval/derived replies yet leaves source text unless separately deleted; tasks/reminder erase cancels unsent work and removes history but cannot retract phone copies. Test stale streamed actions, reused retired UUIDs, expired sources, direct Data API attacks, sequential A/B export pages, privacy disablement between reserve/dispatch and an active worker attempt. Test queue enqueue/erase races plus newer valid reminders, then the rotating orphan sweep. Bulk cleanup temporarily blocks new content actions; status/settings/reauth remain available. Conversation expiry is enforced by DB gates even before worker cleanup (7/30/90/365 elapsed days, default 30; extending never revives expired content).

**Account erasure recovery:** states progress through queued/running → waiting external → complete, or failed with a fixed code. No completion until Auth identity absence is checked. UI receipt lives at `/privacy/deletion`, reachable from sign-in, with HttpOnly secret; keep it for status/resume. A lost initial response can use the still-live session for own status, but after session/receipt loss the local operator must inspect minimal `private.privacy_jobs` metadata. Failed external work retries with bounded exponential backoff (eight automatic failures); UI receipt can request the same erasure again, not create another. For an exhausted account job, the local operator may run:

```bash
pnpm privacy:finalizer --retry JOB_UUID --once
```

Replace only JOB_UUID with the existing deletion receipt ID. This resets **that confirmed incomplete account job**, not an arbitrary owner. If its phase is content/queue, restart the ordinary worker to resume; if external, finalizer resumes it. Never broaden grants, re-enable admission to test the account, run raw Auth-table deletes, reset queues or delete another owner's configuration. The finalizer safely repeats preparation, removes only same-owner regular mode-0600 live/evaluation files, preserves other owners' files, transfers numerical cost totals once, and calls supported hard Auth deletion. `user_not_found` is accepted only when SQL then confirms identity absence. A failed finalizer may have erased some data already; there is no undo/false completion. Partial file/SDK failures need isolated synthetic recovery proof on this machine before retained use.

Retained exceptions: minimal complete receipts/events 30 days; unresolved jobs until recovery; retired request IDs until account deletion; unlinked monthly cost totals 13 months and initial-evaluation carry until that policy is retired. Provider-side key/account revocation, already-loaded process memory, downloaded files, developer Mailpit/fixture/system credential files, logs and OS/Docker backups are outside immediate app erase. No secure physical erasure, provider recall, E2EE or backup-expiry claim. **No real account erasure/live provider test is needed to prove failure fixtures.**

Backup/restore remains a separate unverified gate. No app backup automation exists. Before an old snapshot is activated, keep all providers/workers/web/finalizer off, preserve newer encrypted deletion/consent/budget/revocation records separately, reconcile erasures/retired requests/expiry/queues, then prove no replay with synthetic mocks. Do not assume a source archive carries a database or that restoring a snapshot carries newer deletion records. The 5 GiB disposable reconstruction guard remains unchanged; quiesce the finalizer as well as web/worker before retained fingerprints. Audit now correctly tracks function renames/schema movement; fingerprint ordering handles owner-keyed voice/privacy tables and composite metadata keys. **Neither schema audit nor reconstruction ran here.**

## Task increment: additive migration and verification (new machine only)

**Implemented, not runtime-accepted:** new `202610310003_tasks.sql`, after the complete existing chain (15 migration files total), including still-pending 010/recurrence/voice. It adds owned tasks/task operations, conversation focus and same-owner/same-task one-time reminder references. Existing task operation records hold IDs/hashes/minimal state, not task title/notes. New guard-definer task RPCs and worker fences retain restrictive ordinary user/worker access; no Auth grant/dependency/admin web request. Generated database types still reflect the last real schema, not this source increment.

Use the fresh setup above, or on a retained target: quiesce only your web/worker, preserve retained data/backup, inspect history, then `pnpm db:migrate`, `pnpm worker:setup`, `pnpm db:types`, `pnpm local:audit`. Do not start the new worker against an older schema. Audit task RLS/SELECT-only client grants, helper/delegate EXECUTE denial, empty search_path/guard ownership, revoked temporary CREATE, composite links and nullable-pointer cleanup. Review the generated contract; do not replace `database.types.ts` blindly. The prepared 010 remains operator-only EXECUTE, not a general privilege workaround.

After audit, focused checks (all **written—not executed on this laptop**):

```bash
pnpm test:integration tests/integration/tasks.test.ts
pnpm test:worker -t 'task completion|accepted task notification'
pnpm build
pnpm test:e2e tasks.spec.ts
```

Expected: **12** ordinary-identity DB cases, **two** real-process worker cases, **four** browser cases. Then run the full regression sequence below (**109 DB / 14 worker / 42 browser / nine existing HTTPS groups**). No mock unit test establishes these outcomes. Browser 3100 and HTTPS 3443 are owned by their harnesses; no second manual web process on those ports. Keep live providers disabled for automated fixtures.

Manual synthetic task smoke test after these pass: Today → Add task without reminder → detail → date-only deadline in saved timezone → save/reload. Check no notification was scheduled. Separately review/confirm a generic linked mock reminder. Complete before dispatch and verify cancellation; reopen and verify no new job. Repeat with an in-flight mock fixture and retain its actual outcome. Edit the deadline and observe unchanged reminder time; explicitly review a replacement if wanted. Cancel/remove the reminder and keep the task. Delete a task with confirmation; ensure content is gone while generic attempts and minimal receipts remain. Chat: create proposal → exact review; “Make it due Friday” clarifies; ambiguous titles never auto-select; temporary typed/voice inputs persist no task. Keyboard/reflow/axe are prepared, not certified; deferred physical-device/screen-reader observations remain pending.

Deadline policy: date-only has saved IANA zone and no UTC instant; overdue from next local day. Exact-time overdue at resolved instant. None never overdue. Profile/device zone change does not move it. Gap times reject/folds require choice. A task can have no reminder. Delivery never completes tasks; reopen never reactivates old reminders. Any notification already in flight cannot be recalled. A newly confirmed replacement may coexist with an already authorized old send; the UI discloses that race.

If migration fails: retain first sanitized SQLSTATE/routine/line; inspect history and actual schema/transaction outcome. Preserve successfully applied files; use additive repair if deployed changes require one. Do not manually mark applied, reset data, remove queue tables, broaden grants or assume destructive rollback is safe. Keep worker off until schema/permissions pass. New nullable composite-FK actions require the pinned PostgreSQL 17. Fresh reconstruction is still separately unverified and keeps the 5 GiB guard.

At the task checkpoint, task content remained until deletion, with no automatic task expiry (still the content policy). Source chat follows its existing 30-day history; deleting a task does not redact old chats or independently approved memory. Generic reminder/attempt history and minimal task-operation hashes/IDs/timestamps remain. The later Privacy Center above now covers app export/erasure in source; runtime acceptance and backup/deletion-replay guarantees remain open. No project/subtask/collaboration/recurring-task/calendar system was added.

## Voice increment: migration, opt-in and verification (new machine only)

New additive **202610310002_voice.sql** follows the complete existing chain including the still-pending **010 operator repair and 202610310001 recurrence migration**. It adds default-off owned voice consent, private server transcription flags and duration price/metadata to the existing AI ledger. Old text-accounting functions become private delegates behind wrappers that deny duration-as-token settlement. The same global lock/monthly sum/caps are used. No existing migration was edited; no audio/transcript column, storage bucket, admin ordinary web client, Auth grant, worker permission expansion or new package was added. Generated schema types remain old until the actual `pnpm db:types` run. Review the narrow application contract after generation.

Use the fresh/retained setup and full commands below, including 010 grant checks. With normal workers stopped, additionally isolate the affected checks:

```bash
pnpm test:integration tests/integration/voice.test.ts
pnpm test:e2e tests/e2e/voice.spec.ts
```

Expected **12 real DB cases** and **six controlled browser cases** (desktop/mobile), all **written—not executed on the old machine**. At the voice boundary these were 82/30/11; current declared suites including privacy: **109 DB / 42 browser / 14 worker / 9 HTTPS groups**, all deferred here. The browser capture/speech fixtures are simulated APIs and synthetic audio—not proof of physical microphone/codec/voice or phone compatibility. New pending DB tests cover A/B/RLS, consent, duration bounds, shared text/audio allowance, concurrent reservations, replay/capabilities, monthly rollover, disabled admission and private delegates. Verify actual ownership/grants/fixed paths/removed CREATE and table column grants in `local:audit`; old delegates must remain inaccessible to API/worker roles. Check the served `Permissions-Policy`: same-origin microphone only, camera/geolocation denied. No retained reset or destructive rollback assumption; inspect sanitized SQLSTATE/history and add repairs if deployed state requires them.

Audio implementation uses **existing Node 24, OpenAI SDK 7.45.1 and browser MediaRecorder/Web Audio**, with no FFmpeg/decoder dependency or temporary files. Browser normalizes a supported WebM/MP4 recording to canonical mono 16 kHz PCM16 WAV; server validates the actual sample count and exact header/length, not client duration. Upload ≤1,920,044 bytes / 0.2–60 seconds; encoded capture ≤2 MiB, grossly invalid/overlong data fails. A short encoder tail is trimmed/disclosed. Unsupported formats/Web Audio retain typing.

For automated work keep **`JARVIS_MOCK_ONLY=1`**. Mock transcription is a fixed demonstration, not speech recognition; no fallback to a real provider. For a later controlled live check, once DB/HTTP/HTTPS tests pass and the existing private admitted account/project key is configured:

1. Review current OpenAI audio endpoint/model availability, retention and price. Model is fixed **gpt-transcribe**, `/v1/audio/transcriptions`; reviewed $0.0045/minute on 2026-10-31. Audio price review expires **2026-11-30 IST**; if expired, reverify and apply a reviewed additive price update—do not raise caps or bypass the guard. Text price review has its existing earlier expiry.
2. `pnpm live:configure transcription` at the normal project terminal enables only the personal server flag using the existing hidden project key/config; it makes **zero OpenAI calls**. `pnpm live:status` reports configured booleans only. No public env key. Restart the web server. A fresh environment still needs `live:admit`/register/verify and `live:configure openai` first as explained below; never paste keys into chat. Text model evaluation/enablement is independent of audio enablement.
3. In Assistant → Push to talk → Cloud transcription and privacy, read the disclosure and explicitly **Enable cloud transcription**. This is separate from browser microphone permission and server configuration. Select OpenAI explicitly; default remains mock. Audio plus an optional language hint leaves the app, without conversation history/memories. Do not enable data-sharing opt-ins. Reviewed endpoint retention rules are in DECISIONS; app disposal is not a zero-provider-retention or physical-erasure promise.
4. Check remaining **₹1,000/month AI** allowance first. One 60-second-bounded recording reserves **₹1**; valid reported duration reconciles at the reviewed price/conservative ₹150/USD conversion. Unknown/cancelled-dispatched/missing usage holds the reservation. Audio shares text caps/concurrency (two active total, one transcription/account, four transcription requests/minute); ₹500 contingency remains unavailable. Numeric estimates and provider invoices may differ.
5. Record a brief **synthetic** phrase once, Stop, choose Transcribe, correct names/dates/times in Review, insert into Message and only then Send. Confirm no actions occur without existing memory/reminder review. Check safe usage summary, disable cloud transcription afterward if unneeded. A lost network result is not durably replayable: retry reuses the same ID and must not repeat paid dispatch; a new recording is an explicit new potentially charged call. Do not repeatedly live-test failures or accents/noise at paid scale.

No audio/unsent transcript goes to database/object storage/temp files/logs or browser persistent storage. Numeric budget/consent metadata persists even in temporary mode. Sent text follows existing conversation retention; raw audio is not part of any source/backup export. Browser/SDK/OS transient copies may survive until reclamation; no secure-erasure guarantee. Read-aloud is local browser synthesis only, explicit/completed-only, 0.8–1.2× page rate, 2,000-character/45-second limit. localService is a browser indication, not independently verified OS routing.

## Later manual voice checklist — Deferred—not tested

Record **device/OS/browser version, date, selected recorder MIME, language hint and pass/fail observations** for each: desktop **Chrome**, desktop **Safari**, **Android Chrome**, **iOS Safari**. No credentials/screenshots/audio upload is required for the report. Current loopback app and headless self-signed HTTPS fixture do not provide a trusted, reachable phone origin. A later separate local HTTPS/network/origin test setup is required; do not publish/deploy, bypass certificate/CSRF checks or widen bindings automatically. Leave phone checks pending until that setup exists.

- On entry, verify no microphone prompt, capture or speech. Start/Stop/Cancel via mouse/touch/keyboard; deny permission, then allow; test missing device/busy device, late permission after Cancel and unplug/interruption. Record the actual MIME/canonical conversion, silent/empty input, size limit and 60-second stop. Verify the OS microphone indicator releases promptly after every stop/cancel/error.
- Keep typing while recording/transcribing. Hide the tab/lock/rotate/navigate/back/sign out, including another tab; no automatic resume/upload or late transcript in another conversation. Cancel an upload, retry once with the same ID, then deliberately record again only when intending a new request. Check no duplicate paid call or duplicate chat turn.
- Review/edit names and dates before Insert/Send; test “yes”, explicit memory save and reminder phrases. Nothing approves/schedules from transcription alone; temporary actions remain disabled and refresh loses temporary content. Use short synthetic noisy, accented and multilingual/code-switch phrases; document recognition errors rather than assuming compatibility/accuracy. Start with mocks, then only the bounded approved live smoke.
- Test screen-reader labels/focus and phase announcements (no timer-tick flood), permission denial recovery, 390/320px reflow/zoom/on-screen keyboard/scroll and reduced motion. Confirm Stop focuses Transcribe and Cancel/error returns to mic control; no hidden/obscured controls.
- With no local voices, only text remains. With late-loaded local voices, choose one and a modest rate; verify voice is labeled synthetic and browser-reported local. Remote voices must not be selectable. Read only completed text; code/URLs omitted, long output/truncation/45-second stop disclosed. Starting capture, navigation and sign-out stop speech; nothing plays automatically.

This checklist does not satisfy the previously deferred manual accessibility/mobile gates until actually performed. Voice implementation is complete in source; device/live/runtime acceptance and earlier milestone requirements remain open.

## Recurrence/snooze compatibility and verification (new machine only)

New additive **202610310001_recurring_reminders.sql** depends on the existing complete migration chain, including the prepared 010 grant. It adds owned series/series operations, occurrence metadata/unique composite identity, private isolated test scope, exact-review/snooze RPCs and worker/legacy-web fencing wrappers. It preserves existing one-time rows, channels, histories, policies and current queue schema. No dependency pin changed. Old worker/web functions are renamed into non-API private delegates; audit source matching understands these renames. Application type declarations were updated by inspection; generated types have **not** been regenerated for this schema here.

On an existing retained target: stop only your old web/worker processes, preserve the database/backup, check migration history, run `pnpm db:migrate`, then `pnpm worker:setup`, `pnpm db:types` and `pnpm local:audit`. Do not start the new worker against the old schema. Review generated differences against `src/lib/database.types.ts`; do not overwrite its safe-column contract blindly. Audit all new helper/delegate owners, fixed search paths, function/table ACLs, removed temporary CREATE, matching-owner constraints and occurrence uniqueness; API/worker must not execute the private legacy delegates, and only authenticated user RPCs may mutate series. Migration 010 still grants **only postgres** EXECUTE on the fixed generic channel-test helper.

If a migration fails, capture only SQLSTATE/routine/line, inspect actual history/schema and transaction outcome. Never manually mark it applied, blindly edit an applied migration, drop tables to retry or reset retained data. Preserve the failed attempt and create a new additive repair when deployed state requires it. Migration rollback to an older application is **not** assumed safe because function names/contracts change. Keep the worker stopped until compatibility/grants pass. Backups/restore rehearsal remain separately unverified.

Run the ordered check commands below with the normal worker stopped. Current declarations: 17 new real DB cases, one new isolated real worker restart case, four new browser cases; all are **written—not executed on the old laptop**. Isolated worker fixtures use restricted private run bindings and mock-only adapters/queues; no ordinary account series should be swept by them. The recurrence worker test waits for the next UTC minute (up to ~75 seconds), stops/restarts the actual child process, checks one mock receipt and the following calendar occurrence without the website. This is distinct from offline calendar tests.

Then, with a single normal mock worker, sign in and use Today:

1. Preview daily/weekly schedules with explicit zone/start/end and inspect all three offsets/UTC instants; edit a field and verify old confirmation is rejected. Include New York spring/fall and Lord Howe half-hour fixtures through the DB suite, comparing Temporal with database tzdb; disagreement must fail closed, not silently shift.
2. Confirm a synthetic mock series for the next minute, close the website, restart the worker before due and inspect the occurrence/attempt later. Verify future generation even when the prior mock attempt fails/is unknown. Exercise two-worker uniqueness, lost enqueue/job reconciliation and bounded missed-date recovery through the suites before relying on it.
3. Snooze one unsent occurrence by 10 minutes/custom time; series wall time stays unchanged. Reject at/after the next recurrence, stale versions, prior send authorization, acceptance and unknown outcomes. Skip next; pause/resume without paused-date replay; edit/cancel while retaining old occurrence/attempt history. Test races through the DB suite.
4. Run 390px/320px keyboard, axe, reflow/focus and browser-error checks via Playwright. Manual screen reader/real phone keyboard remain **Deferred—not tested before private beta**, not implied by automated passes.
5. Only after the existing live smoke gates below, an explicitly reviewed Pushover series may be tested once; never convert old mock occurrences or raise existing burst/day caps. Keep provider acceptance separate from observed phone arrival. No flood/failure live tests.

Scope limits: daily/weekly only; fixed `shift_gap_forward_fold_earlier_v1`, inclusive end, one-next future scheduling; default recurring lateness five minutes configurable 1–60. Missed dates are recorded in batches ≤32, not delivered in a backlog. Paused dates are not replayed. Snooze versions the same occurrence, preserving its nominal date/instant. Already in-flight sends cannot be recalled; unknown outcomes are never blindly replayed. Series/history/operation metadata have no new automatic expiry/export guarantee.

## Pending permission repair and runtime checks

Migration **202610290010_operator_channel_test.sql** is prepared but its last attempt never reached SQL: local port 54322 refused connections. It SET LOCALs to the existing guard owner and grants only postgres EXECUTE on `private.m2c_channel_test_v1(uuid)`. No owner, RLS, membership, schema CREATE, managed Auth or ordinary-user privilege change. Preserve migrations already applied; do not mark versions applied manually.

After `db:migrate`, `local:audit` must include versions 202610290010, 202610310001, 202610310002, 202610310003, 202610310004 and 202610310005, matching function bodies and the expected restrictive grants. Run:

```bash
pnpm test:integration tests/integration/live-boundaries.test.ts tests/integration/recurring-reminders.test.ts tests/integration/voice.test.ts tests/integration/tasks.test.ts tests/integration/privacy.test.ts tests/integration/personal-version.test.ts
pnpm test:integration
pnpm test:worker
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:https
```

Expected discovery: **14 + 17 + 12 + 12 + 13 + 2** targeted live-boundary/recurrence/voice/task/privacy/setup cases, **109** full database cases, **14** real worker-process tests, **42** browser cases and **9** HTTPS check groups. Fixtures own random synthetic accounts/queues; actual ordinary user tokens prove isolation. The new ACL case checks postgres access and real API-role denial without sending. Do not count setup failures/skips or offline mocks as RLS/durability evidence. New delivery routing and UX need these regression runs. Browser tests own 3100; HTTPS owns 3443 with a temporary certificate, not OS trust changes. Do not upload traces, screenshots, cookies or mailbox codes. Remote CI remains **not run**.

With the normal app/tests/worker quiesced and ≥5 GiB temporary-filesystem headroom, separately run `pnpm db:reconstruct`. It uses a random disposable project/ports and checks fresh migrations plus read-only retained fingerprints, now including M2C usage/policy/acceptance and series/series-operation/isolated-fixture/voice-preference/task/task-operation/privacy settings/jobs/events/retired-request/cost rows. The 5 GiB guard is unchanged; the extended reconstruction has not run. Do not substitute a retained reset or volume prune. Manual screen-reader and real-phone keyboard/scroll remain **Deferred—not tested before private beta**.

## Private configuration and controlled live smoke test (later)

Do not copy old `.env.local`, synthetic-password or worker credential files onto a fresh stack. Recreate them. Provider secrets belong only in ignored `.local/live.json` (0600), entered at hidden local prompts, never NEXT_PUBLIC, command arguments, browser storage, logs or source. A fresh account has a new owner UUID; **reconfigure** its binding rather than editing an old owner ID. `JARVIS_MOCK_ONLY=1` explicitly disables reading live configuration for automated development; omit that process setting for an intentional live test.

1. `pnpm live:admit`: enter the chosen personal app email locally; register/verify that same address through the app/Mailpit if needed. No public signup or verification bypass.
2. `pnpm live:configure pushover`: hidden application token, User Key, exact Android device name. Device validation sends no message. Other synthetic accounts cannot inherit this phone. `pnpm live:status` shows booleans only. Restart web/worker after configuration changes. Then sign in as that bound account and explicitly allow **confirmed Pushover reminder sends** in Settings → Privacy Center. Configuration alone grants no user consent; do not enable text/audio as a side effect.
3. `pnpm live:pushover-test --check`: expect postgres operator EXECUTE true, API/worker false, account eligible/configuration match true. With no live configuration, the earlier catalog regression still verifies the grant; this diagnostic intentionally requires configured binding.
4. Stop any older separately running worker first. Run `pnpm live:pushover-test` **once**; it starts its own temporary worker. Repetition inspects the same logical generic test per binding. Record committed reminder/scheduling/provider result separately from yes/no phone arrival and approximate time. In Today → Inspect attempts, record the phone observation separately.
5. Start `pnpm worker`. In Today explicitly select **Pushover**, review a near-future title/full date/local time/IANA zone/UTC/channel, confirm and close the website. Observe the phone, then reopen Today and record the observation. Old mock reminders remain mock. Provider accepted does not establish device display/read; unknown outcomes must not be blindly resent. Keep host/infrastructure awake.
6. Review the dedicated OpenAI project's current account/model availability, data-sharing opt-ins (off), funding minimum/taxes/FX and provider-side controls using README's dated official links. No auto recharge; ₹1,000 AI/month in Asia/Kolkata, initial evaluation ≤₹200 within it, separate ₹500 contingency, total ₹1,500. Pushover trial/possible $4.99 Android purchase is separately approved. Do not reset a usage ledger or change accounts to obtain another allowance; reconcile any old/project usage before new calls.
7. `pnpm live:configure openai` enters the project key privately and leaves live AI disabled. Explicitly allow **cloud text AI** for that account in Privacy Center before evaluation; audio remains separately off. Then `pnpm live:evaluate` checks the two recorded phone observations, database logging and account access before 40 synthetic cases × two runs × two candidates. Price review expires 2026-11-29 IST; reverify before later paid calls. If no model qualifies or allowance is insufficient, stop; do not widen the evaluation/cap. No model is selected yet. Store:false is not zero provider retention; app estimates are not exact invoice containment.
8. Restart web after a qualified model is selected. Choose OpenAI explicitly; get one ordinary response, request and approve an exact memory, recall it in a new conversation, then ask “Remind me tomorrow at 8 PM to revise probability.” Review/confirm the resulting live-channel draft in Today; close the website and observe its scheduled phone arrival. Also delete the test memory and verify later retrieval excludes it. Temporary mode must save no content or persistent actions. Record actual model, numeric usage/estimates and separate operation/schedule/acceptance/phone evidence. No failure floods or deliberately paid failure tests.

## Optional retained-data move — separate from source/fresh setup

No repository backup/restore automation or tested restore guarantee exists. If retained data matters, preserve the old machine/volumes until an isolated restore rehearsal passes; a schema dump or source archive is insufficient. Do **not** execute this path on the deferred laptop now.

1. Later, quiesce the old web/worker and keep live dispatch off. Record migration versions, counts, admission/revocation/deletion state and budget/evaluation totals privately. Never leave both machines' reminder workers active.
2. For a compatible Postgres/image/CPU environment, cleanly stop the old stack with `pnpm db:stop` (retains data), identify **only** the `jarvis-foundation` database volumes and export them using Docker's documented volume-backup procedure with ownership intact. Never copy live database files, replace Docker Desktop's entire disk image or prune unrelated volumes. Cross-version/architecture uncertainty requires a separately reviewed consistent logical export/restore instead.
3. Encrypt the snapshot and any separately needed local secrets on trusted storage; keep keys/passwords out of the archive/source/chat. A logical export must account for Auth identities/roles, public/private data, admissions/revocations, series/occurrence/operation/outbox/attempt/acceptance/queue state, migration history, voice consent/configuration flags, tasks/task operations/task-focus/reminder links, privacy consent/retention/epochs/deletion jobs/retired requests/unlinked cost carry and AI/audio reservations/usage. Check the **pinned CLI's** dump scope rather than assuming current defaults or schema-only output preserves them.
4. Restore to an empty, compatible, isolated development environment first—never overwrite a retained target. Recreate local URLs/session keys/worker credentials safely; audit owner IDs, helper owners/grants, Auth/profile links and claims, retention/deletion suppression and budget totals. Old browser sessions should not be reused. Re-enter provider configuration only after retained identity/budget checks; keep the worker off while reviewing/cancelling pending live reminders.
5. Apply only genuinely pending migrations (including 010, 202610310001, 202610310002, 202610310003, 202610310004 and 202610310005 if absent); run the audit, full isolation/worker/browser/HTTPS checks and an outage/reconciliation rehearsal with live delivery disabled. Preserve unknown/accepted outcomes; do not replay historical notifications to test restore. Validate deletion/expiry and no duplicate effects before activating a single worker. Keep the old encrypted backup until verified; backup expiry/restore deletion guarantees remain open.

Official procedure references, accessed 2026-10-31: [Docker volumes/backup](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes), [Supabase CLI dump/stop reference](https://supabase.com/docs/reference/cli/supabase-db-dump). They establish tooling behavior, **not** this project's successful retained-data restore.

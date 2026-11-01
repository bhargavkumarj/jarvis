# Personal-version finishing pass — 2026-11-01

**Personal-version implementation candidate prepared; runtime acceptance pending.** The consolidated capability → screen/API/persistence → evidence → remaining-test ledger is in [STATUS](STATUS.md). It bounds this finishing pass; the long-term product and previous milestones are not accepted.

Added short optional name/style/timezone setup through existing preferences, with a single owned save/skip marker; no implicit cloud/microphone/phone consent. Provider states now distinguish configuration from permission/readiness. Fixed obsolete retention/mock-only copy, named page/navigation context, unavailable source wording and explicit metadata zones. First-action suggestions draft text only. Sign-out/privacy invalidates active stream/voice work and late results; confirmed account changes reload other tabs. Manual task/reminder flows stay independent of AI/budget. Today no longer duplicates its occurrence fetch; submit locks preserve existing durable dedupe. Prepared runtime assertions remain strict and are scoped to their form.

Only new SQL is additive **202610310005**, a profile completion timestamp/column UPDATE grant under existing RLS; no admin request, worker privilege, new dependency or provider. Static review covers ordered signatures/callers, FKs/delete order and private delegates, not actual SQL compilation/privileges. Generated DB types stay historical; pending manual contract additions are explicitly provisional.

**Executed here:** lint/typecheck, **357 units/mocks (32 files, 0 failed/skipped)** and production build; syntax/source/ignore/archive checks. **Written—not executed:** two new DB/four browser cases; full expected **109 DB, 14 worker, 42 browser, nine historical HTTPS groups**. No Docker/DB/worker/browser/HTTPS/device/live/paid/deploy/data-erasure action ran. Operator repair 010, later migrations, reconstruction, model/phone evaluation, manual a11y and operational recovery remain pending.

[MACHINE_HANDOFF](MACHINE_HANDOFF.md) provides exact requirements, secure credentials, fresh synthetic versus optional retained-data transfer, first integrated smoke and isolated destructive checks. Refreshed source archive excludes secrets/data/audio/exports/caches. No further feature was begun.


---

# App report — Privacy Center, 2026-10-31

Settings now contains separate cloud text/audio/notification consent, warned conversation retention, a recent-password gate, private JSON export, scoped bulk erasure and explicit resumable account deletion. Existing conversation/memory/task item controls remain; “forget this” clarifies scope instead of silently deleting memory or source text. Export includes readable categories/exclusions and available provenance without credentials/security diagnostics. Expired sources and stale known operations are fenced even when cleanup is delayed.

Account deletion disables app access and dispatch first, uses the existing restricted worker for bounded content/pg-boss cleanup, then waits for the isolated `pnpm privacy:finalizer` process to remove matching local key/evaluation files and call supported Auth identity deletion. No ordinary request or reminder worker gets admin credentials. Progress, partial failure, unknown/in-flight effects and retry are explicit. Numerical cost carry prevents erasure from resetting approved spending caps. Provider copies/key revocation, downloaded files, developer artifacts and backups are separate boundaries, not claimed erased.

**Executed:** lint/typecheck, **334 units/mocks (0 failed/skipped, 28 files)**, production build with live providers disabled, script syntax and ignore/archive inspection. **Written—not executed:** 13 new DB, one real-process worker, four browser cases; expected full suites **107 / 14 / 38**, plus nine historical HTTPS groups. SQL/RLS/atomicity/real cleanup/export/credential removal/Auth finalization/interactive accessibility remain unverified. New migration **202610310004** and earlier pending 010/recurrence/voice/tasks are not applied here. No Docker/runtime test, deployment, paid call or real account/data deletion ran.

The source inventory, exact retained metadata purposes/durations and restore limits are in [ARCHITECTURE](ARCHITECTURE.md); dated evidence is in [STATUS](STATUS.md). The [handoff](MACHINE_HANDOFF.md) gives migration, scripts, isolated synthetic checks and recovery. Formal M1/full M2 and earlier feature acceptance remain open. Privacy implementation is finished for review, with runtime acceptance deferred; no next milestone was begun.

---

## Prior task report — historical

# App report — personal tasks implementation, 2026-10-31

Today now integrates owner-scoped tasks with optional notes, date-only/exact-time deadlines, edit/complete/reopen/cancel and confirmed deletion. Task deadlines and reminder schedules are separate. Chat/voice task requests produce reviewable typed proposals; existing deterministic operations remain the only execution path. Owned bounded task context excludes notes and unrelated accounts. Temporary conversation actions remain disabled.

An optional linked **one-time** reminder uses existing exact time/zone/channel confirmation and outbox/pg-boss infrastructure. Task closure is designed to cancel unsent linked work atomically, while in-flight/accepted/unknown outcomes remain inspectable. Reopening does not reschedule; changing a deadline does not move a reminder; cancelling/removing a reminder leaves its task intact. Notification payload/history uses a generic task-reminder title, never task notes/title. Deleting a task removes its content and keeps minimal operational metadata; source conversation retention and generic delivery history remain separate.

**Executed here:** lint, typecheck, **294 units/mocks (0 failed/skipped, 25 files)**, production build with live providers disabled, script syntax checks and safe archive/ignore inspection. The 44 new unit cases cover dates/zones, references, proposal gating, receipt replay, request validation and mock/live separation. **Written—not executed:** 12 new DB, two real worker-process, four browser cases; current expected suites 94/13/34 plus nine HTTPS groups. No runtime suite, database migration, live call, device test or deployment ran. SQL/worker atomicity and interactive accessibility are unverified, not established by mocks.

New additive migration **202610310003_tasks.sql** follows the still-pending operator/recurrence/voice chain. It adds tasks/task operations, owner-consistent links and narrow RPC/worker fencing; no applied migration, ordinary request privilege, Auth helper, dependency pin, provider choice or budget changed. See [STATUS](STATUS.md) for detailed evidence and [MACHINE_HANDOFF](MACHINE_HANDOFF.md) for migration/audit/regression order and recovery safeguards.

This is the requested focused implementation with runtime acceptance deferred. Earlier M1/M2 and live M2C remain unaccepted; no broader project/subtask system, recurring task generation, export/wipe lifecycle, deployment or next feature was started. Manual screen-reader/real-phone checks stay **Deferred—not tested**; remote CI **not run**.

---

## Prior voice report — historical

# Application report — voice implementation and handoff

Updated **2026-10-31 IST** for the authorized push-to-talk/local read-aloud increment. Assistant records only after a gesture, releases the microphone on stop/cancel/hidden/navigation/sign-out, explicitly transcribes, presents an editable transcript, then inserts it into the existing composer for a separate Send. Completed replies have optional browser-reported local synthetic speech, never automatic. Raw audio/unsent transcript are transient; no hidden recognition, cloud TTS or new conversation/action path.

**Verified here:** lint/type checking, **250 unit/mocked cases passed (0 failed/skipped, 22 files)** and production build. Current SDK multipart fixtures use the supported gpt-transcribe endpoint and no external calls. New default-off consent and shared-ledger duration accounting, pending migration 202610310002, **12 DB cases and six browser cases are implemented/written—not executed**. Full declared suites now 82 DB / 30 browser; 11 worker and nine HTTPS groups remain deferred. Earlier 010/recurrence migrations, M1/M2/M2C live acceptance and device/manual checks remain pending. No paid call, Docker, database, browser/process/device run or deployment occurred.

Privacy/cost: explicit OpenAI audio consent is separate from microphone permission and text-AI enablement. No history/memories are sent to transcription. Canonical WAV sample validation bounds real duration without a new dependency or temp files. Audio shares the unchanged ₹1,000 AI cap; ₹1 conservative reserve/recording, uncertain spend held, ₹500 contingency untouched. Provider retention is an endpoint-specific documented boundary, not a zero-retention promise. Current limitations: supported browser capture/Web Audio required, mock is not recognition, real-language/codec/device behavior unverified, no transcript replay store, browser locality not independently proved, no full-duplex/background capture.

Use [MACHINE_HANDOFF](MACHINE_HANDOFF.md) for the new-machine test/configuration sequence and later manual matrix. Source implementation is complete for this slice; **runtime acceptance and all earlier required evidence remain open**. Stop here; no next major feature.

---

## Prior recurrence report — historical


Updated **2026-10-31 IST** for the explicitly authorized recurrence/snooze increment. Today now contains daily/weekly series review and management plus per-occurrence snooze; chat can propose a series but cannot confirm/enqueue. The new additive migration and worker planning preserve owner isolation, mock/live binding, outbox/idempotency, generic notifications and unknown-outcome semantics. No applied migration, provider credential, dependency pin, processor choice or budget changed.

**Executed here:** lint/typecheck, 204 offline unit/mocked tests (zero failed/skipped), production build and script syntax checks. **Written—not executed:** 17 new real-database cases (70 total), one new isolated worker-process restart case (11 total), four browser cases (24 total). Database migration/ACLs, new interactive UI, live effects and reconstruction remain unverified. The previous 161-unit/52-DB/10-worker/20-browser/9-HTTPS evidence below is historical; do not infer acceptance from it.

Key policies: fixed IANA wall-clock recurrence, gap-forward/fold-earlier, inclusive end, exact next-three preview, 5-minute default configurable lateness and no backlog flood. Snooze changes one unsent occurrence, never the series; it must end before the next recurrence. History survives edits/cancellation. In-flight notifications cannot be recalled. See ARCHITECTURE/DECISIONS for precise limits and MACHINE_HANDOFF for the next-machine verification order. **This feature is implemented with runtime acceptance deferred; M1, M2C and full M2 remain unaccepted.** No broader M3 task system, recurrence variants, voice, hosting or beta was started.

---

Prior M2C report, **2026-10-31 IST**. The core approved M2C implementation exists. This continuation fixed gaps and prepared the move rather than rebuilding authentication or adding another mock-only milestone. **M2C live acceptance, formal M1 and full M2 are not complete.** Docker/database/live work is explicitly deferred to the new machine. [STATUS](STATUS.md) is the dated evidence ledger; [MACHINE_HANDOFF](MACHINE_HANDOFF.md) is the single move runbook.

## Implemented and verified here

- OpenAI's installed SDK now surfaces streamed refusals, rejects empty completed answers and exposes only fixed safe recovery reasons for allowance, access, rate-limit, timeout, incomplete and invalid outputs. No silent provider retry/fallback; uncertain dispatched spend remains reserved.
- Worker notification routing is isolated at its existing adapter boundary. Offline tests prove old mock jobs cannot become live, foreign owners/isolated tests cannot dispatch live, and a post-send receipt failure remains unknown without a second send. The real database still authorizes dispatch beforehand.
- Assistant differentiates live/mock instructions, waiting/retrying/stopped results and clears receipts when switching/deleting conversations or entering temporary mode. Memory distinguishes loading, unavailable, pending and approved data. Today keeps a live draft's exact channel visible when availability is unknown and focuses review. Settings can refresh masked status without inventing zero usage.
- Source tests and the handoff preserve the prepared least-privilege repair; reconstruction's future read-only fingerprint includes M2C data. No schema/Auth redesign, new dependencies, infrastructure or privileged ordinary web client.

Current executed source results: lint/type checking pass; **161 unit/mocked tests passed, zero failed/skipped**, fifteen files. Twenty browser cases are discovered only; no browser runtime or new database proof today. The final production build passed with live configuration disabled for that process; this is compilation evidence, not a connected-service check. The new unit harness aliases the existing Next @ path for server-markup tests; it does not bypass application login/RLS. Earlier harness import/type errors were repaired before the passing run.

## Implemented but awaiting runtime evidence

OpenAI context/streaming/action proposals, exact memory lifecycle, one-time reminder review/confirmation, durable queue/outbox/attempts, owner-bound Pushover, quotas and concurrency-safe SQL accounting are implemented. Historical 52 database/10 worker/20 HTTP/9 HTTPS passes remain useful history; **53 current database cases (including 14 affected live-boundary cases)** and updated worker/browser flows need the new machine. Offline RPC fixtures are not proof of SQL authorization or durable scheduling.

The proven Pushover defect is missing local postgres EXECUTE on the guard-owned generic test helper. Repair 010 grants that single operator capability after ownership transfer, leaving API/worker denied, RLS/ownership/Auth unchanged. The last migration connection was refused before SQL execution; deployment is unverified. Account/device configuration passed historically, but message acceptance and phone arrival have not. OpenAI is unconfigured, no model is selected and no evaluation/paid inference occurred in this continuation.

## Remaining scope and decisions

Approved processor choices and budgets are unchanged: OpenAI selected context; Pushover generic Android; local app/database; ₹1,000 AI/month (₹200 initial evaluation within it), ₹500 separate contingency, separately approved Pushover trial/possible Android purchase. No renewed policy approval is needed. Provider account access, credential entry on the new stack, measured evaluation and phone observations remain operational work.

Account-wide export/wipe, tested backup/restore/deletion replay and existing full-M2 pilot gates remain unfinished. Manual screen-reader/real-phone keyboard/scroll are **Deferred—not tested before private beta**; fresh reconstruction remains unverified with the unchanged 5 GiB guard; remote CI **not run**. The prior continuation did not implement recurrence; the later explicit feature increment above does. Voice/hosting/beta/public registration remain out of scope. No acceptance is waived by changing development sequence.

Smallest next action: transfer the reviewed source set using MACHINE_HANDOFF, then install its pinned dependencies on the new machine. The guide gives an ordered fresh synthetic setup, permission audit, actual integration/process/browser checks and later bounded live smoke test. Its optional retained-data procedure preserves Auth identities, budget/queue/unknown/deletion state separately and is not an executed restore guarantee. Do not restart Docker on this laptop.

<details>
<summary>Historical completed M2B report</summary>

# Application progress: M2B local durable reminders

Updated **2026-10-29 IST**. **Local M2B is complete within the authorized synthetic/mock scope.** M2A remains intact. Full M2 text-to-phone is incomplete: no live AI, phone delivery, paid resources or deployment. [STATUS.md](STATUS.md) contains the canonical dated evidence and selection/skipped counts.

## What works

Today provides a manual one-time reminder form, exact time/zone/UTC review, separate confirmation, persisted list/details, operation receipt and cancellation. Editing invalidates review. The separate Node worker recovers the transactional outbox, schedules durable pg-boss jobs and records attempts. The website can close; Supabase/Docker/Postgres and worker must keep running, with the host awake.

A deterministic local adapter records **Simulated acceptance**, retryable/permanent failure or **Outcome unknown**. It makes no external notification request. Generic payloads contain no task details. Unknown outcomes are not blindly replayed; an already in-flight effect cannot be recalled. Restart and concurrent worker behavior were tested using actual processes and private queues, not browser timers or an in-memory fake scheduler.

Retained chat accepts only `/remind YYYY-MM-DDTHH:mm[:ss] IANA/Zone [earlier|later] | title`, creating a review-only draft and committed receipt through the same domain service. Confirmation remains in Today. Stop/retry after a lost chat receipt preserves one draft; UI warns that a draft may already exist. Temporary chat creates no reminder/operation and directs users to the retained form with a persistence disclosure. No arbitrary natural-language date understanding is claimed.

The existing Assistant/Memory flow still supports retained/temporary text, deterministic streaming, cancellation/retry, explicit proposals, exact separate approval, bounded active-only lexical retrieval and correction/deletion. No embeddings, summaries or extraction jobs were added. Saved memory deletion still invalidates derived replies while retained source messages are independently deleted through their conversation.

## Verification

| Check | Actual evidence |
| --- | --- |
| Managed source checks | Lint, typecheck, final production build and **87 units passed**; native Node worker TypeScript imports successfully. |
| Real integration | User normal terminal: **39 passed, 0 failed/skipped** (27 preserved + 12 new); expanded reminder-only rerun **12 passed**, including actual protected attempt rows/private-schema denial and worker-role restrictions. |
| Real worker processes | **9 passed, 0 failed/skipped**, 133.53s. Future schedule survives stop/restart and produces one logical mock receipt. Includes enqueue/missing-job recovery, concurrency, retry exhaustion/permanent/unknown, cancellation races, post-send interruption, account disablement and expiry. |
| Post-fairness targeted worker run | **2 passed, 8 intentionally skipped**, 15.05s: real restart again plus 70 fixture rows rotating through a 50-row reconciliation batch. Ten distinct cases exist; no single full ten-case run is claimed. |
| HTTP browser | **20 passed, 0 failed/skipped**, 32.4s. After final interrupted-receipt copy, **2 targeted desktop/mobile cases passed**, 18 unchanged cases not selected again. Covers prior auth/memory, Today, ownership attacks, temporary denial, 320/390px and automated accessibility. |
| Final receipt-wording browser artifact | Agent inspection of `test-results/.last-run.json` at **08:09:04Z** shows passed/zero failed IDs after final build **08:03:21Z**. Console case count not supplied; no four-case count is invented. |
| Types/deployed audit | Generated schema reviewed. Seven migrations applied, **19/19 application function bodies match source**; queue schema 46. Restricted runtime cannot CREATE queue schema, read Auth/profile, SET guard role or execute queue installation; API users cannot dispatch or SET worker role. |
| HTTPS | **Historical M2A nine-group pass**, not rerun for M2B; not hosted TLS evidence. |
| Outstanding independent gates | Reconstruction unverified/storage-blocked (latest ~1.4 GiB, guard 5 GiB unchanged); manual checks **Deferred—not tested before private beta**; remote CI **not run**. Formal M1 remains partial. |

An observed SQLSTATE 42702 during initial worker setup was repaired by additive migration 004, renaming colliding PL/pgSQL aliases. Migration 005 fixes source-reviewed reconciliation starvation beyond the first batch. Applied migrations and Auth/session helpers were preserved; both incremental fixes and their targeted behavior now have runtime evidence. There are no outstanding failed local M2B checks.

## Schema, privileges and dependencies

Added public owner-scoped reminders, operations/idempotency and delivery attempts; private outbox, mock receipts and operator-only fault controls. Composite owner FKs protect all references. Ordinary user JWTs receive owned SELECT and one narrow command RPC; direct writes/private tables are denied. Confirmation commits reminder, receipt and outbox atomically. No ordinary web request uses an admin/service credential.

The background principal is a restricted LOGIN role with private queue DML and a fixed dispatch capability, not a fabricated browser session. A private postgres-owned boolean bridge checks verified/unbanned Auth and enabled admission without granting managed-Auth-table access to worker/guard. Browser sign-out does not cancel explicit reminders; account disablement blocks unsent dispatch. Installation/migration access stays in operator tooling; generated worker credentials are server-side/ignored/mode-0600.

Pinned **pg-boss 12.38.0** (schema 46) and **Temporal polyfill 0.5.1** were added. Existing **postgres 3.4.9** moved to runtime dependencies without a version change/download. Vendor construction SQL/license are included as source files for reproducibility; no runtime DDL rights were granted. Dated official sources and decision statuses are in DECISIONS.

## Recommended decisions and unresolved live-phase choices

Keep one modular application with separate web and worker processes, the reminder table as scheduling truth, pg-boss execution, generic payloads and explicit uncertain outcomes. Current provisional limits: 365-day horizon, five-second review minimum, 24-hour catch-up window, 50 unfinished/1,000 total reminders, 30 operations/minute, three dispatch attempts/eight enqueue attempts/three repair generations. This is the historical one-time baseline; recurrence/snooze are now implemented above, while focused tasks are now implemented in the later source-only increment above, with runtime acceptance pending.

The preferred stack is followed. The deliberate implementation choices are a private queue schema installed ahead of runtime, capability-based worker grants, and manual-first/narrow mock chat parsing. There is no Redis, custom generic queue, agent framework or microservice split. Actual live notification/AI integrations remain deferred, not substituted by claims that mocks prove them.

Before live AI/phone work: explicit personal-data/cloud consent; provider/model evaluation and budget; processor regions/retention; live channel/device permission; real-provider idempotency/status/timeout and duplicate-versus-missed-delivery policy; hosting/secret/backup and authentication-email decisions. These remain unapproved and do not block this local mock slice. Hosted real-data use and invitations also retain their release gates.

## Try it and handoff

With local Supabase running and migrations/`worker:setup` already applied, use **`pnpm dev`** and **`pnpm worker`** in separate terminals. In Today, create a synthetic reminder a minute ahead, review exact values, confirm, close the website, then reopen and inspect **Simulated acceptance**. The process tests exercise the same worker entry point independently of the web process. Full setup/test commands and limitations are in [README](README.md).

Local Git exists with untracked source and no commits/remotes. Credentials, environment secrets, screenshots and sensitive test artifacts are ignored. CI now defines isolated worker checks; no remote workflow success or publishing is claimed. Stop here; a later live-provider increment requires separate authorization.

</details>

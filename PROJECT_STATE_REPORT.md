# JARVIS project state report

Inspection date: **2026-11-01**. Repository-relative references throughout. This is a source and evidence review; no application, database, worker, Docker stack, browser suite or external service was started. No tests/builds were rerun. Only this report was created.

## 1. Overall assessment

**B — An implementation candidate awaiting runtime verification.** The intended personal-version capabilities have connected source implementations, including the finishing/onboarding pass that followed the historical Privacy Center report. This is substantially beyond the 334-test checkpoint. It is not verified for personal use: the current schema, new permission boundaries, scheduling/deletion races, real providers and physical devices lack current execution evidence.

The finishing work is confirmed by source, not just status prose: optional `/welcome`, save/skip API, profile completion migration, provider-state distinctions, session/privacy interruption, stale-result fencing and corresponding tests exist. The latest ledger reports **357 unit/mocked tests plus lint/typecheck/production build passing on November 1**. Local cache metadata corroborates 32 passing unit files that day, but does not independently establish the 357 assertion count.

All requested documents are present: `README.md`, `STATUS.md`, `APP_REPORT.md`, `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PRODUCT.md`, `DESIGN.md`, `MACHINE_HANDOFF.md`. Applicable `AGENTS.md` was read first. Older sections describe superseded milestones; their missing-feature statements must not override newer source.

Git is initialized on `main`, with **no commits and no remotes**. The application source/documents are untracked. There is no commit association for any result and no recoverable Git change history to distinguish successive implementations. Existing files were preserved; this inspection did not stage, reset, clean, switch, commit or install anything. A new terminal conversation does not establish a machine move; the existing checkout, dependencies and private configuration remain present.

## 2. Stack and repository structure

`package.json` and the importer in `pnpm-lock.yaml` agree on the reported stack: Next.js **16.4.3** App Router, React **19.3.1**, TypeScript **6.0.3**, Supabase JS **2.118.0**/SSR **0.12.7**, PostgreSQL **17** local configuration, pg-boss **12.38.0**, OpenAI SDK **7.45.1**, and a direct Pushover HTTP adapter. Temporal **0.5.1**, Zod and Tailwind support validation/time/UI. Node **24.x** and pnpm **10.34.9** are required; the inspected tools report Node **24.14.1** and that pnpm version. Dev/build explicitly use webpack.

One modular application has separate web and worker processes, plus an isolated privacy finalizer:

- `src/app/`, `src/components/`: pages, versioned APIs and Assistant/Today/Memory/Settings UI.
- `src/lib/`: session/configuration, domain services, provider contracts, budgets, voice and privacy.
- `src/worker/`: pg-boss execution, notification routing and privacy maintenance.
- `supabase/`: configuration, ordered SQL, synthetic seed and Auth email templates.
- `scripts/`: guarded local setup/audit/reconstruction, worker, provider evaluation and finalizer commands.
- `tests/`, `vitest*.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`: verification definitions.

`src/lib/config.ts` restricts ordinary web configuration to loopback URLs and a publishable/anon key. This is a local application candidate, not evidence of a hosted deployment. No browser Supabase SDK client or ordinary-request admin client was found in the inspected paths.

## 3. Feature-status table with source references

“Implemented” means connected source exists, not runtime acceptance. Providers below describe executable adapters; they do not establish current private configuration readiness.

| Capability | Status, providers and important limits | Source and available evidence |
| --- | --- | --- |
| Authentication, recovery, isolation | **Implemented.** Real Supabase Auth: admitted signup, email codes/resend, recovery/password change, sign-out/revocation. Server session identity, field grants, RLS and same-owner relations enforce ownership. HttpOnly cookies; Secure depends on HTTPS. No dedicated session-list/revoke-other-device UI found. | `src/app/api/v1/auth/[action]/route.ts`, `src/lib/supabase.ts`, `src/lib/session-cookies.ts`, `src/proxy.ts`; foundation/session/privacy SQL. Historical real A/B and Auth/browser/TLS passes; current privacy changes unverified. |
| Preferences and onboarding | **Implemented, including final pass.** Owned name/style/zone/locale preferences; optional three-field assistant-name/style/zone setup, save/skip and Settings revisit. No implicit provider/microphone consent. Existing profiles are backfilled as complete. | `src/components/preferences-form.tsx`, `src/app/(workspace)/welcome/page.tsx`, `src/app/api/v1/onboarding/route.ts`, migration `202610310005`; unit/API mocks passed historically on Nov 1; two DB/four browser cases written, unexecuted. |
| Conversations, streaming, stop/retry, temporary mode | **Implemented; mock and real OpenAI adapters.** POST/SSE, request IDs/attempt fencing, durable retained turns, cancellation and retry. Temporary content stays in page/process memory; no durable task/memory/reminder actions, but numeric live usage persists. Live context includes at most six filtered user turns, omitting assistant history. | `src/app/api/v1/turns/route.ts`, `src/app/api/v1/turns/cancel/route.ts`, `src/components/assistant-workspace.tsx`, `src/lib/conversation/`, `src/lib/ai/orchestrate.ts`. Historical DB/browser passes and current mocks; current streaming/session races await runtime proof. |
| Memory proposals, approval, retrieval, correction, deletion | **Implemented; mock/live proposals, deterministic SQL authorization.** Explicit exact version/content approval and conflict review; active-only lexical retrieval, up to five snippets from a bounded personal collection. Direct “Save approved correction” versions active content; delete suppresses reuse/redacts derived replies. Source deletion preserves independently approved memory. No embeddings, summaries or autonomous extraction. | `src/app/api/v1/memories/route.ts`, `src/components/memory-workspace.tsx`, migrations `202610290001`, `202610290008`, `202610310004`. Historical real lifecycle/isolation tests; current expiry/epoch fences unexecuted. |
| Tasks and linked reminders | **Implemented; deterministic controls plus mock/live chat proposals.** Notes and none/date-only/exact deadlines; complete/reopen/cancel/delete. Separately confirmed same-owner one-time reminder. Deadlines do not notify; delivery does not complete tasks; reopen does not reschedule. Closure cancels unsent work by SQL design. | `src/lib/tasks/`, `src/app/api/v1/tasks/route.ts`, `src/components/task-workspace.tsx`, migration `202610310003`. Unit/API mocks; 12 task DB and two worker cases written, unexecuted. |
| Recurrence, snooze, scheduling, history | **Implemented; mock/Pushover channels.** Domain schedules/outbox/receipts/attempts plus separate pg-boss worker. Daily/selected-weekday fixed-zone recurrence, three-date review, gap-forward/fold-earlier, pause/resume/skip/cancel. Snooze changes one unsent occurrence, must precede next recurrence. One-time catch-up 24 hours; recurring lateness 1–60 minutes. Unknown sends are not blindly replayed; acceptance differs from phone observation. | `src/lib/reminders/`, `src/components/{reminder,series}-workspace.tsx`, `src/components/snooze-controls.tsx`, `src/worker/runtime.ts`, recurrence SQL. Historical one-time process evidence; new recurrence/task/privacy worker paths unexecuted. Awake infrastructure is required. |
| OpenAI, consent, budgets | **Implemented, live acceptance partial.** Real Responses SDK plus offline transports; separate private binding/enablement and owned consent. Strict proposals have no approval authority. SQL reservations/capability settlement, shared text/audio allowance, conservative uncertain holds, no automatic retries/fallback. Recorded caps: ₹1,000 AI/month, ₹200 evaluation within it, separate ₹500 contingency. | `src/lib/ai/`, `src/lib/live/config.ts`, privacy SQL, `scripts/live-evaluate.mjs`. Installed-SDK HTTP fixtures and historical budget integration passes. Model selection/evaluation/account access/current prices not established. Source permits two text candidates; neither is verified selected. |
| Pushover configuration and mock/live separation | **Implemented, live delivery unverified.** Owner/credential-generation binding; stored channel remains authoritative; isolated tests cannot dispatch live. Fixed generic normal-priority payload. Consent-off, disconnect and cancellation are distinct. | `src/worker/delivery.ts`, `src/worker/pushover.ts`, `scripts/live-configure.mjs`, `scripts/pushover-test.mjs`, migrations `006`, `009`, `010`. Historical device validation succeeded without sending; generic send failed on operator ACL. No accepted notification/phone arrival established. |
| Voice and read-aloud | **Implemented; deterministic mock and real transcription adapter.** Explicit capture/stop/transcribe/edit/insert/Send; local Web Audio conversion to validated mono PCM WAV, 0.2–60 seconds. Separate audio consent/server enablement/shared budget. No raw audio or unsent transcript store. Explicit completed-reply speech uses browser-reported local voices only, bounded to 2,000 characters/45 seconds. | `src/components/{voice-input,read-aloud}.tsx`, `src/lib/voice/`, `src/app/api/v1/voice/`, migration `202610310002`. Capture/speech/SDK mocks pass historically; 12 voice DB/six controlled browser cases unexecuted. Real codecs/mic release/voice locality/recognition quality unknown. |
| Export, retention, deletion | **Implemented in source; operational lifecycle partial.** Separate consents; 7/30/90/365-day conversation retention, immediate expiry exclusion and worker cleanup. Recent-password-gated bounded JSON export; exact bulk scopes/account erasure. Worker purges content/queues; separate finalizer removes matching local credentials and supported Auth identity. Secret status receipt supports recovery. | `src/app/api/v1/privacy/`, `src/components/privacy-center.tsx`, `src/lib/privacy/`, `src/worker/privacy.ts`, `scripts/privacy-finalizer.mjs`, migration `202610310004`. Unit/mocked failures/filter/recovery evidence; actual current grants/export/cleanup/finalization unverified. Backup/provider/download copies are separate. |
| UI polish and cross-feature consistency | **Implemented finishing changes; runtime quality partial.** Named destinations/titles, UTC metadata, unavailable provenance, draft-only suggestions, responsive wrapping/focus, provider readiness states, submit locks and shared Today occurrence query. Session/privacy events stop active work; BFCache reload and generation checks reject late results. | `src/lib/workspace.ts`, `src/lib/session-events.ts`, `src/components/{navigation,privacy-boundary,live-settings}.tsx`, `src/app/globals.css`; personal-version unit/DB/browser files. Static markup/build evidence only for final pass; BroadcastChannel absence limits cross-tab UI invalidation. |

## 4. Database and migration status

**17 migration files are present**, in the following execution order. Every row's current application status is **unknown**: no live migration-history/catalog query was possible without restoring services, and none was attempted. Generated types and filenames are not deployment evidence.

Historical categories: **H1** = earlier applied versions explicitly reported in dated audits; **H2** = user-reported successful M2C migration/setup, supported by a 34-function audit whose pasted history header was omitted; **P** = prepared/pending in latest ledger, with no successful application evidence.

| Order / filename under `supabase/migrations/` | Purpose | Historical evidence |
| --- | --- | --- |
| 1. `202610270001_foundation.sql` | Admission, profiles/preferences, RLS, guard and revocation | H1 |
| 2. `202610280001_auth_session_visibility.sql` | Narrow privileged live-Auth-session boolean bridge | H1 |
| 3. `202610290001_m2a_conversation_memory.sql` | Owned conversations/turns/proposals/memories and RPCs | H1 |
| 4. `202610290002_m2b_reminders.sql` | Reminders, operation receipts, outbox, attempts, worker capability | H1 |
| 5. `202610290003_pg_boss.sql` | Vendored pg-boss schema 46 and restricted runtime grants | H1 |
| 6. `202610290004_worker_aliases.sql` | Repair PL/pgSQL alias ambiguity encountered during setup | H1 |
| 7. `202610290005_reconciliation_fairness.sql` | Rotate bounded reconciliation and finalize exhaustion | H1 |
| 8. `202610290006_m2c_pushover.sql` | Personal binding/live channel/acceptance/observation | H2 |
| 9. `202610290007_m2c_ai_budget.sql` | Content-free usage ledger, prices/reservations/settlement | H2 |
| 10. `202610290008_m2c_memory_retention.sql` | Live proposals/exact approval, expiry and cleanup | H2 |
| 11. `202610290009_push_retry_binding.sql` | Retry burst policy and binding-specific generic test | H2 |
| 12. `202610290010_operator_channel_test.sql` | Narrow operator EXECUTE repair after ownership transfer | P; last attempt refused connection before SQL |
| 13. `202610310001_recurring_reminders.sql` | Series/occurrences/calendar policy/snooze/worker fencing | P |
| 14. `202610310002_voice.sql` | Audio consent, duration accounting/shared-budget wrappers | P |
| 15. `202610310003_tasks.sql` | Tasks/operations, owned reminder links and authority fences | P |
| 16. `202610310004_privacy_center.sql` | Consents/retention/export/erasure/queue/finalizer/epoch gates | P |
| 17. `202610310005_personal_finish.sql` | Optional onboarding completion timestamp/backfill/grant | P |

`STATUS.md:428` reports the first two versions audited on October 28 UTC; `STATUS.md:373` reports three on October 29; `STATUS.md:303` reports seven and 19 matching bodies; `STATUS.md:251` records M2C's reported additions through `009`. **None is independently confirmed against a database now.** The last six should be treated as pending until actual history proves otherwise. `src/lib/database.types.ts:1` explicitly labels later contracts provisional; `database.generated.ts` reflects the older generation. New web/worker code should not run against a partially migrated schema.

## 5. Verification evidence and gaps

The following are prior executions, not runs performed for this report. `STATUS.md` distinguishes agent source checks from user-terminal runtime results. Local Vitest cache timestamps corroborate the dates/file outcomes; the cache retains old entries and is not one current all-suite result.

| Suite/check | Current inventory | Latest available execution and qualification |
| --- | --- | --- |
| Unit/mocked | 32 files, `vitest.config.ts` | Nov 1, **357 passed, no failures/skips**, 11:02:25 IST, per `STATUS.md:31`. Cache has 32 files with `failed:false` at 05:32:25 UTC. Mocks include real installed-SDK parsing against offline HTTP fixtures. |
| Lint/types/build | Manifest scripts | Nov 1 passed per `STATUS.md:29–32`; build used disabled live providers. `.next/BUILD_ID` exists, modified 05:32:43 UTC; existence corroborates a build artifact, not runtime acceptance. No complete raw current build log inspected. |
| Database integration | Nine files, **109 literal cases**, `vitest.integration.config.ts` | Oct 29 **52 passed**, four files, 19:16:56 IST (`STATUS.md:255`). Cache retains four nonfailed files from that time. Current 109-case suite not executed: added ACL, recurrence, voice, task, privacy and setup coverage remains pending. |
| Real worker processes | One file, **14 cases**, `vitest.worker.config.ts` | Oct 29 **10 passed**, 147.08s, 19:17:56 IST (`STATUS.md:256`), corroborated by one cached nonfailed file. New recurrence/task/privacy cases and changed worker code unexecuted. Earlier targeted two-pass/eight-skip run is separate history. |
| HTTP browser | Eight spec files; **42 configured cases**, desktop/mobile projects | Oct 29 **20 passed**, 39.3s (`STATUS.md:256`). `test-results/.last-run.json` says passed/zero failed IDs, modified 13:51:03 UTC. Marker has no case count/revision. Current 42 cases unexecuted. |
| HTTPS | `scripts/https-check.mjs`, nine foundation groups | Oct 29 **nine passed**, reported cleanup confirmed/no trust-store change. Not rerun for current privacy receipt/export/consent. CI definition omits this harness. |
| Reconstruction, live and devices | Reconstruction/evaluation/phone/manual runbooks | Fresh reconstruction last stopped at disk preflight; no fresh migration/preservation proof. Provider send failed; evaluation/full phone flow unexecuted. Manual screen reader, actual phone/browser/codec checks and personal pilot unverified. Remote CI not run. |

Inventory counts were obtained by read-only source enumeration, including Playwright's two viewports, not test discovery/execution. Historical failures remain material context: worker setup SQLSTATE `42702` led to additive `004`; Pushover helper SQLSTATE `42501` led to pending `010`; its attempted migration then hit connection refusal. Earlier browser accessibility/locator/readiness failures were repaired and followed by historical passing suites (`STATUS.md:354–401`), not evidence that current browser behavior passes.

Small non-mutating checks inspected Git metadata, installed tool versions, artifact timestamps/numeric outcomes, configuration-file existence, disk availability and listener visibility. They establish the available evidence and prerequisites only. No credential-bearing file, database dump, recording or personal conversation was opened, and no Docker daemon or provider readiness probe was performed. No small test run was necessary.

Required runtime work includes ordinary A/B ownership and deployed ACL audits; exact approvals/stale sources; concurrent budget/consent changes; incremental/fresh migrations; restart/outage/cancellation and snooze races; export/retention/queue cleanup; isolated account-finalizer partial-failure/restart and Auth absence; current HTTP/HTTPS and physical accessibility/voice checks. A passing compilation or mocked scheduling test establishes none of these effects.

## 6. Configuration requirements—names only, no values

No environment/credential values were opened or copied. Presence checks establish files exist, not that their credentials, ownership, permissions or policies are valid.

| Boundary | Names / source | Presence observed |
| --- | --- | --- |
| Ordinary web environment | `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` — `src/lib/config.ts`; `.env.example` | Example and `.env.local` present; contents not inspected |
| Provider suppression/telemetry | `JARVIS_MOCK_ONLY`, `NEXT_TELEMETRY_DISABLED`, `DO_NOT_TRACK` | Defined in source/CI; current process values not inspected |
| Private provider file | `.local/live.json`; `version`, `owner_id`, `pushover.token`, `pushover.user`, `pushover.device`, `openai.api_key`, `openai.model`, `openai.enabled`, `openai.transcription_enabled` | File present; contents not inspected |
| Worker configuration | `.local/worker.json` — `scripts/worker-config.mjs` | File present; contents not inspected |
| Evaluation evidence | `.local/evaluation.json` | Absent; historical ledger also reports no completed model evaluation |
| Harness/runtime-only names | `M2B_TEST_RUN`, `M1_TLS_KEY`, `M1_TLS_CERT`, `NODE_ENV`, `DOCKER_HOST` | Source references only; not ordinary provider-key requirements |
| Local operator discovery | `API_URL`, `ANON_KEY`, `DB_URL`, `SERVICE_ROLE_KEY` — local CLI status consumers | Not queried; finalizer/fixture/admin setup only, not ordinary web configuration |

No `NEXT_PUBLIC` provider-key requirement exists in the inspected configuration. Do not put worker/operator/provider credentials into ordinary web environment settings. Configuring keys alone does not supply user consent or establish live readiness.

## 7. Unresolved decisions, defects and blockers

**Source-observed defect, unchanged:** `src/lib/ai/provider.ts:55` accepts textless completion only if memory, one-time reminder or clarification exists. It omits `plan.task` and `plan.recurrence`, although `src/lib/ai/contracts.ts` permits both and `src/lib/ai/orchestrate.ts` handles them. Consequently, an otherwise valid tool-only task/series response fails as incomplete after usage settlement. This follows directly from the branch; no live reproduction was attempted. Current SDK tests cover tool-only memory/clarification, leaving this boundary uncovered.

**Known historical defect awaiting deployment proof:** operator EXECUTE on `private.m2c_channel_test_v1` was missing. Migration `202610290010_operator_channel_test.sql` narrowly repairs it. Current ACLs remain unknown; do not infer success from the repair file or broaden grants.

**Implementation/operational gaps:** no automated backup expiry, restore/deletion replay or tested restore protection; no independently verified provider erasure/key revocation; no complete daily-use pilot. Downloaded exports, provider/device copies, logs/backups and already-loaded process credentials are outside immediate app erasure. Memory correction is explicit direct active-version saving, whereas older `PRODUCT.md` wording describes another approval stage; document intent should be reconciled in later work. A dedicated session-management screen is also absent, though current sign-out/recovery revocation exists. Proactive briefings, public beta, billing, home control and advanced realtime voice remain intentionally outside this personal candidate.

**Current machine evidence:** no listeners were visible on expected web/test/API/database/mailbox ports. Docker is on PATH; daemon access/health was not tested. Approximately **3.74 GiB** was available on the temporary filesystem, below `scripts/reconstruct.mjs:56`'s **5 GiB** guard. Reconstruction is therefore presently capacity-blocked under that unchanged guard. Old sandbox/Docker filesystem failures are historical, not newly diagnosed causes. No reset/prune/startup or transfer was performed or needed to write this report.

Recorded provider permissions/budget decisions already exist in `DECISIONS.md`; a new conversation does not revoke them. Model qualification/account funding/data controls and actual phone observations are unresolved operational checks. Text/audio pricing tables are dated and expire in November; treat them as repository policy, not verified current vendor pricing. Hosted region/SMTP/deployment choices remain future decisions. `MACHINE_HANDOFF.md` assumes a move; use its retained-state path if continuing this checkout instead of blindly extracting/reinstalling or recreating accounts.

## 8. Recommended next three actions

1. **Establish an accurate schema baseline before running the candidate.** In a separately authorized runtime session, preserve retained state, satisfy reconstruction headroom, restore the existing local stack, inspect migration history, then incrementally apply only genuinely pending files. Audit owners/ACLs/RLS/composite FKs/private delegates and `010`; regenerate/review types. Separately prove fresh disposable reconstruction and retained fingerprints. Do not reset retained data.
2. **Resolve the identified adapter defect and execute current synthetic acceptance.** Add focused SDK-boundary coverage for tool-only task/recurrence, then run current source checks and all 109 DB/14 worker/42 browser/nine HTTPS checks. Include current privacy-cookie/export coverage and isolated finalizer failure/resume. Keep normal worker/finalizer out of fixture-owned scopes; record dated results against an identifiable source snapshot. This implementation action is recommended, not performed here.
3. **Qualify controlled personal use.** After synthetic gates pass, verify current provider terms/pricing/account controls, prove generic and scheduled closed-site Pushover arrival separately from acceptance, complete the capped model evaluation and integrated conversation → memory → task → reminder flow. Execute real voice/accessibility/device checks and backup/restore/deletion-replay rehearsal, then a bounded personal pilot. Remain category B until these practical gates support category C.

## 9. Files useful for an external review

- Evidence/context: `STATUS.md` (newest ledger first), `APP_REPORT.md`, `DECISIONS.md`, `MACHINE_HANDOFF.md`; product/design/architecture/plan documents for intended boundaries.
- Dependency/runtime contracts: `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `src/proxy.ts`, `src/lib/config.ts`, `src/lib/supabase.ts`, `src/lib/database.types.ts`, `supabase/config.toml`, all 17 migrations.
- Critical paths: `src/app/api/v1/turns/route.ts`, `src/lib/ai/{provider,budget,contracts,orchestrate}.ts`, `src/lib/tasks/`, `src/lib/reminders/`, `src/worker/{runtime,delivery,pushover,privacy}.ts`, privacy APIs/helpers and `scripts/privacy-finalizer.mjs`.
- Verification: `tests/unit/`, `tests/integration/`, `tests/worker/`, `tests/e2e/`, test configs, `scripts/{audit,reconstruct,https-check,migration-definitions}.mjs`, `.github/workflows/ci.yml`.

Share reviewed source and this report; exclude actual environment/credential files, retained data, recordings, personal content and test/export artifacts. Existing source archives predate this report and should not be assumed to contain it.

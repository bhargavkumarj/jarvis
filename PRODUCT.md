# Personal version — bounded implementation candidate, 2026-11-01

**Personal-version implementation candidate prepared; runtime acceptance pending.** Sign-in/recovery/preferences, short optional setup, retained/temporary conversation, reviewed memory, tasks/linked reminders, one-time/recurring reminders/snooze, reviewed voice input/local read-aloud, provider consent/budgets and Privacy Center now have connected source paths. The evidence-backed completion checklist is consolidated in [STATUS](STATUS.md), including unavailable configuration, pending migrations and the exact missing runtime acceptance. No invented personal facts/actions are populated.

First useful flow remains sign in → converse → approve memory → recall in another conversation → create task → separately confirm linked reminder → observe phone arrival with website closed. A mock does not prove conversational quality or delivery. Setup grants no permissions. Physical accessibility, real models/phone flow, current SQL/runtime and operational recovery remain unaccepted.

This candidate does not implement the whole long-term product. Daily briefings, broader proactive check-ins, public beta, billing, smart-home control and advanced realtime voice stay later roadmap; no further subsystem is begun in this finishing pass.


---

# Product

Planning baseline: 2026-10-27. This document describes a proposed product; it does not claim an implementation exists. Status vocabulary and decisions are maintained in [DECISIONS.md](DECISIONS.md). “Requirement” means explicit in the brief; numerical targets and implementation defaults remain provisional.

Implementation update, 2026-10-29: M2A/M2B local mock increments have passing automated evidence. M2C now authorizes local OpenAI conversation and personal Pushover; its implementation and pending live acceptance are tracked in STATUS. No actual phone arrival or model selection is yet claimed. Account admission remains operator-controlled, with no public self-registration. The precise processor/budget authorization below supersedes earlier unresolved cloud defaults.

Continuation 2026-10-31: local database/live acceptance is deferred to another machine. Independent M2C source/UX and mocked tests continue under the existing processor/budget approval. M1/full M2 remain partial; a source-only transfer does not carry retained data or prove a restored application. See MACHINE_HANDOFF and STATUS.

Task increment 2026-10-31: focused personal tasks now exist in source in Today/chat, with notes, saved-zone deadlines, completion/reopen/cancel/delete and an explicitly confirmed optional one-time reminder. A deadline does not notify and delivery does not complete a task. Typed/voice proposals share exact review; temporary actions remain off. No projects/shared tasks/recurring task generation or full account lifecycle was added. Runtime and earlier milestone acceptance remain pending in STATUS.

Privacy increment 2026-10-31: Settings now has source implementations of separate cloud consent, user-selectable retention, bounded private JSON export, scoped bulk deletion and resumable account erasure. Deletion scope/provenance/provider/backup limits are explicit. Password freshness and exact confirmation gate sensitive operations; model proposals cannot erase an account. Runtime and earlier milestone acceptance remain pending; see STATUS/ARCHITECTURE.

## Purpose and audience

Help users think, remember, organize, and follow through through useful conversation and dependable, inspectable actions. Capability and responsiveness take inspiration from JARVIS; branding, voices, and visual assets must be original.

The development stages are one real personal user, an invite-only private beta, a public multi-user product, then separately justified integrations, local edition, native companion, and room control. Ownership and authorization apply from the first account. Public launch is not part of the personal MVP.

Provisional planning defaults: one developer with AI coding assistance; desktop and mobile web, Android tested first; English first, including Indian accents; adults only; one owner per account and no shared workspaces; local development followed by private daily use. These are revisable, not approved demographic or market conclusions.

## Required behavior

- Useful text conversation first; voice follows later.
- Configurable assistant name, tone, and communication style, constrained by safety and truthful reporting.
- Explicit, inspectable consent for saved memory. Retaining chat history is a separate setting and disclosure, not approval to treat messages as durable personal facts.
- Tasks and reminders, including phone notifications while the website is closed.
- Honest uncertainty and operational status, including unknown external delivery outcomes.
- Warm and supportive language without pretending to be human, claiming emotions, demanding attention, or encouraging dependency.

The assistant supports everyday organization. It is not an emergency alerting system or a substitute for professional judgment. No promise of uninterrupted availability or guaranteed notification delivery is appropriate.

## MVP boundary

Milestones 1–5 form the personal MVP. Milestone 2 is the first complete flow, not the finished MVP. It includes one-time reminders; The roadmap places daily/selected-weekday recurrence in Milestone 3; a later explicit instruction authorized its focused implementation ahead of deferred M2 runtime acceptance. That does not complete M3 general tasks or accept earlier milestones. Basic memory inspection, approval, deletion, and export accompany first memory storage; Milestone 4 expands the lifecycle and account-wide privacy controls. Security and accessibility accompany each feature.

Excluded from the MVP: billing, public sharing, uploaded documents, email/calendar integrations, autonomous browsing, room control, shared accounts/workspaces, an app marketplace, always-on listening, and simultaneous local/cloud editions. Authentication email via SMTP is infrastructure, not an email integration. Audio recording for voice is not general document upload.

Future semantic retrieval requires an evaluation that demonstrates a meaningful improvement over structured filters and full-text search. No vector database or agent framework is needed by default.

## Privacy and consent

Cloud mode would store application data in managed infrastructure and send selected conversation context and approved memories to the enabled AI provider. Speech would send audio to transcription and reply text to synthesis. Notification processors receive a minimal generic payload. The operator and processors remain inside the trust boundary; this is not end-to-end encryption against them. See [ARCHITECTURE.md](ARCHITECTURE.md) for the distinctions between training, retention, encryption, and locality.

**Confirmed M2C scope:** OpenAI may process messages and relevant selected approved memories; Pushover may process generic notifications for the explicitly bound personal Android account. Application/database remain local. The monthly ceiling is ₹1,500: ₹1,000 AI, ₹500 separate contingency; the initial evaluation is limited to ₹200 within AI. The approved Pushover trial/possible $4.99 one-time Android purchase is separate. No paid hosting, public deployment, voice or unrelated subscription is authorized. Controlled acceptance starts with synthetic data. `store:false` is not zero retention, no provider data-sharing opt-in is enabled by the application, and operator/processor access remains within the trust boundary. Hosted regions/backups/operational readiness remain unresolved future gates; changing providers requires disclosure.

Memory approval shows exact text, source and date, scope, and any sensitivity label. Editing approved content creates a new version requiring approval. The model cannot approve on the user's behalf. A correction resolves or flags conflicts rather than silently overwriting history.

Temporary chat persists no conversation, summary, memory candidate, or content log. Current M2C disables memory retrieval and persistent actions in temporary mode and points to retained conversation/Today with a persistence disclosure. Content-free usage records still account for live cost. Enabled OpenAI processing carries its separate provider-retention limitations; closing/refreshing ends only application-held temporary content.

Deleting memory does not automatically delete its source messages. The interface offers separate choices and explains derivatives, queued work, and backup expiry. Deleted or rejected information must not be silently re-extracted.

## Core journeys

| Journey | Expected interaction and evidence |
| --- | --- |
| First useful reminder | Sign in; show concise data disclosure; configure phone channel when first needed; request a test with generic text; converse; review an exact memory candidate; approve it; preview reminder with date, time, IANA zone and channel; confirm; show saved/scheduled separately; observe a phone notification with the site closed. Onboarding may skip memory until useful, but the acceptance scenario covers every step. |
| Remember deliberately | “Remember this” opens a preview. User edits/approves; Memory shows provenance and active version. Unapproved proposals never appear in long-term retrieval. |
| Correct or forget | Inspect source and versions; correct with approval or delete; show whether source history remains; revoke stale derivatives and prevent re-extraction. |
| Act without AI | Today offers deterministic create/edit/cancel/complete controls. Existing reminders continue when inference is down or budget is exhausted. |
| Recover from failure | Keep unsent work marked unsaved; show a retryable error; reconcile durable operation status before retrying. Never turn a provider timeout into a success statement. |
| Temporary interaction | Clearly label temporary mode before typing; keep content in volatile memory; disclose persistent actions independently. |

## Success measures — targets, not results

- First complete flow: all steps pass on desktop and Android, including a closed-site phone check. Record provider acceptance separately from observed device arrival.
- Usability: personal user creates a first useful reminder within five minutes after channel setup; later beta target is at least 80% of invited test participants completing it unassisted. No analytics content capture.
- Trust: zero unapproved memory retrievals, false committed-action claims, or cross-account exposures in the adversarial test suite. Any such failure blocks release.
- Reliability: at least 99% of eligible reminder occurrences begin dispatch within 60 seconds under a healthy-service test load; outages and invalid channels are reported separately, never excluded silently. See DESIGN.md for measurement definitions.
- Usefulness: during a 14-day personal pilot, record a voluntary weekly usefulness score and whether tasks/reminders helped follow-through. Avoid engagement or emotional-dependency targets.
- Accessibility: core flows satisfy WCAG 2.2 AA checks, keyboard use, screen-reader tests, and reduced motion before personal MVP completion.
- Cost: measured usage reconciles with provider billing categories; no live evaluation or hosting until a budget is set. No cost estimate is presented as a verified quote.

## Open product decisions

The scoped local OpenAI/Pushover permission and spending limits above are approved. Account setup, bounded evaluation/model selection and observed phone arrival remain operational acceptance work. Hosted regions/retention/backup restore, SMTP and deployment remain future gates. The implemented server-only HttpOnly session design and its tested limits are documented in ARCHITECTURE; no public/beta readiness is inferred. Branding, voice and optional dark mode remain separate. See DECISIONS and STATUS for current versus historical evidence.

Voice increment (2026-10-31): the explicit feature task implements push-to-talk with transcript review in the existing conversation flow and optional browser-reported local read-aloud. This is source implementation with runtime/device acceptance deferred, not completion of every M5 roadmap capability. No always-on listening, cloud synthesis, Realtime, deployment or earlier milestone acceptance is implied. See STATUS and MACHINE_HANDOFF for evidence and remaining gates.

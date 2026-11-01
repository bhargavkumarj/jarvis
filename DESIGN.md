# Finishing pass — 2026-11-01

Keep the existing quiet visual system. Source changes add a short optional name/style/zone setup, draft-only first actions, accurate provider/retention disclosures, consistent page titles, labelled UTC metadata, unavailable provenance, responsive long-text controls and route focus restoration. Suggestions do not overwrite a nonempty composer or send automatically. Preferences save refreshes the existing workspace identity. Streaming/session/privacy states remain distinct from a successful operation.

No decorative dashboard, visual framework, new processor or continuous motion. Existing reduced-motion rule is retained. Initial markup/source checks and production compilation passed; **no visual browser, interactive accessibility, screen-reader, physical-device or mobile-performance verification was performed**. Prepared browser/axe/focus/cross-user cases remain written—not executed.


---

# Experience and visual design

Baseline proposed 2026-10-27; implementation updated 2026-10-29. Quiet-instrument direction and WCAG 2.2 AA are requirements; exact tokens, breakpoints, copy and timing budgets below are provisional defaults. Auth, settings, conversation, memory and reminder screens exist; executed automated evidence and deferred manual checks are recorded in STATUS. Product journeys are in [PRODUCT.md](PRODUCT.md); state semantics are defined in [ARCHITECTURE.md](ARCHITECTURE.md).

## Visual system

Use warm surfaces, deep ink, restrained dark teal, clear typography and purposeful whitespace. Prefer a page with a few well-separated sections over a stack of decorative cards. Reserve containers for approval previews, actionable state, and contextual details. No superhero iconography, glowing reactor motif, cloned voice, or simulated human presence.

| Token | Proposed value / use |
| --- | --- |
| Surface base | `#F7F5F0`, warm off-white page |
| Surface raised | `#FFFFFF`, composer/sheets only where separation helps |
| Text primary | `#172C30`, main copy |
| Text secondary | `#526260`, supporting copy; still must meet text contrast |
| Accent | `#0B5F5B`, primary controls/links; white text on filled controls |
| Border subtle | `#D8DDD6`, decorative separators only |
| Border control | `#71827C`, input/button boundaries where needed for contrast |
| Focus | `#0B5F5B`, visible 3px outline with 2px offset; choose a contrasting alternate on teal surfaces |
| Error | `#A32F2B`, text/icon plus explicit label |
| Warning | `#79530B`, text/icon plus explicit label |
| Type | System sans stack initially, no remote font dependency; body 16–18px, line height 1.5–1.65; headings 24–32px with restrained weight |
| Reading width | Conversation text around 65–75 characters, workspace maximum about 1120px |
| Spacing | 4, 8, 12, 16, 24, 32, 48px scale |
| Corners | 8px controls, 12px contextual surfaces; avoid pill-shaped containers everywhere |
| Elevation | Minimal; one soft shadow for floating sheets/popovers, not every row |
| Motion | 120–180ms opacity/position transitions to explain state; no continuous decorative animation; reduced-motion mode removes nonessential movement |

Check every rendered text/control/focus combination, including disabled, selected and error states. A token list is not a WCAG certification. Target ≥4.5:1 normal text, ≥3:1 large text and essential non-text boundaries. Dark mode is deferred; do not ship an untested automatic inversion.

## Navigation and responsive layout

Four destinations: **Assistant, Today, Memory, Settings**. Current destination uses icon plus label and semantic current-page state. Preserve navigation order and user context across screen sizes.

Desktop proposal at ≥1024px: a quiet 216px sidebar, readable central workspace, optional 320px detail panel only when it fits without compressing the conversation. At 768–1023px collapse the sidebar and open details as a sheet. Mobile below 768px: one column, labeled bottom navigation, composer above the safe area/keyboard, full-screen detail sheets with explicit Back/Close. These breakpoints must be tested rather than treated as device categories.

At 320 CSS px and 200% zoom, primary flows must remain operable without horizontal page scrolling. Long memory text, URLs and operation errors wrap. Bottom navigation/composer must not obscure focused controls or the latest message. Preserve manual scroll position; auto-scroll only when the user is already following the newest output, with a “New response” jump control otherwise.

## Screens and interaction contracts

| Screen | Content / important behavior |
| --- | --- |
| Sign in / onboarding | Short purpose and cloud disclosure; authentication with recoverable errors; visible synthetic/local mode during development. Offer one useful reminder quickly. Request channel setup only when needed, with optional test and explicit result. No microphone permission on entry. |
| Assistant | Retained/temporary mode badge before typing; text composer, send/stop, response stream and source references; exact approval/action previews inline. Name/tone settings never conceal AI identity. Mic control arrives in M5. |
| Today | Due/overdue/completed tasks and upcoming reminders in chronological groups; explicit timezone; deterministic create/edit/complete/cancel/snooze controls. Show pending scheduling, late/expired/unknown outcomes and channel repair. |
| Memory | Approved active entries first; separate pending/review/superseded views; exact content, source/date, approval timestamp, version/effective dates and sensitivity. Approve, edit, reject, delete and export are keyboard accessible. |
| Settings | Assistant name/tone/style, timezone, history/temporary preferences, processor disclosure/consent, notifications, usage limits, session management, account export/deletion. Disabled future features have no misleading working controls. |
| Reminder detail | Original intent and normalized next occurrence; zone/offset; series vs occurrence actions; delivery attempts with timestamps and evidence labels, not a single “sent” badge. |

Memory preview copy: “Save this exact information for future conversations?” Show source and content; buttons Approve, Edit, Not now. No prechecked approval or approval hidden in a general terms checkbox. Sensitive metadata does not replace consent.

Reminder preview: absolute date, local time, IANA zone, channel, recurrence and late policy. Confirm saves only after deterministic validation. If queue publication is delayed: “Saved. Scheduling is pending.” Provider acceptance: “Notification service accepted it.” Unknown: “It may have been sent. Retrying could send another notification.” Never show “Delivered” without corresponding evidence.

Temporary mode copy: “This chat is not saved by the application. Enabled cloud providers may retain processing data under their policies.” A persistent-action preview says which fields will be saved and that the surrounding chat will not. When cloud is disabled, use accurate local-only development copy instead. Do not display an unconditional provider-retention statement as a local feature warning.

Deleting memory shows whether source messages remain and offers a separate source-deletion scope. Account deletion explains access shutdown, active purge, backup expiry and non-retractable processor/device copies. Use reauthentication for account deletion/export where appropriate, visible progress and a final status grounded in actual cleanup evidence.

## States and recovery

| State | Required feedback and next action |
| --- | --- |
| Loading | Stable skeleton or short status text; label the busy region; avoid layout jumps and fake percentage progress. |
| Empty | One concrete example and relevant create action. Memory empty state explains deliberate approval. |
| Offline before save | “Not saved — reconnect to try again.” Draft remains volatile by default; temporary content never goes into localStorage/IndexedDB. Warn before a navigation that loses a draft. |
| Disconnect after submit | “Checking status” using operation ID; no duplicate automatic mutation. Show unknown if reconciliation cannot establish outcome. |
| Permission denied | Explain the specific capability and how to re-enable it. Keep text and deterministic task controls available. Do not repeatedly prompt. |
| Auth expired/revoked | Remove private UI/cache state, preserve only an explicitly disclosed volatile unsent draft if safe, prompt sign-in; never resubmit actions automatically. |
| Provider failure / quota | Plain cause when known, retry timing and text/manual fallback. No invented assistant reply or silent provider change. |
| Partial AI stream | Label incomplete output; Stop/Retry uses a fresh turn or reconciled operation, not replayed tools. |
| Validation / conflict | Focus error summary and field; retain entered values; explain stale version and let user review current state. |
| Worker/channel unavailable | Saved reminders remain visible; show scheduling/channel warning and repair. Do not represent a scheduled reminder as guaranteed delivery. |
| Recovery after outage | Show missed/expired entries and controlled catch-up status; do not flood the user with old notifications. |

Default lock-screen text is generic. Reading details requires authenticated navigation. Explicit reminder opt-in is separate from optional check-ins/briefings; unsolicited engagement nudges are off. Warm copy can say “Let's break this into steps”; it must not say “I missed you” or imply emotional need or human consciousness.

## Voice progression

1. Push-to-talk recording with a clear start/stop action and first-use microphone explanation.
2. Editable transcript, explicit send, optional spoken response with text visible and stop/mute controls.
3. Foreground streaming and interruptions only after latency, consent and cancellation behavior pass tests.
4. Native/local companion only when a concrete need justifies it; no web wake-word promise.

| Voice state | Visible and accessible behavior |
| --- | --- |
| Idle | Mic inactive; permission requested only on user action. |
| Listening | Clear recording indicator and elapsed time, Stop/Cancel; no waveform-only meaning. Proposed 60-second cap per recording. |
| Transcribing | Mic tracks already stopped/released; progress label; Cancel and text fallback. |
| Transcript review | Editable text with names/numbers/dates highlighted for review when uncertain; no automatic reminder execution. |
| Processing | Submitted transcript visible; Cancel/Stop and normal tool-confirmation rules. |
| Speaking | Visible text plus playback/stop/mute; no concealed listening. |
| Interrupted | Stop playback promptly, cancel pending speech work where possible, release microphone when no longer requested; committed actions remain committed. |
| Error | Specific recording/network/provider failure; retain editable transcript if available; retry or type. |

On recording end, cancel, route change, page hide or error, release microphone tracks and revoke temporary object URLs. Foreground conversation may listen only while explicitly enabled and visibly active. OS/browser suspension and permission revocation are normal failure states. Do not claim the website can reliably listen in the background.

Evaluate transcription separately for Indian accents, quiet/noisy environments, names, numbers, dates and each supported language. English support does not establish Hindi or other language quality. Evaluate synthesis independently for pronunciation, intelligibility, pace and preference; use original licensed provider voices, not celebrity/character cloning.

## Accessibility acceptance

Use semantic headings, landmarks, native controls and labels; dialogs/sheets manage focus, support Escape where safe, and restore focus to their opener. Provide a skip link, visible focus and keyboard alternatives for every action. Mobile touch targets aim for 44×44px; check WCAG 2.2 target-size/spacing requirements. Do not use color, sound or motion alone to communicate status.

Stream announcements are buffered by meaningful chunks, not every token; use a polite live region and a way to stop announcements. Errors and final action results are announced once. Voice playback never substitutes for readable text. Authentication supports password managers/paste and avoids cognitive puzzles without alternatives. Test with keyboard, desktop screen reader and Android TalkBack, zoom/reflow, contrast and reduced motion. Automated checks supplement manual use. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) was accessed 2026-10-27; compliance is a target requiring validation.

## Performance objectives — unmeasured

| Measure | Proposed target / exact boundary |
| --- | --- |
| UI feedback | p95 ≤100ms from tap/key action to visible local feedback, independent of network save |
| Navigation | p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative mobile profile; measure authenticated pages without content analytics |
| Save acknowledgement | p95 ≤1s from validated request at web edge to committed mutation response, excluding deliberate confirmation wait |
| First text | p95 ≤3s from accepted submitted turn to first useful text delta; include queueing/retrieval/provider startup, exclude user confirmation pauses |
| Full response | p95 ≤15s for the defined short conversational fixture; record longer tool turns separately, total turn deadline 45s |
| Transcript | p95 ≤3s from release of a ≤15-second recording to editable transcript, measured per device/network/provider |
| First audio | p95 ≤2s from reply text segment ready for synthesis to audible playback; separately report stop-recording → first audio, target ≤8s for short fixtures |
| Interruption | p95 ≤200ms from Stop action to local playback silence; cancellation at providers can lag and still incur usage |
| Reminder dispatch | ≥99% of eligible occurrences start the first provider attempt within 60s of due UTC time under healthy-service test load; p95 target ≤30s |
| Phone arrival | Record observed arrival minus due time and provider acceptance separately; no guaranteed bound for OS/network/device delivery |

Initial measurement profile: mid-range Android on representative 4G, desktop on normal broadband, 100 synthetic active schedules, up to 10 due in a minute, and one active user for personal mode. Beta repeats with concurrent users and a declared workload. Report sample size, p50/p95, cold/warm start, errors, outages and unknown results. UI speed does not excuse representing unsaved data as saved. These budgets guide evaluation, not claims about provider SLAs.

## Implemented M2A interaction details — 2026-10-29

Assistant now has real retained conversation history, new/temporary controls, transcript, composer, streaming/stop and retry states. A persistent disclosure says deterministic mock/no live AI and synthetic data only. Partial text is labeled unconfirmed; stop/failure removes it rather than rendering a completed answer. Retried retained turns reuse their request identity. History never contains fabricated facts/tasks.

Memory separates pending exact-content review from approved notes. Save an edit before approving its new version; conflicts show the existing approved note and require a replacement checkbox. Source/date inspection is account-scoped. Deletion preview explicitly states that source user messages remain, while approved payload and derived saved replies are cleared. Conversation deletion separately discloses independently approved memories surviving without source links.

The existing quiet tokens/native controls continue: responsive single-column collapse, wrapping message text, non-sticky composer, touch-size controls, focus outlines, labeled textareas, error focus and polite completion status. Automated axe/320px checks extend to these screens. Manual screen-reader and real-phone keyboard/scroll remain **Deferred—not tested** until before private beta; this implementation does not claim their results.

## M2B Today and reminder receipts — 2026-10-29

Today now contains a real one-time form, exact schedule review and persisted reminder list. Labels distinguish local date/time, explicit IANA zone, resolved UTC, clock-overlap choice, mock channel and draft version. Changing fields removes the confirmation until reviewed again. Gap/ambiguous/past/invalid times receive actionable errors; no guess is presented as saved. Hydration gates controls as in M2A. A review is explicitly a persisted draft; only confirmation requests scheduling.

The list exposes current scheduling state, cancellation and inspected attempt history. A refresh reads actual records; there are no invented attempts or phone-delivery ticks. “Saved — scheduling pending,” “Scheduled,” “Attempt started,” “Retry scheduled,” “Simulated acceptance,” “Failed,” “Outcome unknown,” “Cancelled” and “Expired” are distinct. The operation receipt is a committed historical result; refresh shows current worker state. Cancellation copy explains the in-flight race. Mock disclosure and infrastructure/host-awake requirement remain visible.

The narrow chat command reports a committed draft/operation reference and directs the user to Today for review. Temporary conversations explicitly disable reminder persistence. Form controls keep labels, visible focus, keyboard access, status/error announcements and the existing responsive tokens. Automated 390/320px/axe coverage is added; manual screen-reader and actual phone keyboard checks remain **Deferred—not tested before private beta**.

## M2C provider and evidence states — 2026-10-29

Assistant exposes an explicit mock/OpenAI choice only when live configuration is available to the bound account. Unconfigured live use fails visibly without fallback. Streaming text is preview/model output; server operation receipts occupy a separately labeled region. Memory shows exact proposed text, explicit review and conflict replacement; the model cannot approve. Temporary mode explains application ephemerality and the separate enabled-provider retention boundary.

Today defaults to mock delivery. Pushover requires explicit channel selection, exact time/zone/UTC/channel review and confirmation. Historical mock reminders remain mock. Attempts distinguish Simulated acceptance, Provider accepted and Phone observed (user report); the last requires a separate action and approximate timestamp. No API result is labeled device delivery. Unknown outcomes explain possible sending/duplicate risks, without an automatic resend.

Settings exposes configured/not-available status, selected model when known, numeric estimated/reserved AI usage, remaining allowance and an 80% alert. Never expose keys/user tokens, full provider responses or private channel credentials. State ₹1,000 AI/month, ₹200 initial evaluation within it and separate ₹500 contingency. Explain retained 30-day conversation expiry, independent approved memory and unverified physical backup/WAL expiry. Automated tests are regression evidence; manual screen-reader/real-phone keyboard/scroll remain Deferred—not tested before private beta.

## Independent M2C UX pass — 2026-10-31

Live conversations use live-specific help, waiting and retry labels; a late availability response cannot override a provider the user already selected. Refusals display as text only after valid completion; fixed safe failure reasons explain allowance/access/rate-limit/timeout problems. Switching/new/deleted/temporary conversations clears previous operation receipts. History and memory show loading/unavailable separately from confirmed empty data; memory edits reset exact-review confirmation. Pushover drafts retain their selected live-channel label during availability failure and cannot be confirmed while that availability is unverified. Exact review receives focus; Settings can refresh masked status and does not represent missing usage as zero.

Three server-markup tests validate initial loading/labels/no premature reminder confirmation only. Interactive focus, keyboard, 320/390px reflow, reduced-motion and axe/runtime checks still need the new-machine browser suite. Manual screen-reader/real-phone keyboard/scroll remain Deferred—not tested before private beta. No new browser/accessibility conformance claim is made from source or mock tests.

## Recurrence/snooze increment — 2026-10-31

Today separates a series calendar from occurrence delivery rows. Review lists up to three exact local/UTC/offset/adjustment values, fixed zone/channel/policy and version before confirmation. Editing removes the current preview. Series actions name their scope; snooze names the single occurrence and explains the overlap/send limits. Existing warm/teal controls, wrapping layouts, labels/fieldset legends, hydration-disabled controls, focused review/errors and polite status announcements are reused. No animation was introduced. Initial markup compiles/tests; actual desktop/mobile axe, keyboard/focus/reflow and browser behavior for the new controls are **written—not executed**. Manual screen reader/real phone remains **Deferred—not tested before private beta**.

## Implemented push-to-talk/local-output slice — 2026-10-31

Explicit Start/Stop/Cancel and a non-pulsing recording indicator/timer replace hold-to-record. Timer ticks are hidden from assistive announcement; phase/status/errors use live regions. Capture stops on page hide and never resumes/uploads automatically. Stop focuses Transcribe; cancellation/errors restore the microphone control. Review is a labeled focused editable textarea with a separate Insert and ordinary Send. Keyboard typing remains available. Recorded/unsent text has no persistent browser storage. Completed-only Read aloud uses a local-voice picker, page-only rate and Stop, never auto speech; omitted/truncated content is disclosed. Responsive controls reuse existing warm/teal design with no new motion. Actual focus/axe/reflow, browser/device capture and screen-reader behavior are **written/deferred—not tested**, not established by source markup or simulated capture units.

## Focused task UI — 2026-10-31, runtime verification pending

Today reuses the existing restrained rows/forms: task groups Overdue, Due today, Upcoming, No due date, Drafts, plus an explicit completed/cancelled filter. Required title quick entry makes no notification. Task detail holds notes, saved-zone deadline and optional linked reminder. Manual Save/Complete/Reopen/Cancel are deterministic; model proposals have a distinct exact review and Delete has an explicit content/retention confirmation. Separate reminder preview shows local time, IANA zone, UTC, clock resolution and mock/live channel; editing its fields hides confirmation until another review. Linked reminders are shown with their task rather than as unrelated standalone rows.

No optimistic status is announced before commit; request identity survives an uncertain result. Review/error/detail sections are focus targets, buttons use existing focus/44px patterns, task-specific live text avoids replacing the existing reminder status region, and text/controls wrap at narrow widths. No motion was added. Server-clock snapshot drives deadline grouping. These source choices and written axe/reflow/keyboard cases are not interactive or manual accessibility evidence. Screen-reader/real-phone checks stay deferred.

## Privacy Center — 2026-10-31, runtime acceptance pending

Settings reuses labelled fieldsets and restrained forms: separate text/audio/notification permissions, warned retention, password freshness, bounded private export, exact deletion review and progress. Model/voice text never submits account erasure. Dangerous scopes describe dependencies before the exact phrase; queued/partial/external/complete states are distinct. Errors and saved state have stable focus targets, long text wraps, and no motion was added. The content-free public status shell uses an HttpOnly receipt after account access is blocked. It reveals no content/keys and never calls a pending stage complete. Cross-tab events invalidate views/voice; server source/epoch/retired-ID gates, not hidden UI, enforce the boundary. Four prepared browser cases include download/confirmation/reflow/axe; none has run, and SR/real-phone checks stay Deferred—not tested.

# Working rules

- Inspect the current files, applicable instructions, package manifests, documentation, and Git status before changing anything. Preserve user work and uncommitted changes; do not reset or replace an existing project.
- Read STATUS.md and DECISIONS.md. Distinguish confirmed requirements, provisional defaults, verified technical choices, and unresolved decisions. Do not treat this plan as authorization to implement, spend, deploy, or process personal data.
- Complete only the milestone explicitly authorized in the current task. The documentation task ends with documentation. Future milestone prompts must follow actual repository state.
- Until cloud permission is recorded, use synthetic data locally with external providers disabled. Never request secrets in chat, commit secrets, log credentials/content, or put real personal data in fixtures.
- Derive account identity from a verified session. Enforce API authorization, restrictive database grants/RLS, and matching ownership across all related records. Include two-user adversarial tests from foundation onward. Hidden UI controls are not security.
- Keep provider, integration, database-admin, and worker credentials server-side. Ordinary user requests must not use service-role/admin credentials. Document user-session token exposure honestly.
- Models propose; deterministic services authorize and execute. Use typed/versioned validation, quotas, durable operation records, confirmation where required, and idempotency. Never claim success before evidence establishes it.
- Retrieve only approved active memory. Temporary chats create no durable content; persistent actions require separate disclosure. Deletion must invalidate derivatives and prevent silent re-extraction.
- Use pg-boss for queue execution, retries, and worker machinery. Keep domain schedules and delivery history in application tables. Never promise exactly-once external notification delivery.
- Keep one modular application with web and worker processes and narrow provider interfaces. Add infrastructure only for an evidenced requirement and recorded tradeoff.
- Verify changing platform/model facts against current official sources; record access dates. Pin compatible dependencies during authorized setup, not from memory.
- Test meaningful security, failure, accessibility, and behavioral boundaries appropriate to the change. Run required checks; report what was actually tested and what remains unverified.
- Update affected product/architecture/decision/status documents. Ask only for material missing privacy, scope, security, architecture, or cost decisions; continue independent authorized work.

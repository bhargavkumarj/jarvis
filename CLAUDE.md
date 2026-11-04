# Jarvis

Personal, privacy-first AI assistant: Next.js, local Supabase, a pg-boss worker, and OpenAI only with explicit user consent.

@AGENTS.md

Before any task:
- Follow the working rules in AGENTS.md.
- Read the newest entries at the top of STATUS.md, and DECISIONS.md.
- PROJECT_STATE_REPORT.md has the current feature and test status.

Plan first and wait for approval before changing code, migrations, or anything touching auth, data, privacy or providers.
Never reset, wipe or recreate the local database or Docker data.
Use synthetic data only. Never print or paste values from .env.local or .local/.

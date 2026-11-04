# falsifiable

Diff-scoped mutation testing for AI-written changes. It mutates only the lines a change touched, reruns only the tests that execute those lines, and reports which changed lines no test would notice breaking.

**Read `docs/SPEC.md` before any task.** It is the source of truth for design, scope and milestones. Progress lives in `docs/PROGRESS.md`; update it at the end of every milestone.

## How we work

- Work one milestone at a time (SPEC §8). Start each milestone in plan mode and wait for approval before writing code.
- If a spec decision looks wrong, say so and propose an alternative. Do not silently deviate. Items listed under "Open questions" (SPEC §10) are decided with the maintainer, not by you.
- Small commits, one logical change each, conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
- End every milestone with a short report: what was built, how to run it, test results, deviations from the spec, and anything still unknown.
- The maintainer must be able to explain every design decision in an interview. When you use a non-obvious technique (import hooks, trace functions, process groups, schemata), add a short entry to `docs/DESIGN-NOTES.md`: the problem, the technique, the alternative you rejected and why.

## Non-negotiable rules

- **Never weaken a test to make a change pass.** No deleting tests, no `skip`/`xfail`, no removing or loosening assertions, no widening tolerances, no editing expected values to match new output. This project exists to catch exactly that. If you believe a test is wrong, stop and explain why in your report; the maintainer decides.
- **Expected outcomes for fixture repos are written by hand before the tool runs on them** (which mutants must be killed, which must survive, which lines are uncovered). Never derive expected values from the tool's own output.
- **Never write to the user's working tree** during a check. Mutated source exists only in memory or in temp directories. Never write mutated bytecode to any `__pycache__`.
- **No network calls, no LLM calls and no telemetry in the core.** Network is allowed only in the benchmark harness (cloning repos) and in CI.
- **The shim (`src/falsifiable/_shim/`) is stdlib-only** and must not import `falsifiable`: it runs inside the user's environment, which does not have our dependencies.
- **Fail open in agent hooks.** If the hook hits an internal error, it must not block the agent; it logs a warning instead.
- **Benchmark labels are human-only.** Never fill, guess or pre-fill the `label` column in benchmark CSVs.
- Never handle credentials. Publishing to PyPI is done by the maintainer (or by GitHub trusted publishing, configured by the maintainer).

## Tech stack

- Python ≥ 3.10, src layout, `hatchling` build backend, MIT license.
- Runtime deps: `libcst`, `click`. Optional extra `falsifiable[mcp]`: the official `mcp` Python SDK. Add any other runtime dependency only with approval.
- Dev deps: `pytest`, `ruff`, `mypy`, `jsonschema`.
- Type hints everywhere; `mypy --strict` on `src/`.

## Commands

```bash
uv sync --all-extras          # set up
uv run pytest                 # all tests
uv run pytest -m "not slow"   # fast loop
uv run ruff check . && uv run ruff format --check .
uv run mypy src
```

Run all four before declaring a task done. From Milestone 3 on, also run `uv run falsifiable check` on your own change and report the result; weak lines in new code need a test or a written reason.

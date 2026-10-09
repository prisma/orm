# Dispatch 6 — Journeys, docs and upgrade fragments

**Slice:** [`../spec.md`](../spec.md) § Done when, § Scope · **Plan:** [`../plan.md`](../plan.md) dispatch 6 · **Builds on:** dispatches 1–5

## Outcome

The slice's done conditions hold through journeys on Postgres and SQLite, and the docs, error reference, skill and upgrade fragment describe the new behaviour.

## What to build

1. **Journeys**, on tables with rows, on both targets:
   - a type change: refused without a flag; `--convert`, fill the slot, run `migration.ts`, `migrate`, rows converted; `--delete` plans the direct change;
   - a new required field: no flag gives the temporary value; `--backfill`, fill the step, `migrate`;
   - an optional field made required with NULLs present: the failure names the rows; after setting them, it applies;
   - `db update --convert` refused, and its printed `migration plan` command run as printed;
   - afterwards a further plan is empty and `db verify --schema-only` is clean.
2. **Follow every printed advice to its end** (F46), on each target, including the `db update` refusal through `migrate` on a database created by `db init`.
3. **Docs.**
   - Migration System doc § Statements: `--convert` and `--backfill`; the loss kinds; the questions per command; remove the sentence saying the Postgres planner writes no placeholder data transforms (§ Authoring intermediate state); § NOT NULL columns without defaults now applies to `migration plan` too.
   - `docs/reference/error-reference.md`: every code added or changed.
   - The CLI README sections for `migration plan` and `db update`.
   - `skills/prisma-8/references/migrations.md`: type changes and new required fields.
4. **App upgrade fragment** (`record-upgrade-instructions` skill): lossy type changes now ask; placeholders only with `--convert` or `--backfill`; a new required field gets a temporary value under `migration plan`; `alterColumnType`'s options (if dispatch 2's instructions do not already cover it).

The orchestrator writes the ADR 200 amendment; do not edit that file.

## Gate

The plan's gate, plus `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`, `pnpm lint:docs`, the journey files, and every other file under `test/integration` or `test/e2e` that runs `migration plan` or `db update` on Postgres or SQLite, directly or through `journey-test-helpers.ts` (F44).

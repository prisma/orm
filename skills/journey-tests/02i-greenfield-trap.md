# Journey 02i — Second plan in a project with no `db` ref

**Skills under test:** `prisma-orm-migrations` (migration-model, migrations).

**Acceptance criterion:** — (added with the migration mental-model rework).

## Setup

A project with one committed, applied migration (`null → H1`) and **no** `migrations/app/refs/db.json` — the deploy-first shape: the database was migrated by a pipeline, and nothing ever ran `db init` / `db update`. The contract source has one small pending edit (e.g. a new nullable field), already emitted.

## Prompt

> Plan the migration for my contract change.

## Expected agent behavior

- [ ] Checks where the plan will chain from before (or immediately after) running `migration plan` — reads `migration ref list` and/or the plan output's `from:` line.
- [ ] Recognizes that a default plan here resolves to greenfield (`from: (baseline)`) while a migration already exists on disk, and does not accept that plan.
- [ ] Deletes any mistaken from-scratch package it produced.
- [ ] Takes one of the two incremental exits: `migration ref set db <H1>` then re-plan, or `migration plan --from <first-migration-dir> --name <slug>`.
- [ ] The final planned migration is a one-field delta (`from: H1`), not a full-create.

## Success criteria

- [ ] The committed plan's `migration.json` has `"from": "<H1>"`, not `null`.
- [ ] Agent either set the `db` ref to a graph node or explained the `--from` chaining it used.
- [ ] Agent did NOT apply or commit a `from: (baseline)` package.
- [ ] Agent handled `MIGRATION.PLAN_ORIGIN_UNKNOWN` correctly if it hit the refusal: it chose the exit matching its intent instead of reflexively passing `--from @empty`.

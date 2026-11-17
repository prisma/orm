# Dispatch 4 — Journeys, docs and upgrade fragments

**Slice:** [`../spec.md`](../spec.md) § Done when, § Scope · **Plan:** [`../plan.md`](../plan.md) dispatch 4 · **Builds on:** dispatch 3

## Outcome

The slice's done conditions hold through journeys on real MongoDB, and the docs, error reference, skill and upgrade fragments describe what MongoDB now does.

## What to build

1. **Journeys** (in `test/integration/test/cli-journeys/delete-statements-migration.mongo.e2e.test.ts` or a sibling file), on collections with documents, through `migration plan` then `migrate` and through `db update`:
   - a model rename, a field rename with a unique index on the field, and a field removal with `--delete`, in one run;
   - a variant's field rename in a collection where another variant stores a field with the same name;
   - afterwards: documents under the new names; the removed field gone from every document; every document accepts an update; a further plan is empty; `db verify --schema-only` is clean;
   - without `--delete`, both commands refuse, and the printed flags then succeed when run as printed;
   - a second `db update` with the same statements fails on the first statement;
   - `db update` with no snapshot: a removed field is named `<collection>.<field>`, and `--delete <collection>.<field>` works.
2. **Follow every printed advice to its end** (`drive/calibration/failure-modes.md` F46): each refusal, error and dry-run suggestion this slice adds or changes is run as printed in a journey or a probe, and the end state checked.
3. **Docs.**
   - `docs/architecture docs/subsystems/7. Migration System.md` § Statements: MongoDB carries out renames and deletes; remove the `renameStatements` paragraph and the "MongoDB refuses every statement" limit; say how a field is named (contract key, the stored name on MongoDB) and that a variant's field rename touches only that variant's documents.
   - `docs/architecture docs/subsystems/10. MongoDB Family.md`: the operation list gains `renameCollection`, `renameField`, `unsetField`; remove the stale "Known gaps" paragraph under § Polymorphic variants (TML-2447's gaps are fixed on `main`).
   - `docs/reference/error-reference.md`: every code this slice adds or changes.
   - The CLI README sections for `migration plan` and `db update`.
   - `skills/prisma-8/references/migrations.md`: renames and deletes on MongoDB.
4. **Upgrade fragments** (`record-upgrade-instructions` skill):
   - app: MongoDB renames work; removing a field now asks and `--delete` removes it from every document;
   - extension: `TargetMigrationsCapability.renameStatements` and `keepDataByHand` are gone (shipped in 8.0.0-rc.17).

The orchestrator writes the ADR 188 and ADR 264 amendments; do not edit those two files.

## Gate

The plan's gate, plus `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`, `pnpm lint:docs`, the journey files, and every other file under `test/integration` or `test/e2e` that runs `migration plan` or `db update` against MongoDB, directly or through the helpers in `test/integration/test/utils/journey-test-helpers.ts` (F44).

# Dispatch 20: fixes from manual QA and the round 2 verification of PR 3

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Sources:** the QA report `projects/migration-statements/manual-qa-reports/2026-10-23-qa-3b-pr3.md` (F1–F10) and the verification report `wip/reviews/verify-round2.md` (three minor findings) · **Branch:** `tml-3537-value-objects-storage`

Each item records the decision; do what it says. Write a failing test first for every behaviour change.

## Upgrade instructions

1. **QA F1: the steps leave a stale `db` ref.** The app instructions say to run `db sign --db`, which writes `migrations/app/refs/db.json`. Then `db migrate` does not move that ref, so the next `migration plan` forks the graph and writes a duplicate migration. Change the steps so they leave the ref correct. Work out from the CLI which form is right, for example `db migrate --advance-ref db`, or `db sign --no-advance-ref` together with `--from`. Then run the corrected steps end to end on PGlite against a copy of `examples/prisma-8-demo` from `git merge-base HEAD origin/main`:
   - Use that merge base's CLI to migrate, and the current CLI to upgrade.
   - The second `migration plan` with no change must write nothing.
   - Do the same on `mongo-demo` with mongodb-memory-server, as far as its history allows (TML-3749 covers its broken history).
   - Remove the sentence about projects with no `db` ref if the steps never reach that case. Otherwise say when it applies.
2. **QA F4: say when to upgrade the packages.** Add the step "upgrade the Prisma packages" in its place, between applying pending migrations and running the script.

## A check that existing rows break

3. **QA F2 and F3: the failure says what to do.** When applying a migration fails because a derived check refuses existing rows, the error must say:
   - which check, table and column;
   - how many rows fail, if the runner can count them cheaply with the check's own expression. If it cannot, give the query that finds them, built from the check's expression, as in the upgrade instructions;
   - the route that keeps the data: plan with `migration plan`, then add a step to the `migration.ts` it writes that updates those rows, placed between the operation that drops the old check and the one that adds the new check, then apply with `db migrate`. For `db update`, say that it cannot keep this data, and give that `migration plan` route.

   Drop the advice that does not fit this case: "reconcile schema drift" from `db update`, and `--to <contract>` from `db migrate`.

   Follow how PR 2 reported rows holding an enum value. Read `RowsHoldingValue` and the runner failure advice in `packages/1-framework/3-tooling/cli/src/utils/runner-failure-advice.ts`. Reuse that mechanism, and keep target-specific detection in the target. The framework reads only a typed interface.

   Test on PGlite: add a required member to a value object while rows lack it. Check that `db migrate` and `db update` both fail with the new advice and change nothing. Check that following the advice with a hand-written update in `migration.ts` applies cleanly and `db verify --strict` is clean. Add this as a case in `test/integration/test/cli-journeys/value-object-checks.e2e.test.ts`.

## Messages

4. **QA F5: the plan summary for a migration with no operations.**
   - Write the entity kind in words: `value object "public.Home"`, `value set "public.Role"`, `table "public.users"`. Keep the raw kind only in `--json`.
   - When `db update` moves the marker with no operations, say that, and name what changed, as `migration plan` does. Do not say "Database already matches contract" alone.
5. **QA F8: ADR 309 check names.** Give the full built name, `<table>_<column>_shape_<hash>`, where the ADR names the check, and match the upgrade instructions.

## Verification minor findings

6. **The orphaned doc comment.** Move the doc comment of `rewrittenMember` in the upgrade script back above its function (near line 523).
7. **The registry type.** The Postgres codec registry accepts a descriptor without `jsonType`, but its type still says `jsonType` is present. Make the registry's returned type say `jsonType` may be missing, or read it only through `declaredJsonType`. No code may read `descriptor.jsonType` as certainly present.
8. **The script and a malformed `nullable`.** Fill in `nullable: false` only when `nullable` is absent. Leave a malformed value as it is, so validation refuses it.

## Not in this dispatch

- QA F7: on MongoDB, making a member required leaves old documents. Same as before this PR, and a later slice covers MongoDB statements.
- QA F9: filed as TML-3750.
- QA F10: `BigInt` members are in `deferred.md`.
- QA F6: TML-3749.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration`, with `pnpm test <file>`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` and read the file. Never use bare `git stash`, and never `git stash` at all.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Framework packages name no family or target.
- No invented nouns. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly. Commit `projects/migration-statements/slices/remaining-nouns/spec.md` too; it has an edit of mine that is not committed yet.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean.
- `pnpm test:packages` passes, apart from the known tarball trust warning.
- Typecheck passes in every example.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` pass.
- Typecheck, lint and `test --coverage` pass in every touched package.
- These pass:
  - the journeys `value-object-checks`, `value-object-validator.mongo`, `plans-with-no-operations*` and `enum-value-statements*`;
  - the upgrade script test;
  - `sql-orm-client/value-object-checks`.

## Report

Plain English, short sentences: each item, the corrected upgrade steps and the end-to-end run, the new failure message as printed, the tests that were red first, the checks, and the commits.

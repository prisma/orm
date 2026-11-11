# Dispatch 28: journeys on both targets, a temporary value fix, and the docs

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Slice spec:** [`../spec.md`](../spec.md), "Done when" and the table of changes · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21–27 are committed there)

Work only inside the worktree. PR 4 is built. This dispatch makes the slice spec's done conditions provable and finishes the docs.

## 1. A temporary value the codec accepts

`db update` fills a new required value object field with the empty value of its codec's JSON type (`temporaryValueOf` in `packages/2-sql-family/9-family/src/core/migrations/value-object-member-fills.ts`). A date or uuid field stored as a JSON string gets `""`, which is not a valid date or uuid, so the application fails when it reads the row.

- Find how a codec checks or decodes a JSON value. Fill a temporary value only when the field's codec accepts it. Refuse any other field, naming `migration plan --backfill`, as for a value object field.
- If no codec can check a JSON value, stop and report what you found. Do not add a list of codec ids.
- Failing test first, on both targets: a `DateTime` field is refused, a `String` field is filled.

## 2. Journeys

The slice spec says: every journey runs through both `migration plan` and `db update`, and a later plan is empty. Today the journeys are `value-object-backfill.e2e.test.ts` (Postgres), `value-object-checks.e2e.test.ts` (Postgres) and `variant-statements.sqlite.e2e.test.ts` (SQLite). Add what is missing so each case below runs on Postgres and on SQLite:

| Case | Statement |
| --- | --- |
| Value object field renamed, in a column and in a list, nested | `--rename GeoPoint.lat:GeoPoint.latitude` |
| Value object field removed | `--delete GeoPoint.lng` |
| Enum value renamed and removed inside a value object | `--rename Status.ARCHIVED:Status.RETIRED`, `--delete Status.DRAFT` |
| New required value object field | `--backfill Address.country`, and `db update`'s temporary value |
| Variant discriminator value changed | `--convert Bug`, `--rename Bug:Defect`, `--delete Bug` |
| Variant removed: own table, shared columns, no columns | `--delete Bug` |

- Each case reads the rows back after the apply, and ends with a plan that has nothing to do.
- On Postgres, each case shows the new shape check or discriminator check accepts the rows.
- Extend the existing journey files where the case fits; add a `.sqlite` sibling or a Postgres sibling where it does not. Update the journeys README.

## 3. Docs

- Migration System doc (`docs/architecture docs/subsystems/7. Migration System.md`): read the statements section and its rename limits end to end and make them describe what PR 4 ships, as one account, not one paragraph per dispatch.
- `docs/reference/error-reference.md`: every new message.
- The CLI README: `--rename`, `--delete`, `--convert` and `--backfill` for value object fields and variants.
- `skills/prisma-8/references/migrations.md`: the same statements, with one short example each.

## 4. Spec and deferred

- In `projects/migration-statements/slices/remaining-nouns/spec.md`, mark the PR 4 row done when its behaviour is proven, and name the journey that proves each row of the table of changes.
- The spec's implementation note asks to move the MongoDB variant lookup (`variantFilter`, `discriminatorValueChange`) to the framework. Do not do this: the repo rule `.agents/rules/never-change-the-framework-domain.mdc` forbids it. Record it in `projects/migration-statements/deferred.md` as a question for Will, and say where SQL's own variant lookup is.
- Record in `deferred.md`: value object fields cannot carry defaults, so `--backfill` has no default to respect.

## 5. PR text

Write `wip/pr4-description.md` in the worktree:
- the title `TML-3537: <sentence saying what a user can now do>`;
- a concrete example first: a `migration.ts` the planner writes for a value object field rename and for a variant convert;
- then what each statement does, on each target;
- every change in `packages/1-framework`, listed under its own heading, each with one sentence on why it does not change the framework domain;
- what is not covered;
- `Closes TML-3537`, then `Agent: radagast-20` as the last line. No AI attribution lines.

## Rules

- Commit after each item, so a crash loses little.
- In `packages/1-framework`, change nothing. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage` pass.
- Every journey in section 2 passes, and these still pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, `value-object-backfill*`.

## Report

Plain English, short sentences: what you found for item 1 and what you did, the journeys and what each proves, the docs changed, the spec and deferred entries, the tests that were red first, the checks, anything you could not do and why, and the commits.

# Dispatch 5: the warning, the journeys and the docs for PR 1

**Spec:** [`../spec.md`](../spec.md) · **Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (dispatches 1 to 4 are committed there)

Work only inside the worktree. This is the last dispatch of PR 1.

## Carry-over from the dispatch 3 review

Fix these first, each with a test that fails without the fix. The review is `../reviews/code-review.md`, dispatch 3.

1. **Major.** When a list field becomes a single value, the `--convert` filter (`mongo-data-transforms.ts`, around lines 64-75) misses most documents, because `$type` and `$ne` look at a list's elements. Use `$expr` on the value's own type, for example `{ $expr: { $not: { $in: [{ $type: '$age' }, ['missing', 'null', ...types]] } } }`. Check every filter dispatches 2 and 3 wrote for the same problem: the cast filter, the `--delete` filter, the convert and backfill filters. Add runner tests against a real database for list to list, single to list and list to single.
2. A user's `$convert` that fails inside a data transform is reported as the planner's cast, because `fieldRewriteOf` and `castFieldOf` match a transform whose update is one `$set` of one field. Report an operation of class `data` as a conversion (`by: 'conversion'`), so the CLI does not tell a `db migrate` user their `migration.ts` has no conversion. Add a test.
3. Add a case to `migration-e2e.test.ts` that fills a scaffold, runs the file, and compares its `ops.json` with the planner's operations, including a variant filter.
4. The planner check `unsupported` now accepts any field statement. Name `convert` and `backfill` explicitly.
5. `typeChangeConverted` runs twice for each convert statement. Compute it once.

## Behaviour

1. **The failure names what the change touches.** Dispatch 1 left this out. When the validator's document check fails, the message also lists the fields this change requires or retypes, worded as what the change touches, never as the cause (spec, decision 1).
2. **The W1 warning.** With an origin contract, the planner warns, naming the field, when a value object field changes type, a field moves to another value object, or a field gains an enum or changes enum. The warning says these are not statements, and that the documents need a `dataTransform` in `migration.ts` before the validator change; the document check fails the apply until they fit. Use the planner warnings MongoDB already has; show the warning in both commands' output and `--json`.
3. **Journeys.** The spec names `convert-backfill.mongo.e2e.test.ts` with cases C1 to C5, B1 to B4 and W1. Earlier dispatches wrote `type-changes.mongo.e2e.test.ts` and `data-transform-scaffolds.mongo.e2e.test.ts`. Keep those files. Make sure every case in the spec's "What changes for users" table for top-level fields is covered by one of them, through `migration plan` then `migrate` and through `db update` where allowed, on collections with documents, each ending with a further empty plan and a clean `db verify --schema-only`. Add W1. List in your report which file and test proves each spec row, so the spec can be updated.
4. **Docs.**
   - Migration System § Statements and its MongoDB part: the document check and `checkDocuments`, type changes and casts, `--convert` and `--backfill` on MongoDB, temporary values, the warning.
   - `docs/reference/error-reference.md`: every new or changed failure.
   - The CLI README and `skills/prisma-8/references/migrations.md`: the MongoDB statements.
   - ADR 188: scaffolded MongoDB transforms carry a planner-written check; a validator change can check documents. Keep the ADR's own style.
   - The Prisma 6 upgrade guide (find it under `docs/`): what to do when the first validator change fails because existing documents do not fit, including `checkDocuments: false`.
   - An app upgrade fragment for the behaviour changes, following the repo's upgrade fragment rules (look for the `record-upgrade-instructions` skill under `skills-contrib/`): validator changes now check documents; type changes are asked about; new required fields get a temporary value.
5. **Project files.** Fix the old path for `mongo-statement-planning.ts` in `projects/migration-statements/deferred.md` (around line 133). In `projects/migration-statements/slices/remaining-nouns/spec.md`, correct the sentence that says slice 4p refused self-containing value objects: the validator accepts them and checks nothing below the point where they refer to themselves.

Leave the wording of the type change question without an origin contract alone; it waits for Will.

## Rules

- Commit after each behaviour, so a crash loses little.
- Change nothing in `packages/1-framework`. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed. Do not run coverage in parallel with other heavy runs.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief, the spec or the code. Never hard-wrap Markdown prose. Write docs in plain English, short sentences.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- Every behaviour above has a test or doc change, and every fix a test that was red first.
- The checks in the plan's "Checks for every dispatch" pass, plus `pnpm test:packages`, with no journey marked as failing.
- Every MongoDB journey passes.

## Report

Plain English, short sentences: each fix and behaviour and what you did, the warning text, the map from each spec row to the test that proves it, the docs you changed, the tests that were red first, the checks, anything you could not do and why, and the commits.

## Carry-over from the dispatch 4 review (added during dispatch 5)

1. **Major.** `fillField` and the `--backfill` scaffold filter on `{ field: null }`, which on a list also matches `['a', null]` and `[null]`, so a fill replaces such a list with `[]` and a backfill overwrites it, without asking. Use `{ $expr: { $in: [{ $type: '$field' }, ['missing', 'null']] } }` in both, and in their postchecks. Add a runner test showing `['a', null]` stays unchanged. This is the same class as the dispatch 3 list filter fix: sweep every filter, precheck and postcheck dispatches 1 to 4 wrote.
2. Planner tests for fills beside renames: a field renamed to a required field gets no fill; a model rename leaves its fields unfilled; a rename together with a new required field fills only the new field.
3. `sharedCollectionFillRefusals` skips any fill with a filter, so a variant's fill can reach another root model's variant with the same discriminator field and value. Check variant fills with 4a's `otherModelsReached`, as dispatch 2 does for casts, and add a test.

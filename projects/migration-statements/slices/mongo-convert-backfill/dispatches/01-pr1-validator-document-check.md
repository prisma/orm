# Dispatch 1: a validator change checks the documents first

**Spec:** [`../spec.md`](../spec.md), decision 1 · **Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (the spec is committed there)

Work only inside the worktree. Read the spec first; it is the contract.

Today a MongoDB validator change (`collMod`, written as `setValidation(...)` in `migration.ts`) never fails. Documents that no longer fit stay, and each fails its next update with "Document failed validation". This dispatch makes the change check the documents first, when asked.

## Behaviour

1. **`setValidation` takes an optional `checkDocuments: boolean`.** Left out, or `false`, the operation and its `ops.json` are exactly as today, so every existing `migration.ts` re-emits the same `ops.json`. Prove that with the committed migrations under `examples/` that call it.
2. **With `checkDocuments: true`, the operation gets a precheck** that runs an aggregate on the collection: `$match` of `{ $nor: [{ $jsonSchema: <the new validator's schema> }] }`, then `$limit: 1`. It passes when nothing matches.
3. **The precheck's source is a document aggregate.** A validator change is a DDL operation, and today its checks accept only `listCollections` and `listIndexes` (`packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts` 10-17), evaluated through the runner's inspection executor (`packages/3-targets/mongo/.../mongo-runner.ts` near line 604). Extend that check type, inside the MongoDB family, so a DDL operation's precheck can be an aggregate over documents. Do not route it through the DML path by making `collMod` a DML operation.
4. **The failure is typed.** When the check fails, count the documents that do not fit and fail with a runner failure of its own, like `renameOverwriteRefusal`: the collection, the count, one `_id`, and the `mongosh` query that finds the rest (`db.<collection>.find({ $nor: [{ $jsonSchema: ... }] })`). Its `fix` says to change the documents so they fit, or to set `checkDocuments: false` in `migration.ts` to apply the validator over them. Add the error to `docs/reference/error-reference.md`.
5. **The planner writes `checkDocuments: true`** for every validator add or update it plans (`planValidatorDiffCall` in `mongo-planner.ts`, lines 627-665), not for a validator removal and not for a collection the same plan creates. `renderTypeScript` writes the option, and re-running the file reproduces `ops.json`.
6. **The runner skips a DDL operation whose postcheck already passes** (`mongo-runner.ts` 302-309). Keep that: a re-run after the validator was set does not check again.

Naming the fields the change requires or retypes in the failure message is not part of this dispatch; dispatch 5 adds it.

## Tests

Write a failing test first for each behaviour.
- Factory and call class: the option absent gives today's operation exactly; present gives the precheck; `renderTypeScript` round-trips.
- Runner tests against mongodb-memory-server: a collection with a document that does not fit fails with the typed failure and the right count and `_id`; one where all fit applies; the option absent applies over non-fitting documents as today.
- Planner tests: a validator update and a validator add carry `checkDocuments: true`; a removal and a new collection do not.
- Update the expected planner output in existing tests and journeys that now gain the option. Where a journey adds a required field to a collection with documents, it will now fail at apply; that is expected after this dispatch. Mark those journeys and list them in your report; dispatch 4 (temporary values) and 3 (`--backfill`) make them pass again. Do not change their behaviour assertions to hide the failure.

## Rules

- Commit after each behaviour, so a crash loses little.
- Change nothing in `packages/1-framework`. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief, the spec or the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- Every behaviour above has a test that was red first and is green now.
- The checks in the plan's "Checks for every dispatch" pass, except journeys you list as expected to fail until dispatch 3 or 4, with the reason for each.

## Report

Plain English, short sentences: each behaviour and what you did, the shape of the extended check type, an example of the failure text, the tests that were red first, the checks and their results, the journeys now failing and why, anything you could not do and why, and the commits.

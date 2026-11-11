# Dispatch 21: remove the early check, and fix the CLI text

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (tip `a7dcaed365`, pushed as PR prisma/orm#30970) · **Spec:** [`../spec.md`](../spec.md)

Work only inside the worktree. Read the spec's decision 1, ADR 188 and the Migration System doc's MongoDB part first, to see the design you are removing.

## The principle (Will, 2026-11-10)

A migration is a list of operations. Each operation is self-contained: a precheck, an execute and a postcheck, about that operation only. The operation that adds or changes a validator checks the documents against that validator, as its own precheck (the `checkDocuments` option on `setValidation` and `collMod`). No other operation carries that check, and there is no check-only operation. A migration that stops partway leaves its earlier operations applied, as any MongoDB migration does; postchecks let a re-run skip them, and the re-run finishes the migration. Nothing special is done about that case.

## Part 1: remove the early check

Remove, with their tests and docs:

1. The `checkDocuments(...)` operation: its factory, `CheckDocumentsCall`, the `meta.checkDocuments` key and its types in query-ast, the serializer's handling of it, and the refusal of an entry with an empty check.
2. The planner's planning of it: `documentChecksFor` and the rules placing it after collection renames and creates, before index drops and rewrites, and the single-validator-change exception. The plan order returns to 4a's order with no check step.
3. The shared validator `const` in rendered `migration.ts`: `sharedValues()`, `SharedNames`, the renderer's collection of shared values, and `renderTypeScript`'s names argument. Validators render inline again.
4. The runner's extra wording about partial applies: tracking of rewritten collections and validator changes that ran (`rewritesRan`, `rewrittenBeforeValidator`, `validatorSetOn` or their current form), the sentence that rewritten documents may no longer fit the current validator, and the list of operations of the apply that already ran. Keep the framework's own sentence that operations which ran before the failure stay applied.
5. Anything else that existed only for the early check (for example the relaxed-validator code `relaxedSchema` and `rewrittenFields`/`renamedFields` handling, if nothing else uses them). Say in the report what you removed.

Keep: the `checkDocuments` option on `setValidation` and `collMod` and their precheck; the typed failure with count, one `_id`, the per-field reasons and the advice (fix the documents, `--backfill` where the planner accepts it, `checkDocuments: false`, the `db update` route); the "may reject" bypass advice; the dotted-name advice; everything else in PR 1. When a validator change's check fails, its message must still be true: drop "nothing was rewritten" and similar claims about the rest of the apply, since the runner no longer tracks them.

Committed example migrations must re-emit unchanged. Re-running every rendered `migration.ts` must reproduce its `ops.json`.

## Part 2: the CLI text

These are in `packages/1-framework/3-tooling/cli`. Will approved them. They change CLI code and wording only: no framework type changes, no new fields, no family or target vocabulary in identifiers or strings (`pnpm lint:ratchets` enforces the word list; also avoid "rows", "documents" and "collection" in new text: say "data"). The CLI reads only framework types.

1. **Planner warnings in `migration plan`.** `control-api/operations/migration-plan.ts` ignores `plannerResult.warnings` (`MigrationPlannerConflict[]`, which has `summary` and `why`). Pass them into the result; print each as its summary followed by its why, in human output, and include both in `--json`. In `db update` and `db init` (`orm/db/migration-blocks.ts` `plannerWarningBlocks`, `orm/db/planner-warnings.ts`), print the why as well as the summary, and report the warnings when the planner returns them, before the apply, so they appear before any failure rather than after it.
2. **"Existing rows got …"** in `orm/db/migration-blocks.ts` (around line 149) and `orm/migration/plan.ts` (around line 167): say *Field "X" gets the temporary value V where existing data has none* (and the "got"/"would get" tense the code uses), keeping the rest of the sentence.
3. **The generic fallback** in `utils/db-update-failure.ts` (around line 62), "Inspect the reported conflict, reconcile schema drift if needed, then re-run": change to "Resolve the cause the failure names, then re-run `db update`".
4. **`db migrate --to <contract>`** in `utils/runner-failure-advice.ts` (around line 587): re-run the command as the user typed it (`invocation.rerunArgs`), with the same wording as item 3.
5. **"write one there"** in `utils/runner-failure-advice.ts` (around line 414): "{file} changes field X with the database's cast, which met a value it cannot cast: replace that cast with a conversion of your own there, {run}, and re-run …".
6. **The type change question** in `control-api/statements/plan-questions.ts` (around lines 296 to 322): add to the question "`--convert` writes a conversion for you to fill in; `--delete` keeps the field and lets the database cast its values, which can change or lose some." For a storage subject (no origin contract), pass the loss kind so a type change says "would change the type of "X" … and can change or lose its values" instead of "would lose the data in".
7. **The applied count** for `db update` and `db init` (`orm/db/migration-blocks.ts` `applySummaryText`): when fewer operations ran than were planned, use the wording `db migrate` uses in `utils/applied-summary.ts` ("Applied N of M operation(s); the other K had nothing to do, since their postchecks already held"), using the plan's operation count.

Update the CLI tests and journeys that assert the old strings (both Postgres/SQLite and MongoDB journeys may assert them), and add tests for items 1, 3, 5 and 6.

## Docs

The spec (decision 1, "Order inside the rewrite step", and the costs), ADR 188, the Migration System doc, the error reference, the upgrade fragment under `upgrade-instructions/pending/` and `skills/prisma-8/references/migrations.md`: describe the design as it now is. Docs describe the end state; do not narrate the removed design.

## Rules

- Never change the framework domain: no edits under `packages/1-framework` except the CLI code and text above.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory; save output under `wip/` in the worktree. Never use bare `git stash`.
- No comments where code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target. No invented names. Never hard-wrap Markdown prose.
- Commit after each step with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Do not push.

## Done when

Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package (including the CLI package), `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage` against `origin/main`, the MongoDB runner integration files, every MongoDB journey, and every CLI journey whose strings changed all pass, each run to completion before you report.

## Report

Plain English, short sentences: what was removed, the CLI changes with before and after text, the tests that changed and the new ones (red first where behaviour changed), the checks and their results, and the commits.

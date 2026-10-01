# Brief: fix the slice 2a round 2 review findings (TML-3296)

You fix the findings of the second review of slice 2a. You work in the git worktree at the current directory, on branch `tml-3296-sql-expression-data-type`. Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`.
2. `projects/sql-expression-literals/status.md` and `dispatches/2a-review-fixes-brief.md` (the first round's decisions, which stand).
3. The two reviews in `projects/sql-expression-literals/slice-reviews/2a-round-2/`: `system-design-review.md` (findings B01 to B05) and `code-review.md` (findings G01 to G04). Each finding has a location, the issue and a suggestion.

## Decisions

Fix every finding as its suggestion says, except where this list says otherwise. These are decided; do not reopen them.

- **B01: the stack exposes its declared data types with their contributors.** Add `readonly declaredDataTypes: ReadonlyArray<{ readonly type: DataType; readonly contributedBy: string }>` to `ControlStack` in `packages/1-framework/1-core/framework-components/src/control/control-stack.ts`, filled from the `declared` list `assembleDataTypes` already builds (doc: "Every data type the composed components register, with the id of the component that registered it. ADR 254."). Change `assertNothingCastsFromSqlExpression` to take that list, and put the contributor in the message and the payload like its sibling `CONTRACT.DATA_TYPE_*` errors: `Data type "<id>" from "<contributedBy>" declares a cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type.`, payload `{ dataType, contributedBy }`. `createSqlFamilyInstance` passes `stack.declaredDataTypes`. The integration test `test/integration/test/authoring/sql-expression-registration.test.ts` uses `stack.declaredDataTypes` instead of its own walk. Update the tests of the function, the error reference entry, and design section 3.5. Search for other hand-built `ControlStack` objects in tests (for example the operation preview test) and give them the new field.
- **B03: the error envelope is published from the shared `/components` entry.** In `packages/1-framework/1-core/framework-components/src/exports/components.ts`, export `runtimeError`, `isRuntimeError` and the type `RuntimeErrorEnvelope` from `../shared/runtime-error`. Remove the `runtimeError` export from `src/exports/codec.ts`. `sql-expression.ts` imports `runtimeError` from `@internal/framework-components/components`. Leave the `/runtime` entry as it is. Run `pnpm lint:deps` and fix any layering complaint it raises; if `/components` is not importable from `@internal/sql-contract`, stop and write why to `dispatches/2a-round-2-fixes-findings.md`. Update the design section 3.5 sentence that names the entry, and the extension upgrade fragment if it names `/codec` for this.
- **B02, B04 and G04 (the same sentence), B05, G02, G03:** as the suggestions say. For G03 also fix the plan.md carry-over list.
- **G01: rerun the manual QA and pin the tag order.** Add the suggested assertion to `sql-expression-registration.test.ts` for both targets. Rerun the manual QA script in `projects/sql-expression-literals/manual-qa.md` on the tip (it needs no database) and record the run in place of the old one, with each case's actual output. Correct the status.md sentence. If a case does not give the expected result, stop and write it to `dispatches/2a-round-2-fixes-findings.md`.

If a decision above turns out to be wrong against the code, stop and write the reason to `projects/sql-expression-literals/dispatches/2a-round-2-fixes-findings.md`. Do not decide it yourself.

## Rules

- Tests first where a finding adds or changes behaviour (B01, G01).
- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (use `pnpm test <path>` in the package); no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it; no re-exports outside `exports/`; test names omit "should"; whole-shape assertions.
- Markdown prose is never hard-wrapped: one paragraph per line.

## Verify

After the fixes, run and save each output under `wip/v4/` once, then read the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`. Then run the test files you changed, and every test file under `packages/1-framework/1-core/framework-components/test/` and `packages/2-sql/9-family/test/` (`pnpm test` in those two packages), and `pnpm test test/authoring/sql-expression-registration.test.ts` in `test/integration`. Do not run the whole `test:packages` or `test:integration` suites; the orchestrator runs them. Rerun a failing test file alone once; report it as a failure if it fails again.

## Commits

- One commit per finding or per small group of related findings, with explicit `git add <paths>`.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit: no `Co-Authored-By` line and no "Generated with" line.
- Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Add a "Slice 2a review, round 2" section to `status.md` (each finding and what you did, each verification result with its log path) and commit it. Report in plain English, in short sentences: each finding and what you did; each verification result with its log path; anything you could not do.

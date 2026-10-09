# Brief: slice 2b, round 3 fixes, code and tests (TML-3288, #30550)

Branch `h31-2b` in the git worktree at the current directory, pushed as `tml-3288-sql-expression-places`. Do not read, write or run anything outside this worktree; no `/tmp`; scratch and logs under `wip/2b-round-3-fixes/`. Run node, pnpm and git through `mise exec --`. The workspace is built.

Reviews: `projects/sql-expression-literals/slice-reviews/2b-round-3/system-design-review.md` (C01 to C08) and `code-review.md` (D01 to D09). Read the findings named below in full before you start; they hold the locations and the evidence.

The orchestrator fixes every doc finding (ADRs, the spec, the upgrade fragments, the error reference, the editor tooling brief, the skill reference, the manual QA table, the project status). Do not edit those files. Your scope is code and tests only.

## What to do

1. **D03 and C04: test the two block-spec paths the merge of `main` added.** In `packages/1-framework/3-tooling/language-server/test/` (in `block-spec-context.test.ts` or `completion-block-values.test.ts`, whichever fits the existing helpers), add tests that fail when `dataTypes` is dropped:
   - Block value completion (`blockValueGrammar` in `src/attribute-spec-resolution.ts`): a fixture block whose `using` is `optional(dataTypeValue(<id>, ctx.dataTypes))` and a `DataTypeSupport` that holds one tag entry. `using = |` offers that tag when the source has the data types, and offers nothing with `EMPTY_DATA_TYPES`.
   - The block keyword snippet path (`genericBlockDeclarationKeywordCandidates` in `src/completion-provider.ts`): extend the existing "receives the source's data types" cases so the spec factory receives the source's `dataTypes` by identity (`toBe`).
   - One test with the real Postgres stack, as `completeWithActualStack` does for `@@index`: `using = |` inside a `policy_select` block offers `sql`. If it does not, stop and report; do not change production code to make it pass.
   Confirm each new test fails with the planted defect (replace the data types with `EMPTY_DATA_TYPES` at the site), then restore the file with `git checkout -- <file>`.
2. **D04.** In `language-server/test/completion-provider.test.ts` (about line 1414), rename the test that says "with the symbol table only" so the name says what it checks, and either drop its `dataTypes: expect.any(Object)` check or pass a known `DataTypeSupport` and assert it with `toBe`.
3. **D05.** In `packages/3-targets/3-targets/postgres/test/block-documentation.test.ts` and `sql-expression-places.test.ts`, build block spec contexts with `blockSpecContext({ symbols, dataTypes })` from `@internal/psl-parser`, so a stray field does not type-check, and delete the probe block lookup that existed only to fill `block`.
4. **D06.** In `scripts/codemods/rewrite-sql-strings.test.mjs` (the test "keeps treating // comments as comments after an unclosed backtick"), make the commented line hold an attribute, for example `  // @@check(expression: "commented out", name: "c")`, with the expected output unchanged. Confirm it fails with `break` put back in place of `continue` in the codemod, then restore the codemod with `git checkout -- <file>`. Do not change the codemod itself; its two copies under `upgrade-instructions/` must stay byte-identical to it.
5. **C05, code half.** In `packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts`, the reason text of `refuseSqlTextThatDoesNotReadBack` says "a blank first or last line". Canonicalization now drops every blank line at the start and end. Write "blank lines at the start or end", and update the pinned string in `test/psl-print/refusals-sql-text.test.ts`.

## Rules

- Write the failing test first where the item adds behaviour coverage. Every new test must be able to fail; record the planted-defect runs.
- No comments unless the code cannot say it. No `any`, no `@ts-expect-error`, no bare `as` in production code.
- **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** Run the test files you touch (`pnpm test <path>` inside the package). The machine is heavily loaded; a test that times out under load usually passes alone. Run long commands in the background with a log under `wip/2b-round-3-fixes/`. Kill only processes you started, by PID.
- Before you finish, in each package you touched: `pnpm typecheck`, `pnpm lint`, and the touched test files. Also `node --test scripts/codemods/rewrite-sql-strings.test.mjs`. If `pnpm lint:fix` touches `scripts/validate-package-readmes.test.mjs` or `skills-contrib/review-fetch-phase/scripts/guard-review-artifacts-ignored.test.mjs`, restore both.
- Commit as you go, one commit per item, staging files explicitly (never `git add -A`). Commit with `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "<sentence>"`. No AI attribution lines. Never amend, squash, rebase or push. Leave the orchestrator's uncommitted doc edits alone: do not stage, restore or reformat files you did not change.

## Report

Reply with: the commits (hash and subject), each planted-defect result, the commands you ran with their results and log paths, and anything you could not do. Plain English, short.

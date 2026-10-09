# Brief: slice 3 review round 3 code fixes (#30558)

Same worktree, branch `l65-3` (pushed as `tml-3289-sql-expression-ts`). Logs under `wip/3-round-3-fixes/`. Same rules as your last brief: stay in the worktree, no `/tmp`, run through `mise exec --`, never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full, commit with `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend/rebase/squash/force-push, do not push, do not switch branches. Do not commit this brief.

Read the reviews first: `projects/sql-expression-literals/slice-reviews/3-round-3/system-design-review.md` (A01–A06) and `code-review.md` (C01–C04). The orchestrator already fixed the docs in `79e9498810` (A01, A03, A04, A05, C03, and the error reference and design text for A02). Do not edit ADRs, the error reference, upgrade fragments or `projects/` files.

Every test you add must fail when the behaviour it covers is removed. Show that for each one (plant the defect, run, restore) and keep the logs.

## 1. C01: a value that carries the marker but is not this copy's class

`requireSqlExpression` and `.default()` trust the `.text` of any object carrying the `Symbol.for('@prisma/sql-expression')` marker. Change `requireSqlExpression` in `packages/2-sql/1-core/contract/src/sql-expression.ts` so that:

- a value that is an instance of this copy's `SqlExpression` is returned unchanged;
- a value that carries the marker but is not an instance (another installed copy of the package, or a forgery) is accepted only when its `text` is a string, and is returned as `new SqlExpression(text)`, so its text is canonicalized and a NUL or oversize text raises `CONTRACT.SQL_EXPRESSION_INVALID`;
- anything else, including a marked value whose `text` is not a string, raises `CONTRACT.ARGUMENT_INVALID` with the existing message.

`.default()` (`toColumnDefault` in `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`) must read a `SqlExpression` the same way, through one shared function, not a second copy of the rule; name it for what it does. Tests: in `sql-expression.test.ts`, a marked object with indented multi-line text comes back canonical; one with a NUL raises `CONTRACT.SQL_EXPRESSION_INVALID`; one with a number as `text` raises `CONTRACT.ARGUMENT_INVALID`; an instance comes back as the same object. One `.default()` test with a marked object holding indented text stores the canonical text.

## 2. A02: "on fields"

The refusal for a `fullTextIndex` with neither `name` nor `map` becomes `Full-text index on fields "title", "subtitle" where must be a sql\`...\` value.` (every field of every weight group, in order). Update `packages/3-extensions/postgres/src/contract/full-text-index.ts` and its tests (one field and several fields).

## 3. A06 and C04: the parity fixture

In `test/integration/test/authoring/parity/sql-expressions/` (`contract.ts`, `schema.prisma`, `expected.contract.json`):

- the full-text index has at least two weight groups, one with two fields, and a multi-line indented `where`;
- one TypeScript predicate interpolates a `sql` value whose text holds a `--` line comment on a line that is not the last;
- one text holds an escaped backtick (in PSL the double-quote form; in TypeScript `` \` ``), and one is indented with tabs.

Regenerate `expected.contract.json` the way the fixture's test expects, then confirm by reading it that each new text is the canonical form you intended. Show the parity test fails when one side's text differs (change one character in one side, run, restore).

## 4. The untested guard

`coveredFieldNames` in `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts` returns no fields for an expression that is not an object. Add one test that reaches it through an untyped call, or, if no public entry point can reach it once `requireSqlExpression` runs first, remove the guard and say so.

## Verify

`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm fixtures:check`. `pnpm --filter` tests for `@internal/sql-contract`, `@internal/sql-contract-ts` and the Postgres extension. In `test/integration` only: `test/authoring`. After committing: `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`.

## Report

Plain English, short sentences: what you changed for each item, the planted-defect evidence for each new test (log paths), every verification result, and anything you could not do.

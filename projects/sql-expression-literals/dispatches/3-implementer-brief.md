# Brief: implement slice 3, the TypeScript builder takes `sql` values (TML-3289)

You implement slice 3 of the project "SQL expression literals". You work in the git worktree at the current directory, on branch `tml-3289-sql-expression-ts`, which starts from the tip of slice 2b's branch (`tml-3288-sql-expression-places`, pull request #30550). Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`, then the rules it lists under Testing and TypeScript & Typing.
2. `projects/sql-expression-literals/status.md`, then `plan.md` sections "Done conditions for every slice" and "Slice 3" (its Tests list and "Carried over" list), then `spec.md` cross-cutting requirements 3, 4, 5 and 9.
3. `design.md` sections 2 (the slice 3 exports: `SqlExpression`, `isSqlExpression`, `sql`, `requireSqlExpression`, the two new subcodes), 13 (the `CONTRACT.*` rows), 15, 18.4, 19 (the slice 3 rows) and 20 (the slice 3 row). `design-notes.md` for the reasons.
4. `research/ts-builder.md` (the current shape of the tag, `.default()`, `index()`, `check()`, the policy builders and `fullTextIndex`) and `research/artefacts-docs.md` §3.4 (README lines to change).
5. `packages/2-sql/1-core/contract/src/sql-expression.ts` as it is now, and `packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts`, which this slice deletes.

## What you build

Follow design sections 2 and 15 exactly; you have no design freedom over names, signatures or messages.

1. **The value and the tag** (section 2, slice 3 exports; section 15.1). `SqlExpression` class, `isSqlExpression`, `sql` and `requireSqlExpression` in `@internal/sql-contract/sql-expression`; the subcodes `SQL_EXPRESSION_INTERPOLATION` and `SQL_EXPRESSION_INVALID`; `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` exported from the framework's `authoring` entry (keeping their `control` exports). Delete `contract-ts/src/sql-default-literal.ts`; `contract-ts/src/exports/contract-builder.ts` exports `sql` and `type SqlExpression` from the family module; the Postgres and SQLite contract-builder facades re-export `sql` and add `type SqlExpression`; no facade exports the class as a value. Remove `'DEFAULT_SQL_INTERPOLATION'` from `contract-ts/src/contract-errors.ts`.
2. **`.default()`** (15.2): takes `SqlExpression` too; `toColumnDefault` checks `isSqlExpression` first and applies the reserved-function and unsafe-SQL checks with the exact messages; `.default({ kind: 'function', expression })` keeps working.
3. **Index, check, full-text index** (15.3) and **policies** (15.4): the raw-SQL fields are `SqlExpression`; lowering reads `.text` through `requireSqlExpression` with the exact `what` strings; the order of the `expression` checks matters.
4. **What stays strings** (15.5).
5. **Parity fixture** `test/integration/test/authoring/parity/sql-expressions/` as the plan describes, proving PSL and TypeScript emit byte-identical contracts for the same SQL, multi-line included.
6. **Carried over from slice 2b, decided:**
   - Export the SQL family's data type registration as one value from `@internal/sql-contract/sql-expression` (for example `sqlExpressionRegistration = { dataTypes: [sqlExpressionDataType], authoring: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry } }`, or the shape the family descriptor needs), use it in `packages/2-sql/9-family/src/core/control-descriptor.ts`, and spread it in the four fixtures the plan names.
   - **Defaults that do not read back.** Decision: `contract print` refuses a column default whose text would not read back, through `refuseSqlTextThatDoesNotReadBack` with kind `default` and the column's coordinate, like the other objects. `contract infer` keeps printing the default (a skipped default would be dropped by the next plan, which is worse than a changed constant) and adds the note `// prisma: default of "<column>" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration` to the model's comment lines. Test both. Record the decision in ADR 129, ADR 260, design section 11.2, the error reference and the app upgrade fragment of this slice; update the plan's slice 3 "Carried over" entry to say it is done.
7. **Upgrade fragments** `upgrade-instructions/pending/sql-expression-literals-ts/{app,extension}/instructions.md` with the change ids of design section 20's slice 3 row, each with a tested detection pattern and a true prose paragraph, saying what each supersedes. Validate by execution as `skills-contrib/record-upgrade-instructions/SKILL.md` requires (the TypeScript fixtures under `examples/` and `packages/3-extensions/` that you change are the evidence).
8. **Docs** per design section 19's slice 3 rows: ADR 129 (the tag returns `SqlExpression`, interpolates `sql` values, checks moved to `.default()`), ADR 254 (the TypeScript paragraph), ADRs 234, 236, 243, 244 (TypeScript examples), ADR 260 (the TypeScript examples were marked as planned; make them real), `docs/reference/error-reference.md` (section 13's `CONTRACT.*` rows: the renamed `SQL_EXPRESSION_INTERPOLATION`, new `SQL_EXPRESSION_INVALID`, `DEFAULT_INVALID` raised by `.default()`, `ARGUMENT_INVALID` from `requireSqlExpression`), `packages/2-sql/2-authoring/contract-ts/README.md`, the `prisma-8` skill references (TypeScript examples), and `docs/reference/codec-authoring-guide.md` if its TypeScript schema holds a plain-string place. Then run the done-condition grep for slice 3 (string arguments to the TypeScript raw-SQL fields) over `docs/`, `skills/`, `skills-contrib/`, package READMEs and `src/`, excluding `CHANGELOG.md`, `docs/releases/` and `skills/prisma-8/upgrading/**/upgrades/`, and make it come back empty.
9. **Manual QA**: add a slice 3 script to `manual-qa.md` that builds small TypeScript contracts and prints each `CONTRACT.*` refusal (a string in `index` `where`, in `check`, in a policy `using`; `` .default(sql`now()`) ``; unsafe SQL; a string inside `${…}`; NUL text), and records the compile-time refusals through `pnpm typecheck` on a scratch file under `wip/`. Run it and record the run.

If a design decision turns out wrong against the code, stop and write it to `projects/sql-expression-literals/dispatches/3-findings.md` with your recommendation. A file or function that merely moved: correct the design and continue.

## Tests

Write each test before the code it proves, and make sure it fails first. The plan's "Slice 3" Tests list names them: `sql-expression.test.ts` (extend), `sql-expression.test-d.ts`, `contract-ts/test/raw-sql-fields.test-d.ts`, `contract-dsl.default-sql-expression.test.ts`, the Postgres extension `rls-handles.test-d.ts` and `full-text-index.test-d.ts` updates, the parity fixture, plus the tests for the two carried-over decisions. Type tests use `expectTypeOf` per `vitest-expect-typeof.mdc` and `not.toBeAny()` sentinels. Update every TypeScript fixture and test call site that passes a string to a raw-SQL field (`research/ts-builder.md` §6 lists them), including `test/integration/test/authoring/parity/rls/contract.ts`, `cli-journeys/contract-expression-authored.ts`, `test/integration/test/sql-builder/fixtures/contract.ts` and `rls-ts-walking-skeleton.integration.test.ts`, which composes a predicate with `` sql`${OWNER_PREDICATE} AND deleted_at IS NULL` ``.

## Rules

- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (`pnpm test <path>` in the package); no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it, doc comments terse and only on exported surface; no re-exports outside `exports/`; test names omit "should"; whole-shape assertions; `pnpm lint:deps` must pass.
- Markdown prose is never hard-wrapped: one paragraph per line. ADR prose per `adr-writing.mdc`; every ADR example must compile against the code.
- After changing exported types in a package, build it before typechecking downstream.

## Verify

Each once, output under `wip/3/`, read from the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm lint:skills`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm test:scripts`, and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing. In `test/integration`, run only `pnpm test test/authoring test/sql-builder test/rls-ts-walking-skeleton.integration.test.ts test/cli-journeys/sql-expression-literals.e2e.test.ts test/cli-journeys/contract-expression-authored test/psl-print` and any file whose imports or fixtures you change; also `pnpm test` in `packages/3-extensions/postgres` and `packages/3-extensions/supabase`. **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; the Bash hook blocks them.** Known local failures to report but not fix: the three publish-shell tarball tests. Rerun any other failing test file alone once.

## Commits

- Small commits, each one step of the design, explicit `git add <paths>`. Commit this brief first.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit. Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Add a "Slice 3" section to `status.md` (what was built, each design correction, each verification result with its log path, the manual QA run, the two carried-over decisions) and commit it. Report in plain English, in short sentences: what you built, each design correction, each verification result with its log path, and anything you could not do.

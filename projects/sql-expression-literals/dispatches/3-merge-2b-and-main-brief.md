# Brief: bring slice 3 (#30558) up to date with the merged 2b and `main`

You work in the git worktree at the current directory, on local branch `l65-3`, which is pushed as `tml-3289-sql-expression-ts` (pull request #30558, base `main`). Install and build have run on the current head. Do not read, write or run anything outside this worktree; no `/tmp`; scratch and logs under `wip/3-merge/`. Run node, pnpm and git through `mise exec --`. The machine is loaded: run long commands in the background with a log, then read the log.

**Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** `pnpm test:packages` is allowed. In `test/integration`, run only the files named under "Verify".

## Background

Slice 3 makes the TypeScript contract builder take `sql` values (`SqlExpression`) for raw SQL. It was built on the 2b branch (`tml-3288-sql-expression-places`) and last merged it on 2026-10-06 (`8874be37bc`). 2b then went through review round 3 and three merges of `main`, and merged into `main` on 2026-10-08 as the squash commit `7ae50f13f9`. The squash hides 2b's history, so merging `main` directly conflicts in about 150 files. Merging 2b's final commit first avoids that: `a044872a36` is 2b's last commit and shares history with this branch.

Read `projects/sql-expression-literals/plan.md` (slice 3) and `status.md` (sections "Slice 3" and "Slice 2b review, round 3") first.

## Part 1: merge 2b's final commit

`git merge --no-ff --no-commit a044872a36`. 22 files conflict. Resolution rule: 2b's side (`a044872a36`) for structure, names and everything 2b changed since `8874be37bc`; slice 3's side for what slice 3 adds (the TypeScript `SqlExpression`, the `sql` tag, `requireSqlExpression`, `sqlExpressionRegistration`, typed builder fields, the default read-back refusal, the `what` strings in refusals). Before resolving a file, read what 2b changed in it since the base: `git diff 8874be37bc a044872a36 -- <file>`.

- `docs/architecture docs/adrs/ADR 268 - Raw SQL is a value of the data type sql-expression.md`: git followed the rename from ADR 260. Keep 2b's text (round 3 corrected what it says about line comments and renaming) and add slice 3's sections (TypeScript values, "Column defaults that do not read back", the interpolation indentation rule). The heading is ADR 268.
- ADRs 129, 236, 243, 244, `docs/reference/error-reference.md`, `skills/prisma-8/references/contract.md`, `packages/2-sql/2-authoring/contract-ts/README.md`: keep both sides' content. Where both sides reword the same sentence, keep 2b's wording and add slice 3's facts.
- Code and tests (`framework-components/src/exports/authoring.ts`, `sql-contract/src/sql-expression.ts`, `contract-psl/test/fixture-data-types.ts`, `contract-ts/src/contract-lowering.ts`, `contract-ts/src/exports/contract-builder.ts`, `contract-builder.dsl.portability.test.ts`, `9-family/test/psl-build/default-mapping.test.ts`, Postgres extension `full-text-index.ts` and its test, Postgres target `psl-print/refusals.ts`, `test/integration/test/rls-helper-invisibility.test.ts`): both sides' behaviour and tests stay. If keeping both is impossible without a design choice, stop and write it to `wip/3-merge/findings.md`.
- `projects/sql-expression-literals/status.md` and `manual-qa.md`: keep both sides' sections. `handover.md`: take 2b's side; the orchestrator rewrites it.

Commit: "Merge tml-3288-sql-expression-places (final, a044872a36) into tml-3289-sql-expression-ts".

## Part 2: merge `main`

`git fetch origin main`, then `git merge --no-ff origin/main`. `main` holds 2b's final content, so 2b's files should merge cleanly; `main` also has newer commits (for example TML-3519, which renamed the query fragment types to `QueryFragment` and `DeclaredFieldsFragment`). Resolve as `main`'s structure plus slice 3's changes. After the merge, `git diff --name-only origin/main -- upgrade-instructions/releases skills/prisma-8/upgrading` must print nothing: released upgrade fragments are never edited. Commit: "Merge main into tml-3289-sql-expression-ts".

## Part 3: ADR 260 becomes ADR 268 everywhere on this branch

`main`'s ADR 260 is "Every query has an afterTransaction stage…". Slice 3's commits still call this project's decision ADR 260 in places git could not see as a rename. Find them with `git grep -n "ADR 260\|ADR%20260"` and change each one that means this project's decision to ADR 268, including links (`ADR%20260%20-%20Raw%20SQL…` becomes `ADR%20268%20-%20Raw%20SQL…`), prose, code and doc comments, READMEs, the error reference, `upgrade-instructions/pending/sql-expression-literals-ts/`, and `projects/sql-expression-literals/` spec, design, design-notes and plan. Leave mentions of `main`'s ADR 260 alone, and do not change `upgrade-instructions/releases/`, `projects/sql-expression-literals/slice-reviews/` or `dispatches/`, which are history. Commit: "Slice 3 names its decision ADR 268".

## Verify

Logs under `wip/3-merge/`. Run `pnpm install` (if it only removes a stray `test/integration/test/fixtures/cli/cli-e2e-test-app/test-…` importer from `pnpm-lock.yaml`, restore the lockfile), `pnpm build`, then `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm lint:skills`, `pnpm fixtures:check` (no `contract.json` change), `pnpm test:scripts`, `pnpm test:packages`. In `test/integration` only: `pnpm test test/authoring test/psl-print test/sql-builder test/rls-helper-invisibility.test.ts test/cli-journeys/sql-expression-literals.e2e.test.ts`, plus every integration file you change. `pnpm test` in `packages/3-extensions/postgres` and `packages/3-extensions/supabase`. A test that times out under load usually passes alone: rerun that file once and say so. The three tarball tests (`all-shells-tarball`, `module-identity`, `cross-shell-tarball`) fail on a known registry refusal; report, do not fix. `pnpm lint:fix` may touch `scripts/validate-package-readmes.test.mjs` and `skills-contrib/review-fetch-phase/scripts/guard-review-artifacts-ignored.test.mjs`; restore those two. Also run the slice's done-condition grep (plan.md, "Done conditions for every slice": no string arguments to the TypeScript raw-SQL fields in docs, skills, READMEs or `src/` comments). After committing: `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`.

## Commits

`mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Stage files explicitly, never `git add -A`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Never amend, rebase, squash or force-push. **Do not push.** Do not switch branches.

## Report

Plain English, short sentences: how you resolved each conflict in Parts 1 and 2, the files where you changed ADR 260 to 268 and any you left because they mean `main`'s ADR 260, every verification result with its log path, and anything you could not do.

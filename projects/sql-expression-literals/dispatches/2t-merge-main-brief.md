# Brief: finish merging `main` into the 2t branch (#30539)

You finish a merge that is already in progress in the git worktree at the current directory. Do not read, write or run anything outside this worktree; no `/tmp`; scratch and logs under `wip/merge-main-2t-5/`. Run node, pnpm and git through `mise exec --`. The machine is heavily loaded: run long commands in the background with a log, then read the log.

**Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** `pnpm test:packages` is allowed. In `test/integration`, run only the files named under "Verify".

## Situation

- Branch `m29-2t` (pushed as `tml-3367-data-type-value`, pull request #30539, approved). It is at `d5e0d00869`.
- `git merge --no-ff --no-commit` of `main` at `b32ec30b6d` is in progress (`MERGE_HEAD`). 10 files conflict. List them with `git diff --name-only --diff-filter=U`.
- `main` gained two commits since the branch last merged it. The one that conflicts is `b32ec30b6d`, TML-3388 "Contract columns store their data type id; one script and db sign upgrade a project" (#30576). Read its commit message and its pending upgrade fragments under `upgrade-instructions/pending/` before resolving, so you know what it renamed and moved. It is the second slice of the project that produced TML-3386 (#30547); the 2t branch merged TML-3386 in commit `e260e810f7` — read `git show --stat e260e810f7` and the merge-only hunks (`git diff-tree --cc e260e810f7`) to see how the same kind of conflict was resolved: `main`s structure, 2ts names (`dataTypes: DataTypeSupport` where 2t renamed it; `main`s own new `dataTypeLookup` fields on migration and runtime types kept as they are).
- The 2t branch is TML-3367: the cast rule moved into `@internal/framework-components/authoring`; `dataTypeValue`; `ArgType.claims`; spec contexts carry `dataTypes: DataTypeSupport`; refusals worded by `describeRefusal(refusal, support, guidance)` with `RefusalGuidance`, `exactRewrite`, `describeExpected`, `describeRefusedValueType`; messages lead with what to write (`Expected a number`). Read `projects/sql-expression-literals/design-notes.md` items 14 and 15 and the 2026-10-06 subsection of `projects/sql-expression-literals/status.md`. The 2t pending upgrade fragments are `upgrade-instructions/pending/arguments-typed-by-data-type/` and `upgrade-instructions/pending/sql-is-a-data-type/`.

## Resolution rule (decided)

Take `main`'s structure; keep 2t's content and names.

- Structure from `main`: new or moved modules, new required fields (for example `codecLookup` is no longer optional), new test helpers and fixtures, new data-type declarations, removed code paths. Do not reintroduce something `main` deleted.
- Content from 2t: its renames (`support` → `dataTypes` on `readDataTypeDefault`/`lowerDataTypeDefault` inputs and on spec contexts; `dataTypeLookup` → `dataTypes`; `ControlDefaultRegistries` removed), its new functions and types, its refusal messages, `sourceElementIndexes`, `ArgType.claims`.
- Where `main` added a new call site, field or test that uses a name 2t renamed, use 2t's name there too. Where `main` added a test asserting an old refusal message (`... has no cast from ...; write ...` or `; it casts from ...`), change the expectation to 2t's wording and say so in your report. The Prisma 7 contract source (`contract-prisma7`) keeps its own wording.
- Both sides' tests stay. Both sides' upgrade fragments stay. If `main`'s fragments quote a name or message 2t changes, update the quote.
- If a conflict cannot be resolved by this rule (two designs that cannot both hold), stop and write it to `wip/merge-main-2t-5/findings.md` with both sides quoted, then report. Do not guess.

## Verify

Logs under `wip/merge-main-2t-5/`. After all conflicts are resolved and before committing: `pnpm install` (if it changes `pnpm-lock.yaml` only by removing a stray `test/integration/test/fixtures/cli/cli-e2e-test-app/test-…` importer, restore the file with `git checkout -- pnpm-lock.yaml`), `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`; in `test/integration` only `pnpm test test/authoring test/number-defaults test/date-time-defaults`. A test that times out under load usually passes alone: rerun that file once and say so. The three tarball tests fail on a known registry refusal; report, do not fix. `pnpm lint:fix` may touch `scripts/validate-package-readmes.test.mjs` and `skills-contrib/review-fetch-phase/scripts/guard-review-artifacts-ignored.test.mjs`; restore those two.

## Commit

One merge commit: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "Merge main into tml-3367-data-type-value"`. Stage files explicitly (`git add <paths>`), never `git add -A`. No AI attribution lines. Never amend, rebase, squash or force-push. **Do not push.** After committing, run `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`.

## Report

Plain English, short sentences: how you resolved each group of conflicts (by package), every test expectation you changed and why, every verification result with its log path, anything you could not do.

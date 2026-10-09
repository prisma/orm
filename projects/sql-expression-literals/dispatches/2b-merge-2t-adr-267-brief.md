# Brief: merge the current 2t branch into 2b, and renumber 2b's ADR to 267 (#30550)

You work in the git worktree at the current directory, on branch `m29-2b` (pushed as `tml-3288-sql-expression-places`, pull request #30550). Do not read, write or run anything outside this worktree; no `/tmp`; scratch and logs under `wip/merge-2t-into-2b-2/`. Run node, pnpm and git through `mise exec --`. The machine is heavily loaded: run long commands in the background with a log, then read the log.

**Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** `pnpm test:packages` is allowed. In `test/integration`, run only the files named under "Verify".

## Part 1: merge `m29-2t` into `m29-2b`

Run `git merge --no-ff --no-commit m29-2t`. Five files conflict:

- `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`. Since 2b last merged 2t, 2t merged `main`'s TML-3388 (#30576) in `1f78dae43a`: a canonical-form step in the stored-value reader (`CanonicalFormRefusal`, `StoredRefusal`, `storedRefusalDiagnostic`), a `subject` argument in place of the field path so enum members are worded like defaults, `guidanceFor`, and `readWrittenNumberForCodec`. Read `git show 1f78dae43a -- packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` and the combined diff `git diff-tree --cc 1f78dae43a -- <that file>`. 2b reports `@default` refusals at spans (`DefaultSpans`, `writtenValueSpan`, `span:` on diagnostics) where 2t has `place`. Keep 2t's new behaviour (canonical form, `subject`, `readWrittenNumberForCodec`, `guidanceFor`) and 2b's spans. Every diagnostic the reader returns carries a span the way 2b's do; a refusal 2t reports at the attribute (`place: { kind: 'attribute' }`) is reported at `spans.attribute`. If `readWrittenNumberForCodec` (used for enum member values, outside `@default`) has no spans to give, read how its caller in `interpreter.ts` reports the diagnostic and give it the span that caller has; if that needs a design choice, stop and write it to `wip/merge-2t-into-2b-2/findings.md`.
- `docs/architecture docs/adrs/ADR 262 - Block specs bind top-level block values.md`. `main` renamed ADR 255 to ADR 262 (#30619). 2b amended ADR 255. Put 2b's amendments into ADR 262; keep the file name and number 262.
- `docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md`, `docs/architecture docs/adrs/ADR 249 - Central attribute-spec registry.md`, `docs/architecture docs/ADR-INDEX.md`. Keep both sides' content: 2t's (and through it `main`'s) text and 2b's amendments. ADR references follow `main`'s renumbering (255 → 262).

Resolution rule for anything else: the 2t side's structure and names; 2b's content (the six places receive `sql/expression` through `dataTypeValue`; `sql` literals in PSL; printers; spans). Both sides' tests stay.

## Part 2: 2b's ADR becomes ADR 267

`main` now has its own ADR 260 (the `afterTransaction` stage), so 2b's `docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md` must move. The next free number on `main` is 267, and no open pull request claims it.

- `git mv` the file to `ADR 267 - Raw SQL is a value of the data type sql-expression.md` and change its heading.
- Change every reference to this ADR in the branch's diff against `main` to 267: links (`ADR%20260%20-%20Raw%20SQL…`), "ADR 260" in prose, code comments and doc comments (for example the `dataTypeValue` doc comment), READMEs, the error reference, the upgrade fragments under `upgrade-instructions/pending/`, `docs/architecture docs/ADR-INDEX.md`, and `projects/sql-expression-literals/` (spec, design, design-notes, plan, status). Find them with `git grep -n "ADR 260\|ADR%20260"` and leave alone every mention that means `main`'s ADR 260 (`afterTransaction`). Do not change files under `upgrade-instructions/releases/` or `projects/sql-expression-literals/slice-reviews/` and `dispatches/`, which are history.
- Add a row for ADR 267 in `ADR-INDEX.md` in the same style as its neighbours.
- Commit Part 2 separately from the merge.

## Part 3: two small items from the last 2t merge

- `projects/sql-expression-literals/design.md` around line 217 says `entryForTag` converts its key with `dataTypeId`. Since the TML-3388 merge, `entryForTag` and `entryForPlain` return the raw key, and the value's type comes from `authoringEntryType(key, entry)`. Correct the sentence.
- Report only, do not change code: on SQLite, `main` registers the `json` tag under the key `tag:json`, and 2t's `admittedForms`/`admittedTags` look entries up by data type id. Write a schema with a SQLite `Json` column and a refused default (for example `@default(1)`) and a SQLite `String` column with `@default(1)`, run them through the PSL interpreter in a scratch test or the CLI, and report the two messages exactly. Delete the scratch test afterwards.

## Verify

Logs under `wip/merge-2t-into-2b-2/`. After Parts 1 and 2: `pnpm install` (if it changes `pnpm-lock.yaml` only by removing a stray `test/integration/test/fixtures/cli/cli-e2e-test-app/test-…` importer, restore it with `git checkout -- pnpm-lock.yaml`), `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm lint:skills`, `pnpm fixtures:check`, `pnpm test:scripts`, `pnpm test:packages`. In `test/integration` only: `pnpm test test/authoring test/number-defaults test/date-time-defaults test/planner-golden test/psl-print test/cli-journeys/sql-expression-literals.e2e.test.ts`, plus every integration file you change. Supabase pack: `pnpm test` in `packages/3-extensions/supabase`. A test that times out under load usually passes alone: rerun that file once and say so. The three tarball tests fail on a known registry refusal; report, do not fix. `pnpm lint:fix` may touch `scripts/validate-package-readmes.test.mjs` and `skills-contrib/review-fetch-phase/scripts/guard-review-artifacts-ignored.test.mjs`; restore those two. After committing: `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`.

## Commits

`mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. The merge commit: "Merge tml-3367-data-type-value into tml-3288-sql-expression-places". Part 2: "ADR 267 is the number of 'Raw SQL is a value of the data type sql/expression'". Part 3's doc fix may join Part 2's commit. Stage files explicitly, never `git add -A`. No AI attribution lines. Never amend, rebase, squash or force-push. **Do not push.** Do not switch branches.

## Report

Plain English, short sentences: how you resolved each conflict, the files where you changed "ADR 260" and any you left because they mean `main`'s ADR 260, the two SQLite messages from Part 3, every verification result with its log path, and anything you could not do.

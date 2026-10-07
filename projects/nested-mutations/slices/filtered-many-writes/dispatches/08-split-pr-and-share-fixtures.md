# Brief: filtered-many-writes D8 — split the PR and share the matrix fixtures

## Why

PR #30634 is 636 files and about +167,000 lines; 153,000 of them are emitted contracts for port fixtures. The project owner decided two things:

- **A. Split the PR.** The source change, our own tests and the docs go in one PR; the ports go in a second PR stacked on it.
- **B. Share the matrix fixtures between the two matrix suites again.** This is an owner-granted exception to the port project's "each suite is self-contained; shared schemas are duplicated" rule, for `nested_update_many_inside_update` and `nested_delete_many_inside_update` only. The written rule is not amended; do not edit `projects/port-all-tests/spec.md`.

No behaviour, test body, assertion or title changes in this dispatch. It reorganises commits and fixture locations.

## End state

**Branch `nested-mutations` (PR #30634), based on `origin/main`** — everything except the ports:
- `packages/**` (source, package tests), `test/integration/test/sql-orm-client/**`
- `docs/**`, `upgrade-instructions/**`
- `projects/nested-mutations/**`
- Nothing under `test/integration/test/ports/**`, no change to `test/integration/test/planner-golden/manifest.json`, no change under `projects/port-all-tests/**`.

**Branch `nested-mutations-ports`, based on the new `nested-mutations`** — only the ports:
- `test/integration/test/ports/**` (port tests, fixtures, `failing.md`, non-ported ledgers)
- `test/integration/test/planner-golden/manifest.json`
- `projects/port-all-tests/checklists/**`

**B, on the ports branch:** the 81 matrix fixtures exist once, at `test/integration/test/ports/engines/writes/nested_mutations/already_converted/_fixture/<pair>__<variant>/`, used by both suite directories. Each suite directory keeps its own test files and body modules, with loops inline and no shared helper; only the fixtures are shared. The 57 duplicates under `nested_delete_many_inside_update/_fixture/` and the 81 under `nested_update_many_inside_update/_fixture/` are gone. The 14 checklist paths need no change if the test file paths do not change; the planner manifest is regenerated.

**Check that nothing was lost:** with the pre-split head at local branch `nested-mutations-pre-split` (`e2b4c05b04`):
- `git diff nested-mutations-pre-split nested-mutations-ports --stat` shows only the fixture move/removal and the regenerated manifest.
- `git diff origin/main...nested-mutations --stat` shows no path from the ports list.

## How

History on `nested-mutations` is yours to rewrite; the PR branch will be force-pushed by the orchestrator. Keep the non-port commits as they are where a commit touches only one side. Split a commit that touches both sides (for example D7's integration-test commit, which also changed a port, and any commit that carried checklist ticks or the planner manifest). The orchestrator's `docs(port-all-tests): tick …` commits belong to the ports branch. Do the work in a temporary worktree if the uncommitted project-plan line in this worktree gets in the way; do not use `git stash` or `git reset --hard`. Do not push.

## Completed when

- [ ] Both branches exist locally with the end state above, and the two diffs in "Check that nothing was lost" are as described.
- [ ] On `nested-mutations`: build; `pnpm --filter @internal/sql-orm-client typecheck`, `test`, `lint`; in `test/integration` `pnpm typecheck`, `pnpm lint`, `pnpm test test/sql-orm-client test/planner-golden`; `pnpm fixtures:check`; `pnpm lint:casts`; `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base nested-mutations origin/main) --head nested-mutations`; `pnpm lint:docs`; `pnpm check:error-reference`.
- [ ] On `nested-mutations-ports`: build; in `test/integration` `pnpm typecheck`, `pnpm lint`, `pnpm test test/planner-golden test/ports/engines/writes test/ports/engines/new test/ports/engines/queries/filters/filter_unwrap`; `pnpm fixtures:check`; `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse nested-mutations) --head nested-mutations-ports`.
- [ ] The report gives, for each branch: head SHA, commit count, `git diff --shortstat` against its base, and each gate's command and result; and the fixture count and emitted-contract line count on the ports branch after B.

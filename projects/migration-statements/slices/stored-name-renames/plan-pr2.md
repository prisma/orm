# Slice plan — stored-name renames, PR 2: MongoDB

**Spec:** [`spec.md`](./spec.md) (the MongoDB column of each table is the scope) · **Decision:** `docs/architecture docs/adrs/ADR 324 - The same coordinate is the same object.md` · **Linear:** [TML-3840](https://linear.app/prisma-company/issue/TML-3840) · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`, from `origin/main` · **Worktree:** `.claude/worktrees/migration-statements-handover-494725`

PR 2 makes the MongoDB target pair origin and destination objects by coordinate and rename their storage: a collection for a changed `@@map`, a document key for a changed `@map` (also inside embedded models), and a replaced value for a changed enum stored value.

**Will, 2026-11-24, on approving the build:** "behavior should be as consistent with the existing reference implementations as possible, while remaining idiomatic for MongoDB". The reference implementations are PostgreSQL and SQLite, built in the SQL family (`packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, prisma/orm#31088). So: the same cases are planned, the same cases are refused, the order is the same, the refusal and advice texts follow the SQL texts with MongoDB's words (collection, field, document), and results are reported the same way. MongoDB differs only where the database does: no transaction (so the overlap check refuses chains of enum values that SQL plans), keys and values the planner cannot see (protected at apply time), collections shared by root models, and embedded models. Every such difference is one the spec already lists. An implementer who finds another states it in the report instead of deciding it.

## Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 1 | Model and field renames each carry a statement or none. A model or field with the same coordinate and a changed collection or key is planned as `renameCollection` or `$rename`, with no question, on the `migration plan` path. A collection is renamed only when all of it moves, for both kinds of pair; `--rename` on a shared collection is refused. Every helper that reads field renames from the statement list reads the rename list. The by-hand advice that nothing reaches is removed | `main` |
| 2 | One check over all collection renames refuses swaps, chains, takeovers, merges with a statement and chains with a statement in both directions. Field swaps, takeovers and an old key reused by a new required field are refused through the overlap check, with advice that works. A changed embed relation stored name is refused. No refusal without a statement carries `refusedStatement` or says "this statement" | 1 |
| 3 | Embedded model fields pair by field name and rename the stored key wherever the type is stored. An enum member that keeps its name and changes its stored value is replaced; a freed value taken by a new member is planned; swaps, chains and takeovers are refused with a two-plan route; no `KeepDataEdit` for a member that keeps its name | 1 |
| 4 | `db update` against a live database follows the spec's table for collections: already renamed plans no operation and records the mapping; both present is refused with its own text; both absent creates. A run that stopped between `renameCollection` and `$rename` finishes when run again | 1, 2 |
| 5 | CLI journeys for MongoDB mirroring the SQL set, with every journey that encoded the old behaviour rewritten. The ORM test assertions that quote the engine's first line of `CLI.CONSENT_REQUIRED` are deleted | 1 to 4 |
| 6 | Docs and close of the PR: ADR 324 status and consequences, Migration System doc, error reference, `skills/prisma-8/references/migrations.md`, the upgrade instruction (app and extension), `deferred.md`, `plan.md` corrected to the true state, CLI enum keep-data code deleted if nothing reaches it, `handover.md` and `handover-notes/` deleted | 5 |


Added after the dispatches, with the operator's approval (2026-11-24): `createCollection` gets a postcheck (TML-3929), so a migration that stopped after a create finishes when run again. See the spec's scope and done condition 10.

Each dispatch has one Opus implementer at medium effort, then one Opus reviewer at high effort. After dispatch 6: `/drive-code-review` (both passes, no walkthrough) on the commit to be pushed, fixes, manual QA on that commit, then the PR.

## Checks for every dispatch

- `mise exec -- pnpm build` is clean (the full build; never one package).
- Typecheck and lint pass in every touched package.
- **Tests: only the test files the dispatch adds or changes, one file per command.** Will runs many sessions on this machine. Never a whole package's tests, never `pnpm test --coverage` on a package, never `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. CI runs the rest.
- `pnpm lint:deps` and `pnpm lint:ratchets` pass. From dispatch 6: `pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --mode pr`.
- `git diff --stat origin/main -- packages/1-framework` shows nothing outside the CLI package.

## Calibration entries that apply

`drive/calibration/failure-modes.md`: F5 (no destructive git by subagents), F13 (a regression test that does not discriminate), F26 (fix the class, not the instance), F44 (a behaviour change that fails in the merge queue), F45 (a path that does not feed the new check), F46 (advice checked by following it), F49 (no guards for inputs the API cannot produce).

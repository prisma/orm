# Slice plan — stored-name renames, PR 1: PostgreSQL and SQLite

**Spec:** [`spec.md`](./spec.md) · **Linear:** [TML-3839](https://linear.app/prisma-company/issue/TML-3839) · **Branch:** `tml-3839-stored-name-renames`, from `origin/main` · **Worktree:** `.claude/worktrees/migration-statements-handover-5072cc`

PR 1 makes the SQL family pair origin and destination objects by coordinate and rename their storage, on the PostgreSQL and SQLite targets. It also changes the two CLI texts both families share, and writes the ADR.

## Dispatches

| # | Outcome | Builds on | Hands to |
| --- | --- | --- | --- |
| 1 | The SQL family's rename planning takes renames that each carry a statement or none. Models and fields with the same coordinate and a changed table or column are planned as renames, in the spec's order, on PostgreSQL and SQLite, when built from the origin contract (`migration plan`). Storage is renamed only when all of it moves, for both kinds of pair; a statement on shared storage is refused. One check over all renames refuses swaps, chains, takeovers, merges and chains with a statement, for tables and columns, compared as the target compares names. Pairs need `managed` on both sides. Refusals without a statement carry no `refusedStatement` and never say "this statement". Later questions are named by origin model and field. Family unit tests and PostgreSQL and SQLite planner tests | `main` | Table and column renames planned from the contracts |
| 2 | `db update` against a live database follows the spec's table: old present and new absent is planned; old absent and new present plans no operation and records the mapping, so field renames, questions and `--delete` answers on that table work; both absent plans nothing; both present is refused with its own text. Tests against a live PostgreSQL (PGlite) and SQLite database, including a hand rename combined with a field `@map` change, a removed field and a field statement | 1 | The `db update` rows |
| 3 | Enum stored values: a member with the same name and a changed stored value is replaced, in the order the planner computes, chains included. A freed value taken by a new member is planned. Cycles and a member taking a removed member's value are refused with text that names no statement. No `KeepDataEdit` is produced for a member that keeps its name. Tests cover a check constraint that lists the values and an array column on PostgreSQL | 1 | Stored values |
| 4 | CLI and journeys: `STORED_NAME_ONLY` and the enum swap hint say what is now true for every target. The SQL field refusal about an unrenamed table is gone. Journeys: `table-map-change` (PostgreSQL and SQLite) show the rename with no question for both commands and the data kept; new journeys for a field `@map`, an enum stored value, a rename with a type change and with a field statement, each refusal with its advice followed to the end, and shared storage. Every test and journey that encoded the old behaviour for PostgreSQL and SQLite is rewritten | 1 to 3 | The spec's done conditions 1 to 7 for the SQL targets |
| 5 | Docs and close of the PR: the new ADR and update notes on ADR 264, Migration System, error reference, `skills/prisma-8/references/migrations.md`, CLI README, `design-notes.md`, `storage-naming.md`, `deferred.md`, `plan.md`, the upgrade fragment with the spec's five notes, the stale PostgreSQL planner comments | 4 | PR 1 ready for review |

Each dispatch has one Opus implementer, then one Opus reviewer, both at medium effort (Will, 2026-11-18). After dispatch 5: `/drive-code-review` (both passes, no walkthrough) on the commit to be pushed, fixes, manual QA on that commit, then the PR.

## Checks for every dispatch

- `pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in every touched package.
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:upgrade-coverage --prev $(git merge-base HEAD origin/main)` and `pnpm check:error-reference` pass.
- The journeys and integration files that reach the changed code pass, each run by name. Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.
- The planner golden tests (`fixtures:check` and the planner goldens under `test/integration`) pass, since the merge queue runs them.

## Calibration entries that apply

`drive/calibration/failure-modes.md`: F5 (no destructive git by subagents), F13 (a regression test that does not discriminate), F14 (dispatch checks must mirror CI), F26 (fix the class, not the instance), F44 (a behaviour change that fails in the merge queue), F45 (a path that does not feed the new check), F46 (advice checked by following it), F48 (planner goldens), F49 (no guards for inputs the API cannot produce).

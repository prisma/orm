# Dispatch 8 — Fixes from the whole-slice review

**Slice:** [`../spec.md`](../spec.md) · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Inputs:** `../reviews/code-review-final.md` (findings F01–F09, AC table) and `../reviews/system-design-review.md` (findings S01–S19), both gitignored, read them in full.

Two rounds, in order. Each round ends with its gate and a hand-back; round B starts only after round A is reviewed.

## Round A — security and correctness

- **F01 (security, must-fix).** Fix the class, not the call site: `qualifyTable` in the Postgres target's `postgres-schema.ts` must quote every identifier part with the existing `quoteIdentifier` (escape `"` by doubling). Then sweep every place in the Postgres and SQLite targets that builds an identifier into SQL text by hand (grep for template literals containing `"${` and for string concatenation with `'"'`) and route each through the quoting helper. The bug predates this branch; fixing it here is in scope because `--rename` makes it reachable from a user's command line. Tests (F07): a rename through a statement with a table name and a column name containing `"`, `\`, a space and a SQL keyword, rendered and executed on PGlite and on `node:sqlite`, asserting the database holds the new names and nothing else was created. The test must fail on the pre-fix helper (show it).
- **F02.** SQLite table renames compare names case-insensitively, as column renames already do (`columnsNamed` pattern): the planner and the facade refuse a new table name another table already holds in another case, except a case-only rename of the same table; the `renameTable` precheck uses the `COLLATE NOCASE` form. Runner test on real SQLite.
- **F05.** Every `statementRejected` (renamed in round B, keep the code path) conflict's `why` says what to do next, not only why it refused. Audit each case and test the texts.
- **F06.** `db update` distinguishes a missing snapshot from an unreadable one (corrupt JSON, failed content check, deserialization failure) in the `STATEMENT_ORIGIN_UNKNOWN` text; the reason is already in `meta.unreadable`. Error reference entry updated.
- **F07 second part / AC9.** A test that only the application space receives statements and an origin contract (an aggregate with an extension space).
- **F09.** Remove `-y|--yes` from the `db update` synopsis in the CLI README (the command does not declare it). Check the `migration plan` synopsis the same way.
- **F03.** Say in Migration System § Statements and the CLI README's rename paragraph that a column rename on Postgres re-creates checks, row-level-security policies and expression or partial indexes that mention the column, and that re-adding a check scans the table under an exclusive lock.
- **F04.** On SQLite, when a later step in the same plan rebuilds the table, drop the column rename's index replacement for that table. If that needs more than a small change in the SQLite planner, stop, and the orchestrator will defer it.

## Round B — names and shapes before later slices build on them

All of this is unreleased, so rename freely; update the spec text, the docs, the error reference and the upgrade fragment to the new names in the same commits. No backward-compatible aliases.

- **S01.** Framework types say what they are: `ResolvedStatement` → `ResolvedMigrationStatement`, `AppliedStatement` → `AppliedMigrationStatement` (and their members). The user-facing words stay: `--rename` statements, `Statements applied`, JSON `appliedStatements`.
- **S02.** The conflict field is `refusedStatement` (beside the existing `refusedOperationClass`), and the conflict kind is `statementRefused`.
- **S03 + S04.** `AppliedMigrationStatement` carries the resolved statement and `operationIds: readonly string[]` (the ids of the operations it accounts for), not `description` and `operationCount`. The description text is written once, from domain names, in the framework or CLI (one function, used by every family and by the CLI output); remove the SQL family's and Mongo's copies. Output prints the count from `operationIds.length`.
- **S05.** One entry point for statement texts, keyed by verb: the control API options carry `statements: readonly { verb: 'rename'; text: string }[]` (a union with one member today) instead of `renames: readonly string[]`, and the parser and resolver take that list. Error titles and messages name the verb from the entry, not a hard-coded `--rename`. Keep the order given.
- **S06.** `ModelCoordinate` / `FieldCoordinate`: `namespace` → `namespaceId`, a one-line doc comment that names are domain names as written in the contract source (for MongoDB, the stored field name, see `projects/migration-statements/deferred.md`), and shape them so slice 3 can add value-object and enum-value coordinates as further union members without changing these.
- **S07 / F08.** Remove `toOps?(lowerer?: unknown)` from the framework `OpFactoryCall`; put `toOps(lowerer)` on each SQL target's call base type with its real lowerer type.
- **S08.** The framework `Migration` base gets one read path that resets authoring state and reads operations; remove the static reset hook if nothing else needs it.
- **S09.** Split the planner's two meanings of `fromContract`: the contract the planner reads (for statements and field events) and the origin the plan claims. `db update` with statements passes the first and not the second; remove the `planFromDiff` Proxy that hides `origin`. `describe().from` and `origin` must agree.
- **S10.** The aggregate planner fails loudly (a planner error, tested) if the application space has statements and plans by any strategy other than the diff.
- **S11 + S12.** The statement planner validates renames with the family's `resolveTableRenameAgainst` / `resolveColumnRenameAgainst` (one validator), and the hand-written-call text in refusals comes from the target, as the table-name case guard already gets it. Check the namespace-id versus database-schema-name case S12 names, and test it on Postgres with a namespace whose database schema name differs from its id, if the contract allows that.
- **S13 + S14.** Constrain the statement planner's `TCall` so the targets' identical `operationCount` / `operationClasses` live once; `renameCall` → `renameTableCall`; in the family, `renames` → `tableRenames` beside `columnRenames`; one companion-call union per target where two are identical; resolve the two meanings of the `Resolved*` prefix the review names.
- **S15.** The `MigrationOperationClass` doc comment defines destructive as data loss and lists what is widening now.
- **S16.** Finish the `@hint` cleanup: a `> **Update — 2026-10:**` note under ADR 264's hint bullet; `docs/architecture docs/subsystems/9. No-Emit Workflow.md` around line 120; the rename-inference hint text in `cli-errors.ts` around lines 700–701; rename `skills/journey-tests/02b-rename-with-hint.md` to `02b-rename-with-statement.md` and update every link to it.
- **S17.** `db init` takes no statements and reports no `appliedStatements`: remove both from its options and its result (make the shared result type's field optional or split the type, whichever is smaller and typed precisely).
- **S18.** The family reads model storage through `SqlModelStorage`, not `storage['table']`; separate storage effects from failure reasons in the unions.

## Gate (each round)

Through `mise exec --`, filters quoted one per `--filter`, long output under `wip/`. `pnpm build`; whole-workspace typecheck; lint and test for every touched package; `check:error-reference`; `lint:deps`; `lint:framework-vocabulary` (≤ 254); `lint:throws`; `lint:casts`; `fixtures:check`; `check:upgrade-coverage --mode pr --prev $(git rev-parse tml-3474-migration-statements-sync)`; both rename-statements journey files once. Never the full journey, integration or e2e suites. Small signed `TML-3475:` commits; no attribution lines; no push; no destructive git (to undo an experiment, copy the file back from `wip/`).

## Hand-back

Per finding: what changed, the test that pins it (and that it failed before), commits. Any finding you could not do, why.

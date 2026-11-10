# Dispatch 5 — The flag on both commands, the origin contract for `db update`, output and errors

**Slice:** [`../spec.md`](../spec.md) · **Plan entry:** [`../plan.md`](../plan.md) § Dispatch 5 · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Builds on:** dispatch 4

## Task

Declare `--rename <old>:<new>` (repeatable) on `migration plan` and `db update`; parse and resolve the statements with dispatch 2's `resolveStatements` once both contracts are in hand and before anything is written or planned; pass the resolved statements to the planner; make `db update` resolve its origin contract from the application space's marker hash through the local snapshot store and pass it as `fromContract`; carry `appliedStatements` from the planner result to both commands' results and print them under `Statements applied` (human) and `appliedStatements` (JSON); carry a refused statement on the planning-failed error; document the flag, the output and the errors in the CLI README and the error reference.

## Outcome

After this dispatch a user can run `prisma migration plan --name tidy-users --rename Profile:User --rename User.name:User.fullName` and `prisma db update --rename Profile:User --rename User.name:User.fullName` and get the plan the slice spec's "At a glance" shows, with `Statements applied` listed after the operations; a wrong statement fails before anything is planned or written with one of the three statement errors; `db update` with statements and no local snapshot for the marker hash fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` naming the hash and the directory; and `db update` without statements behaves exactly as before. The invariant (project spec requirement 3): both commands accept the same statements with the same meaning and produce the same plan; and (requirement 12) everything the commands report about statements is structured data the output is rendered from.

## Scope

**In**

- **Flag.** `packages/1-framework/3-tooling/cli/src/orm/migration/plan.ts` and `src/orm/db/update.ts` declare `rename: flag.repeated({ brief, placeholder: 'old:new' })` from `@prisma/cli-engine` (first use of `repeated` in the repo; its type is `FlagSpec<readonly string[]>`). Not on `db init`. The values travel as raw strings (`renames: readonly string[]`) to the control API: `MigrationPlanOptions` (`src/control-api/operations/migration-plan.ts`) and `DbUpdateOptions` → `ExecuteDbUpdateOptions` → `sharedInputs` → `ExecuteRunOptions` (`db-update.ts`, `db-run.ts`). Resolution happens in the control API where the contracts are, never in the command handler.
- **`migration plan`.** In `executeMigrationPlanCommandInner`, after both `fromContract` and `toContract` are settled (after the `--to` resolution, before the seed phase and the no-op check), call `resolveStatements({ renames, origin, destination: toContract })`. Origin per `FromResolution.kind`: `graph-node`, `ref` and `auto-baseline` give `{ kind: 'contract', contract: fromContract }`; `greenfield` (no origin models) gives `{ kind: 'contract', contract }` with an empty application domain, so every statement is `STATEMENT_UNRESOLVED` naming the origin as empty (the spec: "there is no origin model to rename"). A failure returns `notOk` before anything is written. Pass the resolved statements to the delta leg of `runPlannerLeg` (the normal and auto-baseline delta legs); the baseline leg keeps `statements: []`. `runPlannerLeg` returns `appliedStatements` in `PlannerSuccess`; `MigrationPlanResult` gains `appliedStatements: readonly AppliedStatement[]` on every assembled result (empty where no leg carried statements). Zero planned operations with statements present is not `PLANNING_FAILED`: it is the existing no-op result, with the applied statements reported (a statement whose storage did not change is "applied, nothing to do").
- **`db update`.** In `executeRun`, after `readAllMarkers`, take the application space's marker row (`markerRows.get(aggregate.app.spaceId)`), read its `storageHash`, and `readContractSnapshotJsonTolerant(options.migrationsDir, storageHash, options.verifySnapshotContent)` from `@internal/migration-tools/contract-snapshot-store`; a found snapshot goes through `familyInstance.deserializeContract` and becomes the origin. Resolve the statements there, before `planMigration`, with `origin = { kind: 'contract', contract }` when found, else `{ kind: 'missing', hash: storageHash or null when no marker, snapshotDirectory: contractSnapshotDir(...) or the snapshots directory }`; with no statements, resolution is skipped and nothing changes. Thread `fromContract` and `statements` into the aggregate planner: `PlannerInput` → `planMigration` → `planFromDiff` (`packages/1-framework/3-tooling/migration/src/aggregate/`), replacing the hard-coded `fromContract: null` and `statements: []` for the application space (other spaces and `db init` keep `null` and `[]`). `planFromDiff` passes `plannerResult.appliedStatements` into `PerSpacePlan`; `executeRun`'s `wrapPlanResult` and `wrapApplyResult` put the application space's `appliedStatements` on `DbUpdateSuccess`. The destructive pre-plan in `guardDestructiveChanges` (`db-update.ts`) must run with the same statements, or it will see the drop-and-create and refuse.
- **Output.** `migration plan` human output (`src/orm/migration/plan.ts` `planBlocks`): a `Statements applied` block after the operation blocks, one line per statement in the family's description text with its operation count (`rename model "Profile" to "User" (2 operations)`; `(no operations)` for zero), omitted when there are none; JSON is the document, so `appliedStatements` appears as is. `db update`: `DbUpdateSuccess.appliedStatements` → `updateDocument` → `MigrationCommandResult.appliedStatements` (`src/utils/formatters/migrations.ts`; `db init` sets `[]`) → a block in `src/orm/db/migration-blocks.ts` placed after `operationBlocks` in both `planBlocks` and `applyBlocks`.
- **Errors.** Add `statement?: ResolvedStatement` to the framework `MigrationPlannerConflict` (`control-migration-types.ts`; the type is framework-owned, so the framework stays family-blind) and to `CliErrorConflict` (`packages/1-framework/1-core/errors/src/control.ts`), so a `statementRejected` conflict reaches `MIGRATION.PLANNING_FAILED`'s meta with the statement in domain coordinates; `errorMigrationPlanningFailed` renders the summary and why as today. The `MIGRATION.PLANNING_FAILED` entry in `docs/reference/error-reference.md` mentions `statementRejected`; re-read the three `MIGRATION.STATEMENT_*` entries against the final behaviour and correct them if dispatch 2's wording drifted.
- **Docs.** `packages/1-framework/3-tooling/cli/README.md`: the `prisma migration plan` section (around lines 1082–1114: synopsis, options, what it does, outputs) and the `prisma db update` section (around 1020–1081) describe `--rename old:new`, the coordinate forms, that statements resolve in contract vocabulary against the origin and destination contracts and apply in order, the `Statements applied` output, the three error codes, and for `db update` that the origin contract comes from the marker's snapshot and that running the same statements twice fails. Keep it to what this slice ships; `--delete`, the refusal and the prompt are not in this release.
- **Tests**, in the existing patterns: `test/orm/migration-plan.test.ts` (offline project, fake planner from `test/orm/fixtures/offline-project.ts`; extend the fake planner to record the `statements` it received and to return `appliedStatements`): `--rename` reaches the planner resolved; two `--rename` flags keep their order; an unresolvable statement fails with `STATEMENT_UNRESOLVED` and no migration directory is written; `Statements applied` in human output and `appliedStatements` in JSON; greenfield with a statement is unresolved; the auto-baseline path passes statements to the delta leg only. `test/control-api/db-update.test.ts` (mock family with `readAllMarkers`, mock driver) plus an on-disk snapshot store as `db-update-to-resolution.test.ts` does: marker hash with a snapshot → `fromContract` is that contract and `statements` reach `planFromDiff`; marker present, snapshot missing, statements given → `STATEMENT_ORIGIN_UNKNOWN` naming hash and directory, nothing planned; no marker, statements given → `STATEMENT_ORIGIN_UNKNOWN` with `hash: null`; no statements → `fromContract` still comes from the snapshot when present but nothing else changes, and no snapshot is no error; the destructive pre-plan receives the statements; `appliedStatements` on the plan and apply results. `test/orm/db-update.test.ts`: the flag is accepted and the output blocks render. `migration-tools` tests for the new `planFromDiff` inputs.

**Out**

- Journeys against real databases, the upgrade fragment, the subsystem doc (dispatch 6).
- `--delete`, the refusal, `--confirm` changes, the interactive prompt (slice 2 and the stretch goal).
- `db init` statements; other contract spaces' origin contracts.

## Pinned decisions

- Resolution lives in the control API operations, so the engine commands stay thin and a programmatic caller of `executeMigrationPlanCommand` / `client.dbUpdate` gets the same behaviour with `renames`. This is also what lets a prompt answer be fed back later (requirement 12).
- `db update` reads the origin from the snapshot store only; never from the marker's `contract_json` column (project spec non-goal).
- `fromContract` for `db update` is supplied whenever the snapshot exists, with or without statements; the planner already tolerates it (it only reads it for field events and the `from` hash). If that changes existing `db update` plans in tests, stop and report rather than gating it on statements.
- The `Statements applied` block comes after the operations because the operations are what the user checks first; the statements explain why there is no drop-and-create.

## Edge cases and dispositions

| Case | Disposition |
| --- | --- |
| `--rename` given with `--from @empty` or on a greenfield plan | Every statement unresolved, message says the origin has no models. Test it. |
| `db update` second run with the same statements | Origin (snapshot at the new marker hash) lacks the old name → `STATEMENT_UNRESOLVED`. Test at the control-api level by pointing the marker at the destination hash. |
| Marker present, snapshot store has the hash but content verification fails | `readContractSnapshotJsonTolerant` returns undefined → treated as missing → `STATEMENT_ORIGIN_UNKNOWN` when statements are given. |
| Statements given, planner returns zero operations | No-op result with applied statements; not `PLANNING_FAILED`. Test it. |
| `--json` | `appliedStatements` is in the document; `Statements applied` is only in the human presentation. |
| Destructive pre-plan under `db update` | Receives the same statements. Test that a model rename statement makes the pre-plan non-destructive. |
| Destructive git | Forbidden, as in every brief. |
| F14, F24, F31, F26 | As in every brief. |

## Validation gate

Through `mise exec --`, package filters quoted one per `--filter`, long output to `wip/`.

- `pnpm typecheck`
- `pnpm --filter` lint and test for: cli, migration-tools, framework-components, errors, and any target whose tests build conflicts.
- `pnpm check:error-reference`
- `pnpm lint:deps`, `pnpm lint:framework-vocabulary` (272 unchanged), `pnpm lint:throws`, `pnpm lint:casts`
- `pnpm fixtures:check`
- Never the full integration, e2e or `test:all` suites.

## Completed when

- Both commands declare `--rename`, resolve before planning, fail before writing on a bad statement, pass resolved statements to the planner, and report `appliedStatements` in JSON and `Statements applied` in human output.
- `db update` supplies `fromContract` from the snapshot store and fails with `STATEMENT_ORIGIN_UNKNOWN` as specified; without statements its behaviour is unchanged (the existing tests still pass unmodified, apart from fixture shapes gaining the new fields).
- The planning-failed error carries the refused statement.
- README and error reference updated; every test under Scope exists and two were shown red-on-removal.
- Gate green; small signed `TML-3475:` commits; no attribution lines; no push.

## Operational

- Heartbeats to `wip/heartbeats/implementer.txt`. Time-box about three hours. Halt and report when: supplying `fromContract` to `db update` changes existing plans; the engine's `flag.repeated` does not behave as its type says; the snapshot store API cannot be reached from `db-run.ts` without a layering violation (`pnpm lint:deps`).
- Stay inside the worktree.

## Return shape

As in the earlier dispatches.

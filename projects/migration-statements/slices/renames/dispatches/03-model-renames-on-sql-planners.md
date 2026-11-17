# Dispatch 3 — Model renames from statements on both SQL planners

**Slice:** [`../spec.md`](../spec.md) · **Plan entry:** [`../plan.md`](../plan.md) § Dispatch 3 · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Builds on:** dispatches 1 and 2

## Task

Make the Postgres and SQLite planners act on resolved `rename` statements whose entity is `model`: map each one to its storage effect, apply the effects in order to a working copy of the origin schema, run the existing diff on the adjusted schema, emit the rename call and its companions ahead of the diff's calls, refuse a target table whose effective control policy is not `managed`, and report every statement on the plan as `appliedStatements`.

## Outcome

After this dispatch, `planner.plan({ ..., statements })` with a model rename statement produces a plan whose first calls are the table rename and its companion renames (as the hand-written `renameTable` facade would produce them), followed by the ordinary diff with no drop and create for that table. The invariant: a statement is intent, and the planner never guesses — nothing about the rename is inferred from the diff; it comes only from the statement, and the result is the same plan a user could have written by hand in `migration.ts`. The framework stays family-blind: the statement arrives in domain coordinates and only the SQL family reads storage.

## Scope

**In**

- `packages/2-sql/9-family/src/core/migrations/`: the mapping from a resolved model statement to a storage effect (compare the origin model's `storage.table` and `storage.namespaceId` with the destination model's; equal means no storage change), the `statementRejected` conflict kind, and the `appliedStatements` entry type with its description text (`rename model "Profile" to "User"`, using domain names; qualify with the namespace only when the contract has more than one).
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` and `.../sqlite/src/core/migrations/planner.ts`: build a working schema from `options.schema` (dispatch 1's `createWorkingSchema`), apply each storage effect in order through `postgresTableRenameCall` / `sqliteTableRenameCall` (so companions are computed against the working copy as earlier statements leave it), run the diff and every later consumer of `options.schema` against `workingSchema.current`, and put the rename calls and their companions first in the emitted call list.
- Control policy: before applying an effect, read the target table's effective control policy (`controlPolicyForCall` in the family, with the table node from `entityAt` on `contract.storage` and `contract.defaultControlPolicy`); anything but `managed` returns `plannerFailure([{ kind: 'statementRejected', summary, why, location }])` naming the table and the policy. Nothing is skipped silently.
- The plan output: `appliedStatements` on the framework `MigrationPlan` type (`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`), one entry per statement in order, each carrying the resolved statement, the family's description text and the number of operations it produced (zero when storage did not change). The Mongo planner and every test plan must still compile; Mongo passes an empty list.
- The slice spec's wording: replace `MigrationPlannerInput` with the real name of the planner's options type in `projects/migration-statements/slices/renames/spec.md` (one-line edit, own commit).
- Unit tests on both targets, in the style of the existing `rename-table-*.test.ts` and `planner.*.test.ts` files: a statement produces the rename and companions and no drop-and-create; `@@map` keeps the table name so the statement applies with zero operations; two statements compose in order (`Profile:User` then a second model rename) with companions computed after the first; a non-`managed` target table fails with `statementRejected`; `appliedStatements` is reported in order with the right counts; a plan with statements and no diff difference otherwise is empty apart from the renames.

**Out**

- Field statements and `renameColumn` (dispatch 4).
- The `--rename` flag, the origin contract for `db update`, printing `Statements applied` (dispatch 5).
- Statement resolution (dispatch 2 owns it; the planner receives resolved statements and never parses text).
- Any change under `packages/1-framework` beyond the `appliedStatements` type on the plan.

## Where things are (from the orchestrator's survey of the branch)

- Planner input: the inline options object of `MigrationPlanner.plan` at `control-migration-types.ts` (around lines 438–499). Dispatch 2 added `statements: readonly ResolvedStatement[]` to it. The SQL family's `SqlMigrationPlannerPlanOptions` in `packages/2-sql/9-family/src/core/migrations/types.ts` and the Postgres, SQLite and Mongo `plan` option types were NOT widened yet; this dispatch adds `statements` to the family and both SQL target option types (Mongo too if it must compile against the framework shape).
- The statement types, from dispatch 2: `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`, exported from `@internal/framework-components/control`. `ResolvedStatement = ResolvedModelRename | ResolvedFieldRename`; each has `kind: 'rename'`, `entity: 'model' | 'field'`, `from` and `to`. `ModelCoordinate = { namespace: NamespaceId, model }`; `FieldCoordinate` adds `field`. This dispatch handles `entity: 'model'` only and must leave `entity: 'field'` statements for dispatch 4 (decide and document whether the planner ignores them or fails on them until then; failing loudly is preferred).
- Postgres `planSql` runs `buildPostgresPlanDiff({ contract, actualSchema: options.schema, ... })` right after `PostgresDatabaseSchemaNode.assert(options.schema)`; `options.schema` is also read by `verifyPostgresNamespacePresence` and `relationalNamespaceNode`. Calls are assembled as `[...ordered.structural, ...indexRenamePartition.kept, ...ordered.policyCalls, ...fieldEventPartition.kept]`.
- SQLite `collectSchemaIssues` runs `buildSqlitePlanDiff` with `options.schema`; calls are assembled as `[...replacedIndexes.calls, ...result.value.calls, ...fieldEventOps]`.
- Working schema and rename calls: Postgres `working-schema.ts` (`createWorkingSchema`, `WorkingSchema.apply`, `SchemaTableRename { schemaName; from; to }`), `table-rename-calls.ts` (`postgresTableRenameCall({ previous, contract, rename: ResolvedTableRename, frameworkComponents })`, `emissionSchemaForNamespace`), `table-rename-constraint-renames.ts`; SQLite `working-schema.ts`, `table-rename-calls.ts`. Today only the facades (`postgres-migration.ts` `schemaAfterRenames`, `sqlite-migration.ts`) call them; the planners do not.
- Family: `resolve-table-rename.ts` (`ResolvedTableRename { namespaceId; from; to }`), `schema-tables.ts`, `plan-helpers.ts` (`plannerFailure`), `types.ts` (`SqlPlannerConflictKind` closed union, `SqlPlannerConflictLocation`), `control-policy.ts` (`controlPolicyForCall`).
- Storage bridge: `contract.domain.namespaces[ns].models[model].storage` as `SqlModelStorage { table; namespaceId; fields }` in `packages/2-sql/1-core/contract/src/types.ts`; `validateModelStorageReferences` in `packages/2-sql/1-core/contract/src/validators.ts` shows the read pattern. Postgres namespace id to DDL schema: `resolveDdlSchemaForNamespaceStorage` in `resolve-ddl-schema.ts`.
- From the dispatch 2 review: the Postgres planner forwards its options field by field into the issue planner (`planner.ts` around line 355 passes `fromContract: options.fromContract`), so `statements` is dropped silently unless forwarded explicitly. Widening `SqlMigrationPlannerPlanOptions` and the target option types with a required `statements` makes every direct `planner.plan({...})` call in the target tests fail to compile; add `statements: []` to them (a mechanical sweep, its own commit) rather than making the field optional. Repo rule: internal input types use required keys typed `| undefined`, not optional keys.
- Field events: `planFieldEventOperations({ priorContract: options.fromContract, ... })` on both planners. Dispatch 1's commit "pass field-event planning the applied renames" on the shelved branch (prisma/orm#30570, `f0926d96c5`) shows how a rename is handed to field-event planning so it does not fire a drop and add; copy that mechanism if dispatch 1 did not already bring it over.

## Edge cases and dispositions

| Case | Disposition |
| --- | --- |
| Origin and destination storage coordinates equal (`@@map` kept) | Applied, zero operations, reported. No call emitted. |
| Rename changes the DDL schema on Postgres (model moved across namespaces, `auth.User:public.User`) | Spec says `alter table set schema`. If the existing `RenameTableCall` and working schema cannot express a schema change, halt and report what would be needed; do not invent a composite operation. |
| Target table not `managed` | `statementRejected` conflict; planner failure; nothing else planned. |
| Two statements in order where the second depends on the first | Companions of the second computed on the working schema after the first. Test it. |
| Table does not exist in `options.schema` (origin schema lacks it; resolution passed because resolution reads contracts) | Planner failure with `statementRejected` naming the missing table; do not silently fall through to create. |
| Case-only rename on Postgres (`user:User`) | Planned as a rename; `detectTableNameCaseChanges` must not fire for a table a statement covers. Test it. |
| Destructive git operations | Forbidden: no `git clean`, `git reset --hard`, `git stash` of any kind, `git checkout -- .`, `rm -rf` on the worktree. |
| F24 / F31 stale `dist` | `mise exec -- pnpm build` before trusting a red gate. After changing exported types in the family or framework-components, build that package before typechecking targets. |
| F14 | Run `pnpm lint` per touched package; typecheck covers `test/**`. |
| F26 | A reviewer finding names a class; sweep the whole diff. |

## Validation gate

All through `mise exec --`. Save long output under `wip/` and read the file.

- `pnpm typecheck`
- `pnpm --filter <each touched package> lint`
- `pnpm --filter <each touched package> test` (family, postgres target, sqlite target, framework-components, mongo target)
- `pnpm lint:deps`
- `pnpm lint:framework-vocabulary` count not above the branch's count before your change
- `pnpm fixtures:check` (plan rendering changed)
- The two existing rename journeys compile: `test/integration/test/cli-journeys/rename-table-migration*.e2e.test.ts` via the integration package's typecheck, without running them.
- Never the full integration, e2e or `test:all` suites.

## Completed when

- Every test listed under Scope exists on both targets and goes red when the behaviour it covers is removed (verify two of them that way and say which).
- A plan from a model statement contains the rename and companion calls first and no drop-and-create for the renamed table, on both targets.
- `appliedStatements` is on the plan type and populated by both SQL planners; Mongo compiles with an empty list.
- The spec wording fix is committed on its own.
- The validation gate is green; the report lists each command and its result.
- Commits are small, intent-named, `TML-3475:` prefixed, signed with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no attribution lines. Do not push.

## Operational

- Heartbeat to `wip/heartbeats/implementer.txt` on each phase change.
- Time-box about three hours. Halt and report when: the schema-move case needs an operation that does not exist; field-event planning cannot be told about a rename without touching `packages/1-framework`; a spec rule cannot be implemented as written.
- Stay inside the worktree.

## Return shape

As in dispatch 2: what was built by file; the gate table; the two red-check verifications; decisions the spec did not pin with the rejected alternative; what could not be done; the commit list.

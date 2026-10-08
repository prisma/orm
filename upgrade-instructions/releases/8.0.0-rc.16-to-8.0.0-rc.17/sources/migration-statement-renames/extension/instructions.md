---
changes:
  - id: planner-plan-statements
    summary: |
      Every call to a migration planner's `plan(...)` passes a new required `statements` list; pass `statements: []` when the call states no renames.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])statements\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]'
  - id: planner-plan-origin
    summary: |
      Every call to a migration planner's `plan(...)` passes a new required `origin`: the storage hash the produced plan asserts it starts from. `fromContract` no longer sets the plan's origin.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])origin\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]'
  - id: planner-success-applied-statements
    summary: |
      A migration planner's success result gains a required `appliedStatements` list; a planner, or a test double of one, that returns `{ kind: 'success', plan }` adds `appliedStatements`, empty when it applied no statements.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?<![\w$])MigrationPlanner(?:Result|SuccessResult)?(?![\w$]))(?![\s\S]*(?<![\w$])appliedStatements(?![\w$]))[\s\S]*kind:\s*["'']success["'']'
  - id: sql-planner-helpers
    summary: |
      In `@prisma/orm-family-sql/family/control`, `plannerSuccess(plan, warnings?)` becomes `plannerSuccess(plan, appliedStatements, warnings?)`, `planFieldEventOperations(...)` takes required `tableRenames` and `columnRenames` lists, and the conflict kind union gains `'statementRefused'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])plannerSuccess\s*\('
        - '(?<![\w$])planFieldEventOperations\s*\('
        - '(?<![\w$])SqlPlannerConflictKind(?![\w$])'
  - id: aggregate-planner-app-space
    summary: |
      The aggregate planner's `planMigration(...)` input takes a required `appSpace: { fromContract, statements }`, and a `PerSpacePlan` carries a required `appliedStatements` list.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])planMigration\s*\('
        - 'strategy:\s*["''](?:plan-from-diff|resolve-recorded-path|declared-state)["'']'
---

# Migration planners take statements and report the statements they applied

## `planner-plan-statements`

The options of `MigrationPlanner.plan` (from `@prisma/orm-framework/components/control`), of the SQL family's `SqlMigrationPlannerPlanOptions`, of the Postgres and SQLite planners, and of `MongoMigrationPlanner` (from `@prisma/orm-target-mongo/target/control`) gain a required `statements: readonly ResolvedMigrationStatement[]`: the `--rename` statements the user gave, resolved into namespace, model and field names. For each `plan({ ... })` call, add `statements: []` beside `fromContract`. A planner that forwards its options to another planner forwards `statements` too. Detection finds the calls that write their options inline in `plan({ ... })`; a call that builds its options object elsewhere and passes it in, such as `plan(options)`, is not detected, so check those calls by hand. `MongoMigrationPlanner` refuses a non-empty `statements` with a `statementRefused` conflict in this release.

A planner that cannot carry out statements must refuse them, never ignore them: an ignored statement plans a drop and create, which loses the data the statement was given to keep. When `statements` is not empty, return `{ kind: 'failure', conflicts: [...] }` with one conflict for the first statement it cannot carry out, of kind `statementRefused`, with that statement in `refusedStatement`, a `summary` that names it (`describeMigrationStatement(statement, fromContract, contract)` writes it in domain names), and a `why` that says how to keep the data without it. A planner that carries out some statements reports each one in `appliedStatements` and refuses the first one it cannot.

`ResolvedMigrationStatement`, `ResolvedModelRenameStatement`, `ResolvedFieldRenameStatement`, `ModelCoordinate`, `FieldCoordinate` and `describeMigrationStatement` are imported from `@prisma/orm-framework/components/control`.

## `planner-plan-origin`

The same planner options gain a required `origin: PlanOrigin | null`. It is the origin the produced plan asserts, which the runner checks against the database marker: the plan's `origin` and its `describe().from`. Until now a planner derived it from `fromContract`; now `fromContract` is only the contract the planner reads. To keep a call's behavior, pass `origin: planOriginOf(fromContract)`, with `planOriginOf` and the `PlanOrigin` type from `@prisma/orm-framework/components/control`. A call that plans from whatever state the database is in, as `db init` and `db update` do, passes `origin: null`. A planner implementation stamps `options.origin?.storageHash ?? null` onto its plan instead of reading the hash from `fromContract`. Detection finds the same inline `plan({ ... })` calls as `planner-plan-statements`; check calls that pass a prebuilt options object by hand.

## `planner-success-applied-statements`

`MigrationPlannerSuccessResult` gains a required `appliedStatements: readonly AppliedMigrationStatement[]`, one entry per statement the plan applied, in order, each with `operationIndexes`: the positions, in the plan's `operations`, of the operations it accounts for. `AppliedMigrationStatement` is imported from `@prisma/orm-framework/components/control`. In a planner implementation, or a test double of one, that returns `{ kind: 'success', plan, ... }`, add `appliedStatements: []` when the planner applies no statements.

`MigrationPlannerConflict` also gains an optional `refusedStatement`. A planner sets it only on a conflict that refuses a statement, as described under `planner-plan-statements`; existing conflicts leave it out.

Detection finds files that name `MigrationPlanner`, `MigrationPlannerResult` or `MigrationPlannerSuccessResult` and return `kind: 'success'` without `appliedStatements` anywhere in the file. It misses two cases, so check them by hand: a file that mentions `appliedStatements` once is skipped as a whole, even if another success result in it lacks the field; and a planner or test double that returns `{ kind: 'success', ... }` without naming one of those types, for example one typed through a family type such as `SqlPlannerSuccessResult`, is not found.

## `sql-planner-helpers`

These come from `@prisma/orm-family-sql/family/control`.

- Change `plannerSuccess(plan)` to `plannerSuccess(plan, [])`, and `plannerSuccess(plan, warnings)` to `plannerSuccess(plan, [], warnings)`.
- Add `tableRenames: []` and `columnRenames: []` to the options of each `planFieldEventOperations({ ... })` call.
- An exhaustive `switch` over `SqlPlannerConflictKind` gains a `case 'statementRefused':`.

## `aggregate-planner-app-space`

`planMigration`, `PerSpacePlan` and `AppSpacePlanningInputs` come from `@prisma/orm-toolchain/migration-tools/aggregate`. Add `appSpace: { fromContract: null, statements: [] }` to each `planMigration({ ... })` input, and `appliedStatements: []` to each `PerSpacePlan` object a test builds by hand.

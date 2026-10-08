# Dispatch 4 — Column rename operation and field statements

**Slice:** [`../spec.md`](../spec.md) · **Plan entry:** [`../plan.md`](../plan.md) § Dispatch 4 · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Builds on:** dispatch 3

## Task

Add a `renameColumn` operation to the Postgres and SQLite targets in the style of `renameTable` (facade method, planner call, DDL, prechecks and postchecks, working-schema step, companions), and make both planners apply a resolved `rename` statement whose entity is `field` through it, in statement order and on the working schema dispatch 3 introduced. A field statement whose storage does not change (same column name, or a relation field, which has no column) applies with zero operations and is still reported in `appliedStatements`.

## Outcome

After this dispatch, `--rename User.name:User.fullName` (resolved by dispatch 2, carried by dispatch 3's `statements` input) plans `renameColumn` plus the companion renames on both targets, and the diff that follows has no drop-and-add for that column. The invariant: what the statement produces is exactly what a user could write by hand as `...this.renameColumn({ table: 'User', column: 'name', to: 'fullName' })` in `migration.ts`, re-running that file reproduces `ops.json`, and every constraint and index whose name derives from the column ends up with the name the destination contract gives it, never a rebuild that loses data.

## Scope

**In**

- **Postgres** (`packages/3-targets/3-targets/postgres/src/core/migrations/`):
  - `RenameColumnCall(schemaName, tableName, oldColumnName, columnName, companions)` in `op-factory-call.ts`, `factoryName 'renameColumn'`, class `widening`, companions `RenameConstraintCall | RenameIndexCall`, `toOps` = own op then companions, `renderTypeScript` = `...this.renameColumn({ schema?, table, column, to })`; add it to the `PostgresOpFactoryCall` union and the op-factory exports; `issue-planner.ts` classifies it as `'column'`.
  - `operations/columns.ts`: `renameColumn(schema, table, from, to, lowerer)` emitting `ALTER TABLE <qualified> RENAME COLUMN "<from>" TO "<to>"`, precheck from present and to absent, postcheck to present and from absent, both via `columnExistsAst` from `contract-free/checks.ts`; id `renameColumn.<table>.<from>`.
  - Facade method `renameColumn({ schema?, table, column, to })` on `postgres-migration.ts`, same shape as `renameTable`: needs `startContract`, builds the working schema after `#renames`, resolves the rename, pushes the call onto `#renames`, returns `call.toOps(adapter)`. `resetAuthoringState` already clears `#renames`.
  - `working-schema.ts`: `renameColumnInPostgresSchema(schema, { schemaName, table, from, to })` renames the column on the table node and every reference to it: the primary key, uniques, foreign keys (own `columns`, and `referencedColumns` of foreign keys in every table that point at this table), indexes (`columns`; an index with an `expression` or `where` that mentions the column cannot be rewritten; leave it and let the diff handle it), and checks (same rule as expressions). `WorkingSchema.apply` accepts the new call.
  - Companions, computed against the working schema after the column rename, the same way `table-rename-constraint-renames.ts` and `pairIndexRenames` do it for a table rename: each unique and foreign key whose `columns` include the column pairs with the destination constraint of the same kind on the same (renamed) columns and is renamed to that constraint's explicit name, else `defaultUniqueName(table, columns)` / `defaultForeignKeyName(table, columns)` from `default-constraint-names.ts`, when that differs from the current name; the primary key keeps `<table>_pkey`; each index whose `columns` include the column pairs with the destination index of equal content (columns renamed, same `unique`, `type`, `options`, `where`, `expression`) and is renamed to the destination's wire name (`lowerAuthoredIndex` / `computeIndexContentHash` in `packages/2-sql/1-core`), when that differs. A check whose expression mentions the column is left to the existing drop-and-add check path (spec § Operations says so). Put the companion computation in its own module beside `table-rename-constraint-renames.ts` with its own tests.
- **SQLite** (`packages/3-targets/3-targets/sqlite/src/core/migrations/`):
  - `RenameColumnCall(tableName, oldColumnName, columnName, indexReplacements)` in `op-factory-call.ts`, companions all drops then all creates as `RenameTableCall` does; DDL `ALTER TABLE "<t>" RENAME COLUMN "<from>" TO "<to>"` in `operations/columns.ts` with `columnExistsAst` checks; facade `renameColumn({ table, column, to })` on `sqlite-migration.ts`; `renameColumnInSqliteSchema` in `working-schema.ts` with the same reference rewriting (SQLite rewrites references itself on `RENAME COLUMN`, but the working copy must match what the database will hold, index names included: SQLite keeps the old index name, so the replacement is what brings in the destination wire name).
  - Index companions through `pairIndexReplacements` in `index-replacements.ts` with a new matcher: same table, same columns after the rename, different name.
  - Checks: SQLite refuses CHECK constraints, nothing to do.
- **SQL family** (`packages/2-sql/9-family/src/core/migrations/`): the field-statement storage effect beside dispatch 3's model one: compare the origin field's `storage.fields[field].column` with the destination field's; a relation field (present in `model.relations`, absent from `storage.fields`) has no column; equal or no column means applied with zero operations. Resolve the origin field through the model the earlier model statement renamed (dispatch 2 already resolved the coordinates; here the family only reads storage). Description text `rename field "User.name" to "User.fullName"` for `appliedStatements`.
- **Both planners**: apply field effects in the same ordered pass as model effects (one list, statement order), through `postgresColumnRenameCall` / `sqliteColumnRenameCall` builders in `table-rename-calls.ts` or a sibling module, so companions are computed against the working copy as earlier statements left it. Field-event planning must be told about the column rename so it fires no drop and add (extend the mechanism dispatch 3 copied from the shelved branch).
- Tests on both targets in the pattern of `rename-table-facade.test.ts`, `rename-table-facade.authoring-state.test.ts`, `rename-table-ops.test.ts`, `table-rename-calls.test.ts` and the planner tests: facade emits the rename plus companions; explicit and derived constraint names; an index on the column gets the destination wire name; an FK from another table referencing the renamed column keeps its name and its reference; a check on the column goes through drop-and-add; chaining after a table rename of the same table (`Profile:User` then `User.name:User.fullName`); the planner plans a field statement with no drop-and-add; `@@map`-kept column name is zero operations; a relation field is zero operations; `appliedStatements` order and counts; SQLite index replacement names.

**Out**

- The `--rename` flag, `db update`'s origin contract, `Statements applied` output (dispatch 5).
- Journeys, upgrade fragment, docs (dispatch 6).
- Any `packages/1-framework` change (the field coordinate types exist; nothing new is needed there).
- Moving a field between models, value object fields, enum values (slice 3).

## Where things are (from the orchestrator's survey; verify against the tree, dispatch 3 has changed the planners since)

- `renameTable` end to end: Postgres facade `postgres-migration.ts` around line 386; `RenameTableCall` in `op-factory-call.ts` around 372; DDL and checks in `operations/tables.ts`; `postgresTableRenameCall` in `table-rename-calls.ts`; `constraintRenamesForTableRename` in `table-rename-constraint-renames.ts`; `pairIndexRenames` and `pairCheckRenames` in `index-and-check-renames.ts`; `renameTableInPostgresSchema` and `createWorkingSchema` in `working-schema.ts`. SQLite: `sqlite-migration.ts` around 161, `op-factory-call.ts` around 293, `operations/tables.ts`, `table-rename-calls.ts`, `index-replacements.ts` (`pairIndexReplacements`, matchers `renamedTableIndex`, `indexNameCaseChange`), `working-schema.ts`.
- Column ops as the pattern: Postgres `AddColumnCall`, `DropColumnCall`, `AlterColumnTypeCall` in `op-factory-call.ts` and `operations/columns.ts` (`columnExistsSteps`); SQLite `AddColumnCall`, `DropColumnCall` and `operations/columns.ts`.
- Names: `default-constraint-names.ts` (Postgres); `packages/2-sql/1-core/schema-ir/src/naming.ts` (`defaultIndexName`, `computeIndexContentHash`, `formatWireName`, `parseWireName`); `packages/2-sql/1-core/contract/src/index-naming.ts` (`lowerAuthoredIndex`).
- Schema IR: `packages/2-sql/1-core/schema-ir/src/ir/` (`SqlTableIR`, `SqlColumnIR`, `SqlUniqueIR`, `SqlForeignKeyIR` with `referencedColumns`, `SqlIndexIR`, `SqlCheckConstraintIR`); Postgres wraps as `PostgresTableSchemaNode`.
- Field storage: `SqlModelFieldStorage.column` in `packages/2-sql/1-core/contract/src/types.ts`; relations in `ContractModelBase.relations` (`packages/1-framework/0-foundation/contract/src/domain-types.ts`), which have no `storage.fields` entry.
- There is no `renameColumn` or `RENAME COLUMN` anywhere on the branch today.

## Edge cases and dispositions

| Case | Disposition |
| --- | --- |
| Column is in the primary key | Rename proceeds; `<table>_pkey` is unchanged; no companion. Test it. |
| Column is referenced by a foreign key from another table | Postgres and SQLite update the reference themselves; the working copy's `referencedColumns` is updated; the FK's own name derives from its own columns, so no rename. Test it. |
| Index with an `expression` or `where` mentioning the column | Not rewritten in the working copy; the diff plans whatever it plans (drop and create of an index loses no data, it is widening since dispatch 1). Test one such index to pin the behaviour. |
| Check mentioning the column (Postgres) | Existing drop-and-add path. Test it. |
| Same column name after the rename (`@@map` kept) | Zero operations, reported. |
| Relation field | Zero operations, reported. |
| Field statement after a model statement on the same model | Column rename computed on the working copy after the table rename; the call names the new table. Test it. |
| Old column missing from `options.schema` | Planner failure `statementRejected` naming the column; never fall through to add. |
| Case-only column rename on Postgres | Plain `RENAME COLUMN` works; no temporary name needed. SQLite: check whether `RENAME COLUMN` with a case-only change needs the temporary-name trick that `renameTableSteps` uses; if it does, do the same. |
| Destructive git | Forbidden: no `git clean`, `reset --hard`, `stash`, `checkout -- .`, `rm -rf`. |
| F24 / F31 | `mise exec -- pnpm build` before trusting red; rebuild family or framework packages after changing their exports. |
| F14 | `pnpm lint` per touched package; typecheck covers tests. |
| F26 | Sweep the class on any reviewer finding. |

## Validation gate

Through `mise exec --`; long output to `wip/` files.

- `pnpm typecheck`
- `pnpm --filter <each touched package> lint` and `test` (family, postgres target, sqlite target, and the two adapter packages if their tests touch rename)
- `pnpm lint:deps`
- `pnpm lint:framework-vocabulary` count unchanged
- `pnpm fixtures:check`
- The integration package typechecks (journeys reference the facade types) without running journeys.
- Never the full integration, e2e or `test:all` suites.

## Completed when

- `renameColumn` exists on both facades and both planners with DDL, checks, working-schema step and companions, and every test under Scope exists and goes red when its behaviour is removed (verify two and say which).
- A plan from a field statement contains the column rename and companions and no drop-and-add for that column, on both targets; `appliedStatements` lists it.
- `renderTypeScript` of the call is the facade call a user would write; a facade call with the same arguments produces the same ops as the planner's call.
- Gate green; report lists each command and result.
- Small signed `TML-3475:` commits, no attribution lines, no push.

## Operational

- Heartbeats to `wip/heartbeats/implementer.txt`. Time-box about three hours. Halt and report when: the working-schema rewrite needs a schema IR change in `packages/2-sql/1-core`; the SQLite case-only rename needs something the DDL cannot do; a `packages/1-framework` change turns out to be required.
- Stay inside the worktree.

## Return shape

As in dispatches 2 and 3.

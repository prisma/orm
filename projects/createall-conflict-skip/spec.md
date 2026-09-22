# createAll conflict skip

> Linear Project: _not yet created_ · Origin: Discord `#prisma-8`, [thread](https://discord.com/channels/937751382725886062/1477940100561244295/1543099477601165403), asks record `01a09221-27d9-760f-b548-da35159ce611` · Public commitment: Will to broken.wind, 2026-09-09, "skipDuplicates is on our list, I'll let you know once it's available" · Branch: _to be created from the Linear Project id_

## Purpose

Let a batch insert tell the database to skip rows that collide with an existing unique constraint, so users can load data idempotently without a round trip to find the duplicates first. Prisma 7 had this as `createMany({ skipDuplicates: true })`; Prisma 8 promised an equivalent on `createAll` in public and has not shipped it.

## At a glance

Today `createAll(rows)` compiles to `INSERT ... VALUES (...), (...) RETURNING ...` on Postgres, or one insert per column signature on SQLite. Any unique violation fails the whole statement. The only workaround is to dedupe in application code, which requires knowing the current database state.

The SQL AST already models `ON CONFLICT ... DO NOTHING` and both renderers emit it, because `upsert` uses it. The one thing missing is a way to ask for it from `createAll`, and the AST's rule that a conflict clause must name at least one column.

After this project:

```ts
const inserted = await db.User.createAll(rows, { onConflict: 'skip' });
const inserted = await db.User.createAll(rows, { onConflict: 'skip', conflictOn: ['email'] });
const count = await db.User.createAndCount(rows, { onConflict: 'skip' });
```

The first form skips on any unique constraint, including the primary key, and compiles to a bare `ON CONFLICT DO NOTHING`. The second names the constraint by its columns. `createAll` returns only the rows the database actually inserted. `createAndCount` returns the database's own count of inserted rows.

The option is refused, not silently ignored, when the adapter does not report the capability. MySQL and SQL Server are planned targets, and neither has `ON CONFLICT`. SQL Server in particular needs an explicit key to express "skip on conflict" at all, which is why the conflict target is part of the API from the start rather than added later.

We deliberately do not copy the Prisma 7 name. `skipDuplicates: true` says nothing about which constraint it means. `onConflict: 'skip'` reads as a policy, pairs with `conflictOn` the way `upsert` already does, and keeps the default policy, error, nameable. Update-on-conflict is not a future value of this option: single-row upsert exists, and a batch form would be its own method.

## Non-goals

- **Batch upsert.** `upsert` covers the single-row case. A batch form would be a separate method, never a value of `onConflict`.
- **Conflict skipping on multi-table inheritance variants.** A variant row is a base-table row plus a variant-table row inserted separately per input row. A conflict in the variant table would orphan the already-inserted base row. Supporting it needs a savepoint per row. This project refuses the option on variant collections with the existing `ORM.OPERATION_UNSUPPORTED` shape.
- **Mongo.** `insertMany` has no conflict target concept; `ordered: false` swallows every error, not only duplicates. The Mongo ORM `createAll` is untouched.
- **Nested creates with conflict skipping.** `createAll` already rejects relation callbacks.
- **Reporting which input rows were skipped.** The result is the inserted rows. Callers who need the skipped set diff it themselves.
- **A MySQL or SQL Server implementation.** Only the capability keys those targets will need are defined here.

## Place in the larger world

- **SQL ORM client** (`packages/3-extensions/sql-orm-client`). `Collection.createAll`, `createAndCount`, and `create` live in `src/collection.ts`; insert compilation in `src/query-plan-mutations.ts`. `upsert` already builds `InsertOnConflict` for one row and is the vocabulary precedent (`conflictOn`).
- **Relational SQL AST** (`packages/2-sql/4-lanes/relational-core/src/ast/types.ts`). `InsertOnConflict` holds `columns` and an action (`do-nothing` or `do-update-set`). `InsertAst.withOnConflict` attaches it.
- **Adapters** (`packages/3-targets/6-adapters/postgres`, `.../sqlite`). Both renderers emit the clause and both throw `RUNTIME.AST_INVALID` when `columns` is empty. Both report the `sql.*` capability profile the ORM gates on.
- **Capabilities** (`docs/reference/capabilities.md`, `.agents/rules/capabilities-ownership.mdc`, `docs/architecture docs/patterns/capability-gating.md`). Adapters report capabilities; contracts record the requirement and pin `profileHash`; the ORM gates at the consumption site on the key, never on the target id.
- **Runtime execute statistics.** `runtime.execute(plan)` returns `affectedRows`, which `updateAndCount` and `deleteAndCount` already return. `createAndCount` does not, and returns `data.length` instead.
- **Scorecard** (`scorecard/06-sql-orm-client.md`). The row `createMany({ skipDuplicates })` is marked "not in 8.0" for both targets and must change.
- **Ported engine tests** (`projects/port-all-tests/checklists/engines-writes.md`). Three unported cases cover skip-duplicates behaviour and become portable once this ships.

## Cross-cutting requirements

- **The gate is a capability, never a target.** `createAll` and `createAndCount` refuse `onConflict: 'skip'` with `ORM.CAPABILITY_MISSING` unless the contract's capabilities carry `sql.insertOnConflictSkip: true`. An untargeted skip (no `conflictOn`) additionally requires `sql.insertOnConflictWithoutTarget: true`. Postgres and SQLite report both. A contract emitted before this project carries neither key and is refused; users regenerate.
- **The AST allows a targetless `do-nothing` and nothing else targetless.** `InsertOnConflict` with empty `columns` is valid only with the `do-nothing` action. Both renderers emit `ON CONFLICT DO NOTHING` for it and keep throwing `RUNTIME.AST_INVALID` for a targetless `do-update-set`.
- **Results describe what the database did.** `createAll` yields exactly the rows the `RETURNING` clause produced. `createAndCount` returns the driver's affected-row count on every path, with or without the option, on Postgres and on the SQLite split path (summed across statements). `create()` keeps its current contract and does not take the option.
- **The option rides alongside the annotation callback.** `createAll(rows, options?, configure?)` and `createAndCount(rows, options?, configure?)`. The existing two-argument form with a callback in second position stays valid, so no call site breaks.
- **`conflictOn` names model fields, not columns**, and resolves through the same field-to-column mapping `upsert` uses. A field that is not part of the model is refused with the existing `ORM.ARGUMENT_INVALID` shape.
- **Multi-table inheritance variants refuse the option** with `ORM.OPERATION_UNSUPPORTED`, the same shape `createAndCount` already uses for variants.
- **Tests execute against both databases.** A Postgres integration test and a SQLite end-to-end test each insert a batch with one genuine conflict and assert the returned rows, the count, and the exact SQL AST. The unit tier covers renderer output for the targetless clause and the refusal for targetless `do-update-set`.

## Transitional-shape constraints

- **Slice 1 lands before slice 2.** The `createAndCount` count fix ships on its own so the feature slice starts from a `createAndCount` that already tells the truth. Slice 2's PR targets `main` after slice 1 merges, not a stacked branch.
- **No intermediate state ignores the option.** If the option is accepted by the type signature it is honoured or refused. There is no commit in which `onConflict: 'skip'` typechecks and compiles to a plain insert.
- **Fixtures regenerate with the capability keys.** Emitted `contract.json` and `contract.d.ts` fixtures under `packages/3-extensions/**` and `packages/3-targets/**` change when the adapter profiles gain the two keys. Migration snapshots are never regenerated; old snapshots simply lack the keys, which the gate treats as "not supported".

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)). Project-specific conditions on top:

- [ ] `createAndCount(rows)` on Postgres and SQLite returns the driver's affected-row count, proven by an integration test where the database inserts fewer rows than were passed.
- [ ] `db.User.createAll(rows, { onConflict: 'skip' })` against Postgres and SQLite, with one row colliding on a unique column, returns the non-colliding rows only and executes one statement per column-signature group with a bare `ON CONFLICT DO NOTHING`.
- [ ] The same call with `conflictOn: ['email']` renders `ON CONFLICT ("email") DO NOTHING` on both targets.
- [ ] A contract whose capabilities lack `sql.insertOnConflictSkip` refuses the option with `ORM.CAPABILITY_MISSING`; one lacking `sql.insertOnConflictWithoutTarget` refuses the untargeted form only.
- [ ] A multi-table inheritance variant collection refuses the option with `ORM.OPERATION_UNSUPPORTED`.
- [ ] `docs/reference/capabilities.md` documents both keys; the SQL ORM client docs document the option; `scorecard/06-sql-orm-client.md` marks the row as proven on both targets with test links.
- [ ] The three skip-duplicates engine cases in `projects/port-all-tests/checklists/engines-writes.md` are ported or explicitly marked not applicable with a reason.
- [ ] The asks record has both deliverables set to done with PR links, the ask is satisfied, and Will has replied to broken.wind so the commitment can be discharged.

## Contract impact

No contract entity changes. The `capabilities` map in emitted contracts gains `sql.insertOnConflictSkip` and `sql.insertOnConflictWithoutTarget` for Postgres and SQLite, which changes `profileHash` for regenerated contracts. Consumers who want the option regenerate their contract; consumers who do not are unaffected.

## Adapter impact

- **postgres**: reports both keys; renderer accepts a targetless `do-nothing`.
- **sqlite**: reports both keys; renderer accepts a targetless `do-nothing`. SQLite supports `ON CONFLICT DO NOTHING` without a target since 3.24.
- **mongo**: none.
- **mysql, mssql** (future): the keys tell those adapters what to implement. MySQL can report `insertOnConflictSkip` via `INSERT IGNORE` or `ON DUPLICATE KEY UPDATE`, but `createAll` also needs `returning`, which MySQL lacks. SQL Server can report `insertOnConflictSkip` only, via `MERGE` or `INSERT ... SELECT ... WHERE NOT EXISTS`, and never `insertOnConflictWithoutTarget`.

## ADR pointer

No new subsystem or pattern. The decision to require an explicit conflict target for portability, and to name the option `onConflict` rather than `skipDuplicates`, is recorded in [`design-notes.md`](./design-notes.md). At close-out, decide whether the "conflict target is part of the API" rule is durable enough to amend the capability-gating pattern doc rather than warrant an ADR.

## Open questions

1. **Should `conflictOn` accept the same object shape as `upsert`'s `conflictOn` (a criterion with values) or a field list?** Recommendation: a field list. A batch has no single value to put in a criterion. `upsert` stays as it is.
2. **Does `create()` ever take the option?** Recommendation: no. A single-row skip that may return nothing is `upsert` with `update: {}`, which already exists and reloads the existing row.

## References

- Discord thread and the commitment message: `https://discord.com/channels/937751382725886062/1543099477601165403/1546499951587233813`
- `packages/3-extensions/sql-orm-client/src/collection.ts` (`createAll`, `createAndCount`, `upsert`, `#executeMtiCreate`)
- `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts` (`compileInsertReturning`, `compileInsertCount`, split variants, `compileUpsertReturning`)
- `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` (`InsertOnConflict`, `InsertAst`)
- `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts` and `packages/3-targets/6-adapters/sqlite/src/core/adapter.ts` (insert rendering)
- `docs/reference/capabilities.md`, `docs/architecture docs/patterns/capability-gating.md`
- `scorecard/06-sql-orm-client.md`
- `test/integration/test/sql-orm-client/create.test.ts`, `test/e2e/framework/test/sqlite/orm.test.ts`

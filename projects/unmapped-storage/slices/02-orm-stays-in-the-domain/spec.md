# Slice 2: the SQL ORM reads and writes only the columns a model's fields map

_Parent project: `projects/unmapped-storage/`. Linear: TML-3532. Stacked on slice 1 (TML-3468, prisma/orm#30665). Outcome: a contract whose tables hold extra columns is safe to query; the ORM never returns, writes or accepts the name of a column no field maps._

## At a glance

A contract built from a definition where table `User` has columns `id`, `email`, `legacy_key` and model `User` maps only `id` and `email`:

```ts
await db.public.User.all();                         // [{ id: 1, email: 'a@b' }], no legacy_key
await db.public.User.create({ email: 'c@d', legacy_key: 'x' } as never);
// throws ORM.FIELD_UNKNOWN: Model "User" has no field "legacy_key"
await db.public.User.where((u) => u.legacy_key.eq('x')).all();
// throws ORM.FIELD_UNKNOWN
```

Today the first call returns `legacy_key`, the second writes it, and the third filters on it.

## Chosen design

### A model's columns, worked out per model

One function lists a model's fields including the fields it inherits from its base. From it, one function gives the columns a query on a model reads from a given table: the model's fields on that table, its variants' fields on that table, and, on a multi-table variant's table, the key it inherits. The default projection, `RETURNING` lists, multi-table variant joins and include binding keys use that set, never every column of the table.

The ORM may still read every column inside a query it builds where the column never reaches a row, such as the row-number subquery behind `distinct`.

### One strict resolver

Every name a caller passes as a field resolves through one resolver that throws `ORM.FIELD_UNKNOWN` (`Model "<model>" has no field "<name>"`, meta `{ model, field }`) for a name that is not a field of the model (its own or inherited). Two surfaces also accept variant fields: `select` accepts every variant's fields on an unnarrowed collection, because its projection places each column on its own table; the `where`/`orderBy` callback accessor accepts the narrowed variant's fields when the collection is narrowed. The accessor returns `undefined` for `then` and `toJSON` and the target's value for `Object.prototype` names, so awaiting it, stringifying it or comparing it by identity in user code still works. A test library that probes other names to print the accessor (vitest reads `$$typeof` and `nodeType`) gets a field error; that is accepted. The principle behind which surfaces accept variant fields: a surface accepts a variant's field only when it can place that field's column on the variant's table. Nothing falls back to treating the name as a column. This covers: `where` shorthand and the `where`/`orderBy` callback accessor, `create`/`update`/`upsert` data (including single-table and multi-table variant creates), `select`, `distinct`, `distinctOn`, `groupBy`, `cursor`, aggregates and `having`, `conflictOn`, nested `select` under `include`, relation filters and relation join columns, and fragments.

### Row mapping without pass-through

Mapping a row from columns to fields drops any column no field maps. A model with an empty field map maps to an empty row, not to the raw row.

### The contract side

- The relation lowering in contract-ts (`model-relations.ts`) refuses a join column that is not a field's column, with a `CONTRACT.*` error, instead of passing the column name through as a field name. A many-to-many relation is exempt on its target side: its target names are the junction table's columns by design.
- Validators in `packages/2-sql/1-core/contract`: every domain field has a storage entry; an execution (ORM-generated) default targets a column some field maps.
- The build warns about a required extra column with no database default on a table some model maps: every ORM insert into that table would fail. It is a warning, not a refusal, because Prisma 7 allows it.

## Coherence rationale

One reviewer can hold it: one rule ("the ORM reaches storage only through a field") applied across the ORM's read, write and name-resolution paths, plus three small contract-side checks that keep contracts from reaching the ORM in a shape the rule cannot handle.

## Scope

In: `packages/3-extensions/sql-orm-client/src/**` and its tests; `packages/2-sql/2-authoring/contract-ts/src/model-relations.ts` and the build's warnings; `packages/2-sql/1-core/contract/src/validators.ts`; integration tests under `test/integration/test/sql-orm-client/` for the leak cases.

Deliberately out:

- Model types. The emitted `contract.d.ts` and the no-emit `SqlContractResult` already build model, row and input types from fields only, so extra columns do not reach them. Typing a model with no fields (`Record<string, never>` today) is a separate change: rows should be `{}` and create inputs must still reject any key, which `{}` does not. Tracked separately.
- Any source producing extra columns (slice 3).

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| Single-table variants | The base table holds every variant's columns. A query on the base reads the base's and its variants' fields; a query pinned to a variant reads the base's fields plus that variant's. |
| A multi-table variant with no field of its own | Its table still holds the inherited key; the query reads it so `create` can return the row. |
| Polymorphic `select` accepting raw column names (`resolvePolymorphicProjectionSelection`) | Refuse a name that is not a field, like every other surface. |
| `resolveInsertConflictColumns` | Already strict; align its error with `ORM.FIELD_UNKNOWN` only if it reports the same situation. |
| Tests asserting today's fall-back behaviour (`collection-runtime.test.ts`) | They flip; the new expectation is the refusal or the dropped column. |
| Salvage | Branch `tml-3468-unexposed-storage` has a strict resolver, `getModelFields`, `resolveModelColumns`, both validators and a polymorphism fixture whose variant holds only the key. Its ORM source does not depend on the dropped `unexposed` flag. Reuse it where it fits; its integration fixture uses the flag and must be rebuilt on slice 1's table nodes. |

## Slice-specific done conditions

- Integration tests against a real database, with a contract whose table holds an extra column (built through slice 1's `ContractDefinition` table nodes): `findMany` with no `select` and with `include` returns no extra column; `create` returns no extra column; passing the extra column's name to `create`, `where` (shorthand and callback) and `select` throws `ORM.FIELD_UNKNOWN`.
- No `?? fieldName`-style or `?? columnName`-style fallback remains in `sql-orm-client/src` (grep check in the PR).

Polymorphic models with extra columns are not covered by an integration test, because no source can produce one: the TypeScript builder has no inheritance, the PSL reader adds polymorphism after the build and takes no table nodes, and Prisma 7 has no inheritance. Unit tests cover the per-model column sets for single-table and multi-table variants with the existing polymorphic fixtures, where sibling variants' columns play the part of columns a model does not map. The integration case moves to TML-3469, when Prisma 8 syntax can declare extra columns.

## Dispatch plan

| # | Outcome | Builds on | Hands to |
|---|---|---|---|
| 1 | One model-fields function (with inherited fields), one strict resolver throwing `ORM.FIELD_UNKNOWN`, every name-resolution surface moved onto it, and row mapping without pass-through. Unit tests per surface, red first. | Slice 1 | Name resolution and row mapping that cannot reach an extra column. |
| 2 | Per-model column sets for the default projection, `RETURNING`, multi-table variant joins and include binding keys. Integration tests for the done conditions. | Dispatch 1 | The slice's ORM outcome. |
| 3 | Contract side: relation lowering refuses a join column with no field; the two validators; the required-extra-column warning. | Dispatch 2 | The slice outcome. |

## References

- ADR 267 (prisma/orm#30641), section "Keeping the ORM to the domain".
- Principal engineer review of ADR 267, item 4 (the fallback sites).

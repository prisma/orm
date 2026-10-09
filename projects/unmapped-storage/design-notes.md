# Design notes — storage a model does not map

## Principles

- Storage is what migrations, `db verify` and the storage hash read. The domain is what the ORM and its types read. A column the application must not see is a storage fact with no domain counterpart.
- Every source lowers through `ContractDefinition` and one lowering (ADR 181). Nothing enters the contract another way.
- The Prisma 7 reader describes exactly or refuses (ADR 252).

## The model

`ContractDefinition` gains two node kinds:

- A **column node**: a `FieldNode` without the field part. Column name, type descriptor, nullability, list shape, authored default, `noCheck`. Addressed to a table.
- A **table node**: the table half of a `ModelNode`. Namespace, table name, column nodes, primary key, uniques, indexes, checks, foreign keys, control policy.

The lowering merges a table's column nodes with the columns its model's fields imply before it lowers any column, and lowers a table node through the same table lowering as a model's table. A foreign key may target a table by name.

## Decisions taken in planning

- **The build is split** (Will, 2026-10-08). `buildSqlContractFromDefinition` is decomposed so a model can be lowered on its own into the pieces it implies, and the pieces are then assembled with declared storage. Slice 1 does the split behind an old-versus-new comparison over every definition the repository produces. The ADR does not describe the split; it is an implementation choice.
- **No per-column control policy.** Nothing in scope needs it, and the reviewers showed it is undefined for `CREATE TABLE` and for SQLite's table rebuild. ADR 224 stands.
- **No Prisma 8 syntax yet.** Deferred until Will and Serhii agree. `contract print` keeps refusing storage with no model, so a Prisma 7 project that uses `@ignore` cannot print its contract as Prisma 8 PSL until that syntax exists.

## Open questions

### An `@ignore` field whose type has no Prisma 8 codec (decided)

Will, 2026-10-09: refuse to load the schema if the contract cannot express its contents. An `@ignore` field, or a column of an `@@ignore` model, whose type has no Prisma 8 codec is an error, like the same field without `@ignore`. The reader's messages stop offering `@ignore` and `@@ignore` as a way around a missing codec, because neither leaves the column out any more. A Prisma 7 project with such a column cannot load until Prisma 8 supports the column type (planning row "Columns whose type has no codec").

### `_prisma_migrations` (decided)

Decided 2026-10-09 from the code. Declaring the ledger in the contract, under any control policy, puts a table with no model into every Prisma 7 contract: every Prisma 7 project's storage hash changes, and `contract print` refuses every Prisma 7 contract at cutover, because no syntax declares a table with no model. Prisma 7's own `db pull` never introspects the table either: it is the tool's bookkeeping, not the application's schema. So the Postgres target names `_prisma_migrations` as a tool table, beside Prisma 8's own `prisma_contract` schema, and `db verify` (strict included) and `contract infer` leave it alone. This is the facade ignore list the Prisma 7 project spec proposed. Slice 4.

## Alternatives considered

See ADR 267. Two are recorded here because they shaped the plan:

- **Declared storage in the contract's own storage input shapes** (`StorageTableInput`, `StorageColumnInput`). Rejected after review: those shapes are the output of lowering (data types, encoded defaults, derived checks, hashed names), so every source would repeat the lowering.
- **The earlier "unexposed" design**: a flag on fields and models telling the ORM to hide them. Rejected by Will on 2026-10-07: the contract should say the table has an extra column, not that the model has a field it hides.

## References

- `spec.md`, `plan.md`.
- ADR 267 and its reviews (architect and principal engineer, 2026-10-07).

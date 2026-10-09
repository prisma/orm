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

### An `@ignore` field whose type has no Prisma 8 codec

Prisma 7 users put `@ignore` on a field Prisma 8 cannot type, for example `legacy Decimal @db.Money`, because the reader's own error message tells them to. Today the reader drops the field without a word and the schema loads. Under this design a kept column needs a codec, and this one has none. Three options:

1. Refuse it with an error. This follows ADR 252, but a schema that loads today stops loading after the upgrade, with no edit that fixes it until the codec-less column work ships.
2. Keep today's behaviour: leave the column out silently. The schema keeps loading, but adding `@ignore` to such a field still drops the column, and ADR 252's rule stays broken for this case.
3. Leave it out with a warning. ADR 252 and the Prisma 7 project spec forbid warnings: every construct is described or refused.

Recommendation pending Will: option 2 for now, recorded as a known gap in ADR 267 and the reader's README, and the codec-less column item moves ahead of the deferred syntax item on the plan.

### `_prisma_migrations`

It exists on a database Prisma 7 built and is missing from a fresh database rebuilt from `migrations/`. `managed` and `tolerated` would create it; `external` fails verify when it is missing; `observed` warns when it is missing. The Prisma 7 project spec proposed an ignore list supplied by the Postgres facade instead. Decided before slice 3.

## Alternatives considered

See ADR 267. Two are recorded here because they shaped the plan:

- **Declared storage in the contract's own storage input shapes** (`StorageTableInput`, `StorageColumnInput`). Rejected after review: those shapes are the output of lowering (data types, encoded defaults, derived checks, hashed names), so every source would repeat the lowering.
- **The earlier "unexposed" design**: a flag on fields and models telling the ORM to hide them. Rejected by Will on 2026-10-07: the contract should say the table has an extra column, not that the model has a field it hides.

## References

- `spec.md`, `plan.md`.
- ADR 267 and its reviews (architect and principal engineer, 2026-10-07).

# Storage a model does not map

**Linear:** P-TML-1151. **Design:** ADR 267, "A table may hold columns its model does not map" (design PR prisma/orm#30641).

## Purpose

A Prisma 7 project that has handed its migrations to Prisma 8 must be able to keep columns and tables the application never sees, as Prisma 7 does with `@ignore` and `@@ignore`. Today those objects are missing from the contract, so Prisma 8 drops them when a user adds `@ignore`, tries to create them again when a user removes it, and reports Prisma 7's `_prisma_migrations` table under `db verify --strict`.

## At a glance

```prisma
model User {
  id         Int     @id
  email      String  @unique
  legacy_key String? @ignore
}

model AuditRow {
  id         Int      @id
  recordedAt DateTime @map("recorded_at")

  @@map("audit_rows")
  @@ignore
}
```

After this project the contract read from that schema holds:

| Storage plane | Domain plane |
|---|---|
| table `User`: `id`, `email`, `legacy_key` | model `User`: fields `id`, `email` |
| table `audit_rows`: `id`, `recorded_at` | no model |

Migrations, `db verify` and the storage hash see `legacy_key` and `audit_rows`. The ORM and its types do not. Adding or removing `@ignore` changes no storage and plans no migration.

## Non-goals

- Prisma 8 PSL or TypeScript syntax for declaring a column or table with no model. Deferred until Will and Serhii agree on one (ADR 267, alternatives).
- `contract print` and `contract infer` for such storage. Without Prisma 8 syntax there is nothing to print, so `contract print` keeps refusing a contract that holds it.
- Columns whose type has no Prisma 8 codec. That is planning row "Columns whose type has no codec".
- Control policy per column. A column keeps its table's policy (ADR 224).
- MongoDB.

## Place in the larger world

- Every contract source lowers to `ContractDefinition` (`packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts`), and `buildSqlContractFromDefinition` (`build-contract.ts`) turns it into a contract. ADR 181 makes that the shared lowering target. This project adds column nodes and table nodes to the definition and lowers them through the same code as a model's columns.
- The Prisma 7 reader (`packages/2-sql/2-authoring/contract-prisma7`) is the only source that produces such storage. ADR 252 governs it: every construct is described exactly or refused.
- The SQL ORM client (`packages/3-extensions/sql-orm-client`) reads every column of a table today and falls back to a column name when a field name is unknown, in 18 places.
- The handover test (`examples/prisma7-adoption/test/handover.test.ts`) pinned `unclaimed: ["_prisma_migrations"]` under strict verify until slice 4.

## Cross-cutting requirements

1. **One lowering.** A column or table with no model enters the contract only through `ContractDefinition` and is lowered by the same code that lowers a model's column or table.
2. **Exposure does not move storage.** Lowering a model with a field gives the same storage plane, compared with deep equality, as lowering the model without the field plus the same column as a column node.
3. **The ORM stays in the domain, at runtime as well as in types.** No name a caller passes falls back to a column name, and no row carries a column no field maps.
4. **The reader never drops silently.** Every ignored object the reader cannot describe, including a column whose type has no Prisma 8 codec, is refused with a diagnostic.

## Transitional-shape constraints

- The reader may produce storage with no model only after the ORM stops reading unmapped columns, otherwise `findMany()` returns them. The reader slice therefore comes after the ORM slice.
- A project that signed with the current reader has a storage hash computed without its ignored objects. The reader slice ships an upgrade instruction, and the first plan after upgrading contains no DDL.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- In `examples/prisma7-adoption`, an edit that adds `@ignore` to a field and `@@ignore` to a model plans no operations, and so does the edit that removes them.
- The handover test asserts `db verify --strict` reports nothing unclaimed on the database Prisma 7 built.
- A Prisma 8 `findMany()` with no `select`, on a model whose table has an extra column, returns no extra column, and `create` with that column's name throws `ORM.FIELD_UNKNOWN`.
- ADR 267 is merged, and the Prisma 7 project's slice 1 text that says ignored objects are omitted is replaced.

## Open questions

None. The codec-less column and `_prisma_migrations` are both decided; see `design-notes.md`.

## References

- ADR 267 (design PR prisma/orm#30641), ADR 181, ADR 221, ADR 224, ADR 252.
- `projects/prisma7-contract-source/spec.md`, `slices/01-postgres-source/spec.md`, `slices/05-migration-ownership-handover/spec.md`.
- The earlier attempt, branch `tml-3468-unexposed-storage` (head `64601ebc15`), closed PR prisma/orm#30631.

# Slice 1: Prisma 7 contract source for Postgres

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: a Postgres user points `prisma.config.ts` at their Prisma 7 `schema.prisma` and `contract emit`, `db sign`, and `db verify` succeed against the database Prisma 7 built._

## At a glance

```ts
import { defineConfig, prisma7Schema } from '@prisma/orm-postgres/config';
export default defineConfig({ contract: prisma7Schema('prisma/schema.prisma') });
```

```bash
prisma contract emit   # reads schema.prisma, writes contract.json + contract.d.ts
prisma db sign         # verifies against the Prisma 7 database, records the marker
```

## Chosen design

- **Parser additions** in `@internal/psl-parser`: attributes on enum members (`USER @map("user")`), and field lines inside a `view` block parsed as a model-shaped block so the interpreter can reject views with a span. Both are grammar-only; nothing else in the parser changes.
- **Package** `packages/2-sql/2-authoring/contract-prisma7` (`@internal/sql-contract-prisma7`), shaped like `contract-psl`: `prisma7Schema(path, options)` returns a `ContractConfig` whose `source.load` reads the file or directory, parses each file with `parse()`, runs the Prisma 7 interpreter, and returns `ok(contract)` or `notOk({ summary, diagnostics })`.
- **Config**: `defineConfig` in `packages/3-extensions/postgres/src/config/define-config.ts` accepts `contract: string | ContractConfig`. `prisma7Schema` is re-exported from `@prisma/orm-postgres/config`.
- **Relation pairing** reuses `indexFkRelations` and `applyBackrelationCandidates` from `contract-psl/src/psl-relation-resolution.ts`, after replacing the `FieldSymbol` field on `ModelBackrelationCandidate` with a structural `{ name, optional, span }`.
- **Provider check**: the `datasource` block's `provider` must be `postgresql` (or `postgres`); anything else is `PRISMA7_PROVIDER_MISMATCH`. `relationMode = "prisma"` is `PRISMA7_RELATION_MODE_UNSUPPORTED`.

## Rule table

### Blocks

| Prisma 7 | Rule |
|---|---|
| `datasource` | Provider check above. `url` and everything else ignored. |
| `generator` | Ignored. |
| `model` | Model. Model key is the Prisma 7 model name verbatim. |
| `enum` | Postgres native enum type. Type name is the enum's `@@map` or its name verbatim. Members in declared order; each member's storage value is its `@map` or its name. Fields typed by the enum use the native enum codec. |
| `view` | `PRISMA7_VIEW_UNSUPPORTED`. |
| `@@schema("s")` | The model's namespace is `s`. Without multiSchema, every model is in `public`. |
| `@@ignore` | Model omitted from the contract. Relation fields on other models that point at it are omitted too. Prisma 7 still creates the table, its columns, and its foreign keys (verified in `reference/migration.sql`), so this relies on lenient `db verify` tolerating extra schema; verification item 7 pins that. |

### Naming

Table name is `@@map` or the model name verbatim. Column name is `@map` or the field name verbatim. The interpreter sets storage names directly, so Prisma 8's lower-first derivation never runs.

### Field types

Plain scalars map to Prisma 7's Postgres storage: `String` text, `Boolean` bool, `Int` int4, `BigInt` int8, `Float` float8, `Decimal` numeric(65,30), `DateTime` timestamp(3), `Json` jsonb, `Bytes` bytea. `@db.X(args)` overrides with the Prisma 7 native type table (verification item 6; a test pins every row). A `@db.*` type written without arguments gets the column Prisma 7 creates for it: `@db.Char` is `CHAR`, which Postgres stores as `character(1)`, so it lowers to length 1; `VarChar`, `Decimal`, `Timestamp`, `Timestamptz`, `Time`, and `Timetz` take no type parameters (fixture `native-types-without-arguments`, verified live against Prisma 7.10.0's SQL). Lists are array types and their columns are nullable, because Prisma 7 emits `Type[]` columns without `NOT NULL` (see `reference/migration.sql`). `Unsupported("...")` is `PRISMA7_UNSUPPORTED_TYPE`. Native types with no Prisma 8 codec (`Money`, `Bit`, `VarBit`, `Xml`, `Oid`, `Citext`, and any other unmapped type) are `PRISMA7_NATIVE_TYPE_UNSUPPORTED`.

### Defaults

| Prisma 7 | Rule |
|---|---|
| `autoincrement()` | Column default matching Prisma 7's sequence default (verification item 1). |
| `now()` | Column default (verification item 2). |
| literal, list literal, enum member | Column default. |
| `dbgenerated("expr")` | Raw expression column default. |
| `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid(n)` | ORM-side execution generator, no column default. On optional fields: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`. |
| `cuid()`, `cuid(2)` | ORM-side `cuid2` generator. |
| `@updatedAt` | Execution generator on create and update, column codec `pg/timestamp-temporal@1` with `typeParams.precision = 3` (item 2 showed the precision must be a type parameter), or the `@db.*` override, no storage default. On an optional field: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`. With any `@default`: `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`. Both because Prisma 8 PSL cannot spell the combination, so the converter could not print it (decision recorded in `design-notes.md`). |

### Keys, uniques, indexes

`@id`, `@@id`, `@unique`, `@@unique`, `@@index` map directly. Prisma 7 creates `@unique` and `@@unique` as unique **indexes** named `{table}_{cols}_key`, not unique constraints (dispatch 6 saw `unique:*` findings when they were lowered as constraints), so they lower to unique indexes with those names. Plain index names are the `map` argument if given, else `{table}_{col1}_{col2}_idx`. Both patterns use the mapped column names when a field has `@map` (derived from Prisma 7's naming rule; proven by the `supported` fixture once it carries an index over a mapped column, dispatch 5 round 2). Index `type:` maps to Prisma 8's index type. Sort order and length arguments map where Prisma 8 has them; otherwise `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`.

### Relations

Explicit relations map directly, keeping relation names. `onDelete` defaults to `Restrict` for required and `SetNull` for optional relations; `onUpdate` defaults to `Cascade`. Both are always set explicitly.

Implicit many-to-many (a list field on both sides, no junction model) becomes the junction model Prisma 7 creates: table `_AToB` with `A` and `B` the model names in alphabetical order, or `_RelationName` when the relation is named; columns `A` and `B` typed as the two ids; primary key `(A, B)`; index `_AToB_B_index` on `B`; two foreign keys with `Cascade` on both actions; two back-relation list fields. The junction model's key is `AToB`. Prisma 6.0.0 introduced the primary key (item 4, resolved); databases last migrated on Prisma 5 or earlier still carry `_AB_unique` and must be migrated on Prisma 7 first. The docs say so.

`@ignore` fields are omitted. Relation fields whose scalar was ignored are omitted too.

## Error catalogue

`PRISMA7_PROVIDER_MISMATCH`, `PRISMA7_RELATION_MODE_UNSUPPORTED`, `PRISMA7_VIEW_UNSUPPORTED`, `PRISMA7_UNSUPPORTED_TYPE`, `PRISMA7_NATIVE_TYPE_UNSUPPORTED`, `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`, `PRISMA7_UNKNOWN_ATTRIBUTE`, `PRISMA7_UNKNOWN_DEFAULT`, `PRISMA7_RELATION_UNRESOLVED`, `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`, `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` (dispatch 5, option (a); ORM-side generators such as `uuid()` on an optional field also use the first), `PRISMA7_TABLE_COLLISION` (added in dispatch 7: two models map to the same table), `PRISMA7_JUNCTION_ID_UNSUPPORTED` (added in dispatch 6: an implicit many-to-many whose side has a composite id), `PRISMA7_ENUM_NAMESPACE_MISMATCH` (added in dispatch 4: a column may only use an enum type from its own schema, which is what the IR can express). Each has a fixture. The implementer may add codes; every added code needs a fixture and a line here.

Added in dispatch 6: `PRISMA7_JUNCTION_ID_UNSUPPORTED` (an implicit many-to-many relation on a model without a single-field `@id`, which Prisma 7 forbids too; fixture `junction-composite-id`). `PRISMA7_SCHEMA_READ_FAILED` (dispatch 4) reports an unreadable input path.

## Edge cases

| Case | Disposition |
|---|---|
| A model `@@map`ped to the same table as another | `PRISMA7_TABLE_COLLISION`, both spans. |
| Enum inside a `@@schema` namespace | Prisma 7 creates the type in that schema (`CREATE TYPE "audit"."AuditAction"`); the native enum entity is placed in the same namespace. |
| `@default(ENUM_MEMBER)` on a native enum field | Column default with the member's storage value. Test pins it. |
| `@db.Timestamptz(n)` with `@updatedAt` | Generators as above, column `timestamptz(n)`. |
| Self-referential implicit many-to-many | Junction `_RelationName` is required by Prisma 7; use it. Column `A` belongs to the side with the smaller model name, or for a self relation the smaller field name by plain string comparison, per prisma-engines `psl/parser-database/src/relations.rs` (`ingest_relation`). Pinned by `test/junction-sides.test.ts`. |
| Multi-file directory with a `datasource` in one file | The provider check runs once across the merged document. |
| `previewFeatures` other than `multiSchema` | Ignored. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every rule row and every error code has a fixture under the package's `test/fixtures/` that runs through `parse()` and the interpreter.
- [ ] Verification items 1, 2, 3, 4, 6, and 7 each have a test or a quoted fixture committed before the dependent rule.
- [ ] End-to-end proof: a fixture `schema.prisma` and the `migration.sql` Prisma 7 generated for it (README says how), applied with `pg` against `withDevDatabase`, then `contract emit`, `db sign`, `db verify` with zero findings. Covers: every scalar, `@db.*` overrides, native enum, implicit many-to-many, `@updatedAt`, multiSchema.
- [ ] `architecture.config.json` lists the new package; `pnpm lint:deps` clean.
- [ ] No dependency on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, `@prisma/prisma-schema-wasm`.
- [ ] `packages/3-extensions/postgres` config reference documents `prisma7Schema`.

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
- **Provider check**: the `datasource` block's `provider` must be `postgresql` (or `postgres`); anything else is `PRISMA7_PROVIDER_MISMATCH`. `relationMode = "prisma"` is `PRISMA7_RELATION_MODE_UNSUPPORTED`, and so is the older `referentialIntegrity = "prisma"`, which Prisma 7.10.0 still accepts with a deprecation warning and treats the same way: it creates no foreign keys (fixture `referential-integrity`).

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
| `DateTime` string literal | Raw expression column default holding the text of the default Postgres stores, not the text Prisma 7 writes (`'2024-01-02 03:04:05 +02:00'`): the written date on `date`, the written wall-clock time without the offset on `timestamp` and `time`, the time with the written offset on `timetz` (`'03:04:05+02'`), and the instant in UTC on `timestamptz` (`'2024-01-02 01:04:05+00'`). Fractional seconds are rounded to microseconds half to even; the column's precision does not change a stored default. `test/temporal-literals.test.ts` pins 20 written values against the text Postgres printed for each type, and fixture `datetime-defaults` verifies live with zero findings against Prisma 7.10.0's SQL. |
| `Bytes[]` or `DateTime[]` list literal | Raw expression column default: an `ARRAY[...]` of the element literals Postgres stores, cast to the column type, for example `ARRAY['\x68656c6c6f']::BYTEA[]` and `ARRAY['2024-01-01 00:00:00']::TIMESTAMP(3)[]`, where Prisma 7 writes `ARRAY['2024-01-01 00:00:00 +00:00']::TIMESTAMP(3)[]`. Postgres reads each element for the column type, so a `DateTime` element carries the same stored text as a scalar default; verify compares list elements as text, so the written text would not match. Fixture `list-defaults`. The live proof depends on the Postgres default reader understanding `'...'::timestamp(3) without time zone` elements. |
| `Json` literal `"null"`, top level or as a list element | `PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED`, on required and optional fields: Prisma 7 writes `DEFAULT 'null'`, the JSON value null, and a contract literal `null` cannot be told apart from SQL `NULL`. The message says removing the default or giving another JSON value changes the column default on Prisma 7's next migration. A `null` nested inside an object or array is an ordinary JSON default. Fixture `json-null-default`. |
| `dbgenerated("expr")` | Raw expression column default. |
| `dbgenerated()` with no expression | `PRISMA7_UNKNOWN_DEFAULT`, saying the form is not supported yet. Prisma 7 creates no `DEFAULT` for it, and a contract without a default would make the ORM require the value on create. The message offers two edits: remove the `@default` (no database change, both clients then require the value) or write the expression, which Prisma 7's next migration sets as the column default. Fixture `dbgenerated-without-expression`. |
| `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid(n)` | ORM-side execution generator, no column default. On optional fields: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`, which prints the default as written and advises removing it and keeping the `?` (no database change; both clients stop filling the value). |
| `cuid()`, `cuid(2)` | ORM-side `cuid2` generator. |
| `@updatedAt` | Execution generator on create and update, column codec `pg/timestamp-temporal@1` with `typeParams.precision = 3` (item 2 showed the precision must be a type parameter), or the `@db.*` override, no storage default. On an optional field: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`, advising to remove `@updatedAt` and keep the `?` (no database change; both clients stop filling the value). With any `@default`: `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`, advising to remove the `@default` (Prisma 7's next migration drops the column default, `ALTER COLUMN ... DROP DEFAULT`). Dropping the `?` instead would declare the column `NOT NULL` against a nullable database column, which `db sign` reports. Each diagnostic points at the attribute its message says to remove; `test/integration/test/prisma7-source/generated-field-advice.integration.test.ts` removes exactly those attributes from `supported/schema.prisma` and verifies the result with zero findings against `supported/migration.sql`. Both because Prisma 8 PSL cannot spell the combination, so the converter could not print it (decision recorded in `design-notes.md`). |

### Keys, uniques, indexes

`@id`, `@@id`, `@unique`, `@@unique`, `@@index` map directly. Prisma 7 creates `@unique` and `@@unique` as unique **indexes** named `{table}_{cols}_key`, not unique constraints (dispatch 6 saw `unique:*` findings when they were lowered as constraints), so they lower to unique indexes with those names. Plain index names are the `map` argument if given, else `{table}_{col1}_{col2}_idx`. Both patterns use the mapped column names when a field has `@map` (derived from Prisma 7's naming rule; proven by the `supported` fixture once it carries an index over a mapped column, dispatch 5 round 2). Index `type:` maps to Prisma 8's index type. Sort order and length arguments map where Prisma 8 has them; otherwise `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`.

### Relations

Explicit relations map directly, keeping relation names. `onDelete` defaults to `Restrict` when any foreign key field is required and to `SetNull` only when every one is optional, so a composite key that mixes an optional and a required field gets `Restrict`, as Prisma 7.10.0 writes it; `onUpdate` defaults to `Cascade`. Both are always set explicitly. An explicit `SetNull` (`onDelete` or `onUpdate`) over a required foreign key field, or `SetDefault` over a required field with no column default, is `PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED` on the `@relation` attribute: Prisma 7.10.0 accepts both (with a warning for `SetNull`) and writes them into the foreign key, but the contract rejects them because the action would fail the first time it runs. The message offers making the fields optional or adding a default (`ALTER COLUMN ... DROP NOT NULL` or `SET DEFAULT` on Prisma 7's next migration) or another action (the next migration drops and re-adds the foreign key). Fixture `referential-action-not-null`. A relation field may be optional over fields that are all required, which Prisma 7 accepts without a warning: its foreign key and its relation are those of a required relation (the relation is not nullable, because the foreign key guarantees the related row). A required relation field over an optional field is `PRISMA7_RELATION_UNRESOLVED`, as Prisma 7 rejects it ("At least one of those fields is optional. Hence the relation field must be optional as well."). Fixtures `referential-action-defaults` (verified live against Prisma 7.10.0's SQL) and `relation-nullability`.

Implicit many-to-many (a list field on both sides, no junction model) becomes the junction model Prisma 7 creates: table `_AToB` with `A` and `B` the model names in alphabetical order, or `_RelationName` when the relation is named; columns `A` and `B` typed as the two ids; primary key `(A, B)`; index `_AToB_B_index` on `B`; two foreign keys with `Cascade` on both actions; two back-relation list fields. The junction model's key is `AToB`, or the relation name. A user model with that name (`PostToTag`, or `Favorites` next to `@relation("Favorites")`) is `PRISMA7_JUNCTION_NAME_COLLISION`, reported once on the first relation field of the pair and naming both: Prisma 7.10.0 accepts the schema and creates both tables, but the contract cannot hold two models under one key. The message says to rename the model and keep its table with `@@map`, which gives an empty Prisma 7 migration; the renamed schema verifies live with zero findings. Fixture `junction-name-collision`. Prisma 6.0.0 introduced the primary key (item 4, resolved); databases last migrated on Prisma 5 or earlier still carry `_AB_unique` and must be migrated on Prisma 7 first. The docs say so.

`@ignore` fields are omitted. A relation field marked `@ignore` is omitted with its foreign key, and so are the back-relation or implicit many-to-many partner that pairs with it; Prisma 7 still creates that foreign key or junction table, which lenient `db verify` tolerates (fixture `ignored-relation-back-relations`, verified live: zero lenient findings, and strict lists only those foreign keys and the junction). An `@ignore`d field that `@id`, `@unique`, `@@id`, `@@unique`, `@@index`, or the `fields:` of a relation field that is not itself ignored uses is `PRISMA7_IGNORED_FIELD_REFERENCED`, located at that attribute and naming the field: Prisma 7.10.0 accepts all these shapes and still creates the primary key, unique index, index, or foreign key over the column, so omitting the field would drop that constraint from the contract. The message says to remove `@ignore`, which gives an empty Prisma 7 migration. The back-relation of such a relation reports nothing of its own. Fixtures `ignored-field-in-key` and `ignored-field-in-relation`.

## Error catalogue

`PRISMA7_PROVIDER_MISMATCH`, `PRISMA7_RELATION_MODE_UNSUPPORTED`, `PRISMA7_VIEW_UNSUPPORTED`, `PRISMA7_UNSUPPORTED_TYPE`, `PRISMA7_NATIVE_TYPE_UNSUPPORTED`, `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`, `PRISMA7_UNKNOWN_ATTRIBUTE`, `PRISMA7_UNKNOWN_DEFAULT`, `PRISMA7_RELATION_UNRESOLVED`, `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`, `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` (dispatch 5, option (a); ORM-side generators such as `uuid()` on an optional field also use the first), `PRISMA7_TABLE_COLLISION` (added in dispatch 7: two models map to the same table), `PRISMA7_JUNCTION_ID_UNSUPPORTED` (added in dispatch 6: an implicit many-to-many whose side has a composite id), `PRISMA7_ENUM_NAMESPACE_MISMATCH` (added in dispatch 4: a column may only use an enum type from its own schema, which is what the IR can express), `PRISMA7_IGNORED_FIELD_REFERENCED` (an `@ignore`d field that a key, an index, or a relation uses; see Relations), `PRISMA7_JUNCTION_NAME_COLLISION` (a model named like an implicit junction model; see Relations), `PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED` (`SetNull` or `SetDefault` a required foreign key field cannot take; see Relations), `PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED` (a JSON `null` default; see Defaults), `PRISMA7_CONTRACT_INVALID` (the backstop: `load` catches a structured error thrown while the contract is built, and runs the checks `contract emit` runs afterwards that the builder does not, domain validation, storage consistency, and model storage references; any failure is this diagnostic at the input path, so no user schema makes `load` throw; the structural check is left to `contract emit` because it needs the target's entity kinds). Each has a fixture. The implementer may add codes; every added code needs a fixture and a line here.

Every edit a message offers is a Prisma 7 schema change that Prisma 7's next migration applies, so the message says what that migration does, checked with `prisma@7.10.0 migrate diff`. `PRISMA7_UNSUPPORTED_TYPE` for `Unsupported(...)` offers no edit: Prisma 7 rejects `@ignore` on such a field ("Fields of type `Unsupported` cannot take an `@ignore` attribute"), and removing the field drops its column, so the message says a model with that field cannot use this source yet. `PRISMA7_NATIVE_TYPE_UNSUPPORTED` offers `@ignore` first (an empty migration) and a type change second (`ALTER COLUMN ... SET DATA TYPE`). `PRISMA7_RELATION_MODE_UNSUPPORTED` says removing `relationMode` or setting `"foreignKeys"` makes the next migration add the foreign keys (`ADD CONSTRAINT ... FOREIGN KEY`), which fails on any row that breaks one.

The shared pairing helper reports its own `PSL_` codes; the interpreter lists the six it maps (`RELATION_PAIRING_CODES` in `relations.ts`) and reports each as `PRISMA7_RELATION_UNRESOLVED`. `test/relation-pairing-codes.test.ts` drives every diagnostic branch of the helper and fails if it emits a code outside that list, so a rename in `contract-psl` cannot leak a `PSL_` code.

Added in dispatch 6: `PRISMA7_JUNCTION_ID_UNSUPPORTED` (an implicit many-to-many relation on a model without a single-field `@id`, which Prisma 7 forbids too; fixture `junction-composite-id`). `PRISMA7_SCHEMA_READ_FAILED` (dispatch 4) reports an unreadable input path, or a schema directory that holds no `.prisma` file, located at the input path (`test/provider.test.ts`).

## Edge cases

| Case | Disposition |
|---|---|
| A model `@@map`ped to the same table as another | `PRISMA7_TABLE_COLLISION`, both spans. |
| A model named like an implicit junction model (`PostToTag`, `Favorites`) | `PRISMA7_JUNCTION_NAME_COLLISION` on the relation field; rename the model and keep its table with `@@map`. |
| Enum inside a `@@schema` namespace | Prisma 7 creates the type in that schema (`CREATE TYPE "audit"."AuditAction"`); the native enum entity is placed in the same namespace. |
| `@default(ENUM_MEMBER)` on a native enum field | Column default with the member's storage value. Test pins it. |
| `@db.Timestamptz(n)` with `@updatedAt` | Generators as above, column `timestamptz(n)`. |
| Self-referential implicit many-to-many | Junction `_RelationName` is required by Prisma 7; use it. Column `A` belongs to the side with the smaller model name, or for a self relation the smaller field name by plain string comparison, per prisma-engines `psl/parser-database/src/relations.rs` (`ingest_relation`). Pinned by `test/junction-sides.test.ts`. |
| Multi-file directory with a `datasource` in one file | The provider check runs once across the merged document. |
| A schema directory with a subdirectory named `x.prisma`, or with `.prisma` files and directories reached through symbolic links | Only regular files are read, following symbolic links; the subdirectory is skipped, as Prisma 7.10.0 skips it. Pinned by `test/provider.test.ts`. |
| An empty schema directory | `PRISMA7_SCHEMA_READ_FAILED` located at the input path; Prisma 7.10.0 itself panics (`psl::validate_multi_file() must be called with at least one file`). |
| `previewFeatures` other than `multiSchema` | Ignored. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every rule row and every error code has a fixture under the package's `test/fixtures/` that runs through `parse()` and the interpreter.
- [ ] Verification items 1, 2, 3, 4, 6, and 7 each have a test or a quoted fixture committed before the dependent rule.
- [ ] End-to-end proof: a fixture `schema.prisma` and the `migration.sql` Prisma 7 generated for it (README says how), applied with `pg` against `withDevDatabase`, then `contract emit`, `db sign`, `db verify` with zero findings. Covers: every scalar, `@db.*` overrides, native enum, implicit many-to-many, `@updatedAt`, multiSchema.
- [ ] `architecture.config.json` lists the new package; `pnpm lint:deps` clean.
- [ ] No dependency on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, `@prisma/prisma-schema-wasm`.
- [ ] `packages/3-extensions/postgres` config reference documents `prisma7Schema`.

# @internal/sql-contract-prisma7

Reads a Prisma 7 `schema.prisma` as a Prisma 8 contract source for the SQL family. During the side-by-side period Prisma 7 keeps owning the database and its migrations; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma7Schema(path, options)` returns a `ContractConfig` (format `prisma7`) whose `source.load` reads the input, parses every `.prisma` file with `@internal/psl-parser`, and runs the Prisma 7 interpreter. A file input reads that file; a directory input reads every `.prisma` file under it, nested directories included, sorted by path, as Prisma 7 reads a schema directory. The default `output` is `contract.json` in the directory that holds the file or the directory, never inside the directory and never named after the file; `options.output` overrides it.
- The interpreter turns the Prisma 7 dialect into a validated SQL contract using the same lowering helpers as `@internal/sql-contract-psl`: models, columns, native types, namespaces (`@@schema`), and native enums. Every construct it does not support is a diagnostic with a span; nothing is changed silently.
- `src/native-types.ts` holds only the mapping mechanism. The table of what Prisma 7 creates for each scalar and `@db.*` type is target knowledge: the Postgres one is `prisma7PostgresTypeMap` in `@internal/target-postgres/prisma7-type-map`, derived from what `prisma@7.10.0` creates for the reference schema in `test/integration/test/fixtures/prisma7-source/reference/`, and the facade passes it in as `typeMap`.

## Usage

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

The package itself is target-neutral: the Postgres facade supplies the target pack, the namespace factory, the type map, and the names of the native enum entity kind and type constructor.

## Rule table, in short

| Prisma 7 | Contract |
|---|---|
| `model` | Model named verbatim; table is `@@map` or the name; column is `@map` or the field name. |
| `enum` | Native enum type named by `@@map` or the enum name, members in order, each member's value its `@map` or its name; placed in the enum's `@@schema`. |
| `@@schema("s")` | Namespace `s`; without it, the target's default namespace. |
| Scalars and `@db.*` | The target's type map (`typeMap`), for example `DateTime` to `timestamp(3)` and `Json` to `jsonb`; lists are nullable array columns with no derived element check. |
| `@default(...)` | Column defaults through the target's default function registry, literals, list literals, enum members; `uuid`, `ulid`, `nanoid`, `cuid` are execution generators (`cuid` maps to `cuid2`). |
| `@updatedAt` | The "now" generator the target picks for the column's codec (Postgres: `plainDateTimeNow` for `timestamp`, `instantNow` for `@db.Timestamptz`) on create and update, no column default. |
| `@id`, `@@id` | Primary key. |
| `@unique`, `@@unique`, `@@index` | Indexes named `{table}_{columns}_key` and `{table}_{columns}_idx` cut to 63 bytes as Prisma 7 cuts them, `map` overriding, `type` mapped. |
| Explicit relations | Foreign keys with `onDelete` `restrict` (required) or `setNull` (optional) and `onUpdate` `cascade` unless given; paired through `@internal/sql-contract-psl/resolution`. |
| Implicit many-to-many | Junction `_AToB` or `_Name`: columns `A` and `B`, primary key `(A, B)`, index `_AToB_B_index`, cascading foreign keys. |
| `@ignore`, `@@ignore` | Omitted, together with relations over them. |
| `view`, `Unsupported(...)`, unmapped `@db.*`, `relationMode = "prisma"`, generators on optional fields, `@updatedAt` with `@default`, index arguments | Hard errors (table below). |

## Diagnostics

Codes are prefixed `PRISMA7_`:

| Code | Meaning |
|---|---|
| `PRISMA7_PROVIDER_MISMATCH` | No `datasource` block, or its `provider` is not `postgresql` / `postgres`. |
| `PRISMA7_RELATION_MODE_UNSUPPORTED` | `relationMode = "prisma"`. |
| `PRISMA7_VIEW_UNSUPPORTED` | A `view` block. |
| `PRISMA7_UNSUPPORTED_TYPE` | `Unsupported("...")` or an unknown field type. |
| `PRISMA7_NATIVE_TYPE_UNSUPPORTED` | A `@db.*` type with no Prisma 8 codec (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, or any unknown spelling). |
| `PRISMA7_ENUM_NAMESPACE_MISMATCH` | A field uses an enum declared in a different `@@schema`; a Postgres enum type lives in one schema and Prisma 8 columns reference the enum of their own namespace. |
| `PRISMA7_RELATION_UNRESOLVED` | A relation field that cannot be paired: no matching side, an ambiguous unnamed pair, a singular back-relation over a non-unique foreign key, a `fields`/`references` mismatch, or a relation whose optionality disagrees with its foreign key fields. |
| `PRISMA7_JUNCTION_ID_UNSUPPORTED` | An implicit many-to-many relation on a model without a single-field `@id` (a composite id, for example). Prisma 7 forbids it too. |
| `PRISMA7_UNKNOWN_ATTRIBUTE` | An attribute Prisma 7 for Postgres does not have, or one this source does not read (`@@fulltext`, `@shardKey`, ...). |
| `PRISMA7_TABLE_COLLISION` | Two models map to the same table in the same schema; reported on every model in the group. |
| `PRISMA7_UNKNOWN_DEFAULT` | A `@default` value this source cannot read: an unknown function, an enum member on a non-enum field, a non-member, a non-integer `BigInt` literal, a malformed JSON or base64 literal, or `dbgenerated()` with no expression, which is not supported yet. |
| `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` | An ORM-side generator or `@updatedAt` on an optional field. |
| `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` | `@updatedAt` combined with `@default`. |
| `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` | An index argument Prisma 8 cannot carry (`sort`, `length`, `ops`, an unknown type) or a field that is not a column. |
| `PRISMA7_SCHEMA_READ_FAILED` | The input path could not be read. |

Unknown top-level blocks keep the parser's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` code.

## Relations

Explicit relations keep their fields, references, and actions; an omitted `onDelete` becomes `Restrict` when every foreign key field is required and `SetNull` when one is optional, an omitted `onUpdate` becomes `Cascade`, and both are always written. `map` is ignored because foreign key names are not verified. One-to-one is recognised by `@unique` on the foreign key fields. An implicit many-to-many relation (a list field on both sides) becomes the junction Prisma 7 creates: model `AToB` (models in alphabetical order, or the relation name), table `_AToB`, columns `A` and `B` typed like the two ids, primary key `(A, B)`, index `_AToB_B_index`, two cascading foreign keys, and relation fields `a` and `b`. `A` is the model with the smaller name in plain string order; for a self-relation, the field with the smaller name, which is prisma-engines' own rule (`psl/parser-database/src/relations.rs`, `ingest_relation`). A relation over an `@ignore`d field or to an `@@ignore`d model is omitted on both sides. Pairing reuses `@internal/sql-contract-psl/resolution`.

`@id`, `@@id`, `@unique`, and `@@unique` are read because relations depend on them (one-to-one detection, junction column types) and become the primary key and unique constraints.

## Defaults, generators, `@updatedAt`, and indexes

`@default(autoincrement())` and `@default(now())` become column defaults through the target's default function registry (`context.controlMutationDefaults`), as do `dbgenerated("expr")` (a raw expression) and the ORM-side generators `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid()`, `nanoid(n)`, `cuid()`, and `cuid(2)`, which become execution generators on create with no column default; `cuid()` maps to `cuid2` by decision. Literals of every scalar, list literals, and enum members (the member's mapped storage value) become literal defaults; `BigInt` literals keep their exact text (a non-integer such as `1.5` is `PRISMA7_UNKNOWN_DEFAULT`, as Prisma 7 rejects it), `Json` literals are parsed, and `Bytes` and `DateTime` literals are carried as the SQL literal Prisma 7 writes. `@updatedAt` becomes an ORM-side "now" generator on create and update with no column default; the target picks the generator from the column's codec (`updatedAt.generatorIdFor`), so a zoneless `timestamp(3)` column receives a UTC `Temporal.PlainDateTime` and a `@db.Timestamptz` column a `Temporal.Instant`. List columns decline the element-not-null check Prisma 8 would otherwise derive, because Prisma 7 creates none.

By decision (option (a)), a generator or `@updatedAt` on an optional field is `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` and `@updatedAt` combined with `@default` is `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`; Prisma 8 cannot spell either yet.

`@unique` and `@@unique` become unique indexes named `{table}_{columns}_key` and `@@index` becomes an index named `{table}_{columns}_idx`, `map` overriding either (`name` on `@@unique` is the client-side name and is ignored). A generated name is cut the way Prisma 7 cuts it to fit PostgreSQL's 63-byte identifier limit: the `{table}_{columns}` part is shortened to 63 bytes minus the suffix, on a character boundary, and the suffix stays whole (`AVeryLongModelNameThatKeepsGoingAndGoingForever_aVeryLongCo_idx`). The same rule cuts an implicit junction's table name (no suffix) and its `_B_index`. `db verify` compares indexes by name, so the contract must carry the name Prisma 7 created. `type: Hash` and the other Prisma 8 index types map through; field arguments such as `sort` and `length`, and `ops`, are `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` because Prisma 8 indexes carry none.

## Multi-file input

A directory input is read file by file in sorted path order, nested directories included, and a diagnostic names a nested file by its path under the directory (`prisma/schema/models/user.prisma`); the datasource check runs once over all of them. A model or enum declared in more than one file is `PSL_DUPLICATE_DECLARATION` on the later file, the same code the parser's symbol table uses for a duplicate within one file.

## Tests

`test/fixtures/<case>/schema.prisma` with either `expected-contract.json` or `expected-diagnostics.json`; `test/fixtures.test.ts` runs every case through the real Postgres pack. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change.

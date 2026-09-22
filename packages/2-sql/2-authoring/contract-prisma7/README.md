# @internal/sql-contract-prisma7

Reads a Prisma 7 `schema.prisma` as a Prisma 8 contract source for the SQL family. During the side-by-side period Prisma 7 keeps owning the database and its migrations; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma7Contract(path, options)` returns a `ContractConfig` (format `prisma7`) whose `source.load` reads the input, parses every `.prisma` file with `@internal/psl-parser`, and runs the Prisma 7 interpreter. A file input reads that file; a directory input reads every regular `.prisma` file under it, nested directories and symbolic links included, sorted by path, as Prisma 7 reads a schema directory. The default `output` is `contract.json` in the directory that holds the file or the directory, never inside the directory and never named after the file; `options.output` overrides it.
- The interpreter turns the Prisma 7 dialect into a validated SQL contract using the same lowering helpers as `@internal/sql-contract-psl`: models, columns, native types, namespaces (`@@schema`), and native enums. Every construct it does not support is a diagnostic with a span; nothing is changed silently.
- `Prisma7TargetBinding` (`src/target-binding.ts`) declares everything a target supplies to the interpreter: the target pack and namespace factory, the datasource providers it reads, the type map, the native enum names, the index types, the identifier byte limit, the `@updatedAt` generator for each codec, and how literal defaults are read for columns whose codec does not take the written value. The Postgres binding is `prisma7PostgresBinding` in `@internal/target-postgres/prisma7-binding`; its type map is derived from what `prisma@7.10.0` creates for the reference schema in `test/integration/test/fixtures/prisma7-source/reference/`.

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

The package itself is target-neutral: everything specific to a database comes from the target binding, which the Postgres facade passes in.

## Rule table, in short

| Prisma 7 | Contract |
|---|---|
| `model` | Model named verbatim; table is `@@map` or the name; column is `@map` or the field name. |
| `enum` | Native enum type named by `@@map` or the enum name, members in order, each member's value its `@map` or its name; placed in the enum's `@@schema`. |
| `@@schema("s")` | Namespace `s`; without it, the target's default namespace. |
| Scalars and `@db.*` | The target binding's type map (`typeMap`), for example `DateTime` to `timestamp(3)` and `Json` to `jsonb`; lists are nullable array columns with no derived element check. |
| `@default(...)` | Column defaults through the target's default function registry, literals, list literals, enum members; `uuid`, `ulid`, `nanoid`, `cuid` are execution generators (`cuid` maps to `cuid2`); `dbgenerated("<sql>")` is a raw SQL default and `dbgenerated()` means no column default. |
| `@updatedAt` | The "now" generator the target picks for the column's codec (Postgres: `plainDateTimeNow` for `timestamp`, `instantNow` for `@db.Timestamptz`) on create and update, no column default. A codec with no generator (Postgres: `@db.Date`, `@db.Time`, `@db.Timetz`) is an error. |
| `@id`, `@@id` | Primary key. |
| `@unique`, `@@unique`, `@@index` | Indexes named `{table}_{columns}_key` and `{table}_{columns}_idx` cut to 63 bytes as Prisma 7 cuts them, `map` overriding, `type` mapped. |
| Explicit relations | Foreign keys with `onDelete` `restrict` (any foreign key field required) or `setNull` (every field optional) and `onUpdate` `cascade` unless given; paired through `@internal/sql-contract-psl/resolution`. |
| Implicit many-to-many | Junction `_AToB` or `_Name`: columns `A` and `B`, primary key `(A, B)`, index `_AToB_B_index`, cascading foreign keys. |
| `@ignore`, `@@ignore` | Omitted, together with relations over them. An `@ignore`d field that a key, an index, or a relation uses is an error. |
| `view`, `Unsupported(...)`, unmapped `@db.*`, `relationMode = "prisma"`, generators on optional fields, `@updatedAt` with `@default` or on a column type with no generator, index arguments, an `@ignore`d field that a key, index, or relation uses, `SetNull` or `SetDefault` over a required field that cannot take it, a JSON `null` default, a model named like an implicit junction or mapped to its table, one relation name on implicit many-to-many relations between different models in the same schema | Hard errors (table below). |

## Diagnostics

Codes are prefixed `PSL.PRISMA7_`:

| Code | Meaning |
|---|---|
| `PSL.PRISMA7_PROVIDER_MISMATCH` | No `datasource` block, or its `provider` is not `postgresql` / `postgres`. |
| `PSL.PRISMA7_RELATION_MODE_UNSUPPORTED` | `relationMode = "prisma"`, or the older `referentialIntegrity = "prisma"`. |
| `PSL.PRISMA7_VIEW_UNSUPPORTED` | A `view` block. |
| `PSL.PRISMA7_UNSUPPORTED_TYPE` | `Unsupported("...")` or an unknown field type. |
| `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED` | A `@db.*` type with no Prisma 8 codec (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, or any unknown spelling). |
| `PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH` | A field uses an enum declared in a different `@@schema`; a Postgres enum type lives in one schema and Prisma 8 columns reference the enum of their own namespace. |
| `PSL.PRISMA7_RELATION_UNRESOLVED` | A relation field that cannot be paired: no matching side, an ambiguous unnamed pair, a singular back-relation over a non-unique foreign key, a `fields`/`references` mismatch, or a required relation field over an optional foreign key field. |
| `PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED` | `SetNull` on a relation over a required field, or `SetDefault` over a required field with no column default. |
| `PSL.PRISMA7_JUNCTION_ID_UNSUPPORTED` | An implicit many-to-many relation on a model without a single-field `@id` (a composite id, for example). Prisma 7 forbids it too. |
| `PSL.PRISMA7_JUNCTION_NAME_COLLISION` | A model in the same schema as an implicit many-to-many junction has the junction model's name (`PostToTag`, or the relation name). |
| `PSL.PRISMA7_RELATION_NAME_SHARED` | Two or more implicit many-to-many relations in the same schema use the same relation name; Prisma 7 creates one table for all of them, wired to only one. The same name in two schemas is fine: Prisma 7 creates a table in each. |
| `PSL.PRISMA7_UNKNOWN_ATTRIBUTE` | An attribute Prisma 7 for Postgres does not have, or one this source does not read (`@@fulltext`, `@shardKey`, ...). |
| `PSL.PRISMA7_TABLE_COLLISION` | Two models map to the same table in the same schema, reported on every model in the group; or a model maps to the table of an implicit many-to-many relation, reported on the model's `@@map` and on the relation field. |
| `PSL.PRISMA7_UNKNOWN_DEFAULT` | A `@default` value this source cannot read: an unknown function, an enum member on a non-enum field, a non-member, a non-integer `BigInt` literal, a malformed JSON or base64 literal, or a `dbgenerated(...)` argument list that is not a single positional string with text in it. |
| `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED` | A `Json` default of `"null"`, or a `Json[]` default holding it: the JSON value null cannot be told apart from SQL `NULL` in the contract. |
| `PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` | An ORM-side generator or `@updatedAt` on an optional field. |
| `PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` | `@updatedAt` combined with `@default`. |
| `PSL.PRISMA7_UPDATED_AT_TYPE_UNSUPPORTED` | `@updatedAt` on a column whose codec has no "now" generator in the target, such as `@db.Date`. |
| `PSL.PRISMA7_IGNORED_FIELD_REFERENCED` | An `@ignore`d field that `@id`, `@unique`, `@@id`, `@@unique`, `@@index`, or a relation's `fields:` uses; Prisma 7 still creates the primary key, index, or foreign key over its column. |
| `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` | An index argument Prisma 8 cannot carry (`sort`, `length`, `ops`, an unknown type) or a field that is not a column. |
| `PSL.PRISMA7_CONTRACT_INVALID` | A structured error (one with a dotted code, such as the contract builder's `CONTRACT.*` or a codec's `RUNTIME.*`) was thrown while `load` built the contract, or the contract failed the domain, storage consistency, or model storage reference check `load` runs afterwards. It is reported at the input path and asks the user to report the schema as a Prisma bug. Any other error thrown inside `load`, such as an `InternalError` or a `TypeError`, still throws: it is a bug in Prisma ORM, not a problem in the schema (ADR 245). |
| `PSL.PRISMA7_SCHEMA_READ_FAILED` | The input path could not be read, or a schema directory holds no `.prisma` file. |

Unknown top-level blocks keep the parser's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` code.

## Relations

Explicit relations keep their fields, references, and actions; an omitted `onDelete` becomes `Restrict` when any foreign key field is required and `SetNull` only when every one is optional, as Prisma 7 writes them; a relation field may be optional over required fields, and its foreign key and relation are then those of a required relation; an omitted `onUpdate` becomes `Cascade`, and both are always written. `map` is ignored because foreign key names are not verified. One-to-one is recognised by `@unique` on the foreign key fields. An implicit many-to-many relation (a list field on both sides) becomes the junction Prisma 7 creates: model `AToB` (models in alphabetical order, or the relation name), table `_AToB`, columns `A` and `B` typed like the two ids, primary key `(A, B)`, index `_AToB_B_index`, two cascading foreign keys, and two relation fields named as `contract infer` names the same table's foreign keys. The target binding supplies the names (`junctionRelationFieldNames`); the Postgres binding gets them by running infer's PSL construction on the junction table. Infer names `A` and then `B` twice: first after the referenced table in camelCase, against the column names, appending the referenced model name and then a number when the name is taken; then against the fields `a` and `b` the columns print as, appending the first free number from 2. So `_PostToTag` gets `post` and `tag`, a self relation over `User` gets `user` and `userUser`, and `_AToB` over models `A` and `B` gets `a2` and `b2`. `A` is the model with the smaller name in plain string order; for a self-relation, the field with the smaller name, which is prisma-engines' own rule (`psl/parser-database/src/relations.rs`, `ingest_relation`). A relation field marked `@ignore`, or one to an `@@ignore`d model, is omitted on both sides. A relation field that is not ignored but lists an `@ignore`d field in `fields:` is `PSL.PRISMA7_IGNORED_FIELD_REFERENCED`, because Prisma 7 still creates its foreign key. Pairing reuses `@internal/sql-contract-psl/resolution`.

`@id`, `@@id`, `@unique`, and `@@unique` are read because relations depend on them (one-to-one detection, junction column types). `@id` and `@@id` become the primary key. `@unique` and `@@unique` become unique indexes, not unique constraints, because that is what Prisma 7 creates, and `db verify` compares indexes by name.

## Defaults, generators, `@updatedAt`, and indexes

`@default(autoincrement())` and `@default(now())` become column defaults through the target's default function registry (`context.controlMutationDefaults`), as do the ORM-side generators `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid()`, `nanoid(n)`, `cuid()`, and `cuid(2)`, which become execution generators on create with no column default. `cuid()` maps to `cuid2` because Prisma 7's `cuid()` is cuid v1, which Prisma 8 does not ship; the column type is the same and the ids are opaque, so existing rows keep working beside new ones. `@default(dbgenerated("<sql>"))` becomes a raw SQL default carrying the string as written, without going through the registry; `@default(dbgenerated())` with no argument means the column has no default, on required, optional, and list fields alike. Literals of every scalar, list literals, and enum members (the member's mapped storage value) become literal defaults; a number literal is carried as the value the column codec reads: the number itself when the codec reads a JSON number, otherwise what the codec decodes from the literal exactly as written, so `Decimal` and `BigInt` defaults keep every digit and trailing zero (`"1.50"`, `"9007199254740993"`); a number with a fraction on an `Int` or `BigInt` field, or one the codec reads neither way, is `PSL.PRISMA7_UNKNOWN_DEFAULT`, as Prisma 7 rejects it, and the message says an `Int` or `BigInt` default must be a whole number; `Json` literals are parsed, and `Bytes` and `DateTime` literals are carried as the SQL literal of the default Postgres stores: hex for `Bytes`, and for a `DateTime` the written date on `date`, the written wall-clock time without its offset on `timestamp` and `time`, the time with its offset on `timetz`, and on `timestamptz` the instant in its UTC form, the text a session in UTC prints (`'2024-01-02 01:04:05+00'`, with `BC` before year 1), with fractional seconds rounded to microseconds. A `Bytes[]` or `DateTime[]` list default is an `ARRAY[...]` of those literals cast to the column type (`ARRAY['\x68656c6c6f']::BYTEA[]`). `@updatedAt` becomes an ORM-side "now" generator on create and update with no column default; the target binding picks the generator from the column's codec (`updatedAtGeneratorId`), so a zoneless `timestamp(3)` column receives a UTC `Temporal.PlainDateTime` and a `@db.Timestamptz` column a `Temporal.Instant`. List columns decline the element-not-null check Prisma 8 would otherwise derive, because Prisma 7 creates none.

A generator or `@updatedAt` on an optional field is `PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`, and `@updatedAt` combined with `@default` is `PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`, because the Prisma 8 contract cannot describe either yet.

`@unique` and `@@unique` become unique indexes named `{table}_{columns}_key` and `@@index` becomes an index named `{table}_{columns}_idx`, `map` overriding either (`name` on `@@unique` is the client-side name and is ignored). A generated name is cut the way Prisma 7 cuts it to fit PostgreSQL's 63-byte identifier limit: the `{table}_{columns}` part is shortened to 63 bytes minus the suffix, on a character boundary, and the suffix stays whole (`AVeryLongModelNameThatKeepsGoingAndGoingForever_aVeryLongCo_idx`). The same rule cuts an implicit junction's table name (no suffix) and its `_B_index`. `db verify` compares indexes by name, so the contract must carry the name Prisma 7 created. `type: Hash` and the other Prisma 8 index types map through; field arguments such as `sort` and `length`, and `ops`, are `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` because Prisma 8 indexes carry none.

## Multi-file input

A directory input is read file by file in sorted path order, nested directories included, and a diagnostic names a nested file by its path under the directory (`prisma/schema/models/user.prisma`); the datasource check runs once over all of them. A model or enum declared in more than one file is `PSL_DUPLICATE_DECLARATION` on the later file, the same code the parser's symbol table uses for a duplicate within one file.

## Tests

`test/fixtures/<case>/schema.prisma` with either `expected-contract.json` or `expected-diagnostics.json`; `test/fixtures.test.ts` runs every case through the real Postgres pack. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change.

# Convenience types for the other PostgreSQL scalars

Linear: TML-3715 (all types except `Json`), TML-3789 (`Json`).

## Summary

```prisma
model Account {
  id       Int     @id                               // exactly Int4
  visits   Int(storage: int2)                         // exactly Int2
  balance  BigInt                                     // exactly Int8BigInt
  rank     BigInt(as: number)                         // exactly Int8Number
  price    Decimal(precision: 10, scale: 2)           // exactly NumericString(10, 2)
  name     String                                     // exactly Text
  code     String(storage: varchar, length: 12)       // exactly Varchar(12)
  ratio    Float                                      // exactly Float8
  active   Boolean                                    // exactly Bool
  avatar   Bytes                                      // exactly Bytea
  settings Json                                       // exactly Jsonb
}
```

PostgreSQL gets convenience types for its other scalars, built the way ADR 279 built `DateTime`, `Date`, `Time` and `Duration`. Each convenience type is named for what a field means in the application: an integer, a decimal number, text. Its arguments choose one explicit type, named after the database type and, where that database type has more than one codec, the application value. The contract stores only the explicit type.

The names users already write (`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes`, `Json`) stay. They become convenience types. The explicit types they used to name get the database's names (`Int4`, `Int8BigInt`, `Float8`, `NumericString`, `Text`, `Bool`, `Bytea`).

## Why

ADR 257 names every explicit type after what the database stores, so a schema says exactly what each column is. ADR 279 adds a layer of names for application concepts on top, so a user can write what a field means and get a working default. A name such as `Int` should mean "an integer", not "a PostgreSQL `int4`". The codec maps the concept to one database type and one application value.

A survey of 16 data tools (`wip/survey/`, not committed) supports the list of concepts. Every tool that names concepts rather than column types has separate names for an integer and a big integer (SQLAlchemy `Integer` and `BigInteger`, Django `IntegerField` and `BigIntegerField`, Rails `:integer` and `:bigint`, Gel `int32` and `int64`, Prisma 7 `Int` and `BigInt`). Most default JSON to `jsonb` (Prisma 7, Django, Ecto, MikroORM, Hibernate, Gel). Drizzle (`mode: 'bigint'`), MikroORM (`new DecimalType('number')`) and SQLAlchemy (`asdecimal=False`) choose the application value with an option, as `as:` does.

## The convenience types

Every option is optional and has a default, so the bare name is a working type. An argument that is not an option is passed on to the explicit type the row names.

| Convenience type | `as` | `storage` | Becomes |
| --- | --- | --- | --- |
| `Int(storage?)` | | `int4` (default) | `Int4` |
| | | `int2` | `Int2` |
| `BigInt(as?, storage?)` | `bigint` (default) | `int8` (default) | `Int8BigInt` |
| | `number` | `int8` | `Int8Number` |
| | `bigint` | `numeric` | `NumericBigInt` |
| `Float(storage?)` | | `float8` (default) | `Float8` |
| | | `float4` | `Float4` |
| `Decimal(storage?, precision?, scale?)` | | `numeric` (default) | `NumericString` |
| `String(storage?, length?)` | | `text` (default) | `Text` |
| | | `varchar` | `Varchar` |
| | | `char` | `Char` |
| `Boolean(storage?)` | | `bool` (default) | `Bool` |
| `Bytes(storage?)` | | `bytea` (default) | `Bytea` |
| `Json(storage?)` | | `jsonb` (default) | `Jsonb` |
| | | `json` | the explicit `json` type (name open, see below) |

A type has an `as` option only where its database types have more than one codec. Today only `BigInt` does. Adding one later, such as a decimal library value for `Decimal`, adds an option and rows without renaming anything.

`Int` covers integers read as a JavaScript `number` within 32 bits. `BigInt` covers integers that may exceed 32 bits, as every surveyed tool does. `Int8Number` is reached only through `BigInt(as: number)`, so each explicit type has one convenience call.

Two consequences of the type-choice mechanism, which is not changed (it lives in the framework domain):

- An option's default does not depend on another option. `BigInt(as: number)` works because its default storage `int8` has a `number` row. `BigInt(storage: numeric, as: number)` is refused, because no row exists.
- An argument the chosen type does not take is refused. `String(length: 12)` chooses `Text`, which takes no length, so it is refused at `length`, with a message that says `Text`, the type `storage: text` chooses, takes no `length`. The user writes `String(storage: varchar, length: 12)`.

Types that already name one concept keep a single explicit name and get no convenience type: `Uuid`, `Inet`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, `citext.Citext` and `pg.enum(...)`.

## The explicit types after the renames

Names follow ADR 257's token rule and ADR 279's suffix rule: the database type, plus a suffix naming the application value when the database type has more than one codec. No codec id changes.

| Explicit type | Codec id | Database type | Application value | Name today |
| --- | --- | --- | --- | --- |
| `Int2` | `pg/int2@1` | `int2` | `number` | `SmallInt` |
| `Int4` | `pg/int4@1` | `int4` | `number` | `Int` |
| `Int8BigInt` | `pg/int8@1` | `int8` | `bigint` | `BigInt` |
| `Int8Number` | `pg/int8number@1` | `int8` | `number` (safe-integer range) | `BigIntNumber` |
| `NumericString(p?, s?)` | `pg/numeric@1` | `numeric` | `string` (decimal text) | `Numeric`, `Decimal` |
| `NumericBigInt` | `pg/unboundedint@1` | `numeric` | `bigint` | `UnboundedInt` |
| `Float4` | `pg/float4@1` | `float4` | `number` | `Real` |
| `Float8` | `pg/float8@1` | `float8` | `number` | `Float` |
| `Text` | `pg/text@1` | `text` | `string` | `String` |
| `Varchar(n?)` | `sql/varchar@1` | `character varying` | `string` | `VarChar` |
| `Char(n?)` | `sql/char@1` | `character` | `string` | `Char` |
| `Bool` | `pg/bool@1` | `bool` | `boolean` | `Boolean` |
| `Bytea` | `pg/bytea@1` | `bytea` | `Uint8Array` | `Bytes` |
| `Jsonb` | `pg/jsonb@1` | `jsonb` | `JsonValue` | `Jsonb` |
| open | `pg/json@1` | `json` | `JsonValue` | `Json` |

`sql.String(n)` and `sql.Char(n)` stay as they are.

An explicit name that disappears (`SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real`, `VarChar`) stays for one release line as a deprecated alias of its new name, under ADR 257's rule: `PSL_DEPRECATED_SCALAR_NAME` as a warning, the same codec, no contract change. The names that become convenience types need no alias. At their defaults they give the same codec as today, except `Json`, below.

## `Json` changes its default storage

`Json` today is the explicit type for a `json` column. As a convenience type it defaults to `jsonb`. A field written `Json` in an existing Prisma 8 schema therefore changes from `json` to `jsonb`: the contract changes, `db verify` reports the difference, and the migration planner plans the column change. The upgrade instruction tells users to write `Json(storage: json)` to keep a `json` column, or to re-emit and migrate. A Prisma 7 schema is not affected: Prisma 7's `Json` was already `jsonb`.

## Tools

The tools already handle type choices (ADR 279), so no tool code change is expected:

- `contract infer`, `contract print` and the Prisma 7 schema reader write the convenience call that gives a column's explicit type, with only the arguments that differ from the defaults: an `int2` column is `Int(storage: int2)`, `int8` is `BigInt`, `numeric(10,2)` is `Decimal(precision: 10, scale: 2)`, `varchar(12)` is `String(storage: varchar, length: 12)`, `json` is `Json(storage: json)`.
- For each database type, the explicit type marked `inferred` is the one the convenience default gives: `Int8BigInt` for `int8`, `NumericString` for `numeric`.
- The language server completes and explains the new types, and its hover names the explicit type a call becomes.
- In a TypeScript contract, `type.Int()`, `type.BigInt({ as: 'number' })` and so on are typed as the explicit type they choose.

Fixtures, examples and printer goldens that use these names are re-emitted; their `contract.json` files do not change, except for fields written `Json`.

## Scope

In scope: PostgreSQL. The type declarations in `packages/3-targets/postgres/1-target/src/core/type-constructors.ts` and `authoring.ts`, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the codec authoring guide and subsystem docs that list these names, the `prisma-8` skill references, the `app` and `extension` upgrade instructions, and ADR 316, which records the decision and amends ADR 279's "Not decided here".

Out of scope:

- **SQLite, MySQL and MongoDB.** Each uses some of these names for explicit types today. They get the same convenience types, over their own explicit types, in TML-3790.
- **The type-choice mechanism.** It is in the framework domain and does not change. The two limits above are accepted.
- **Convenience types for `Uuid`, `Inet` and the other single-concept types.**

## Open question

**The explicit name of PostgreSQL's `json` type.** The token rule gives `Json`, which the convenience type takes. ADR 279 solved the same clash for `date` with a value suffix, but `json` has one codec, so the suffix rule does not give a name. This needs a name from Will.

## Acceptance criteria

- [ ] Each row of the convenience table resolves to its explicit type, in PSL and in a TypeScript contract, and each refused combination named above is refused at its argument.
- [ ] A schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files, except fields written `Json`.
- [ ] `contract infer`, `contract print` and the Prisma 7 reader write the convenience calls listed under Tools, and the print round-trip tests pass.
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract.
- [ ] `docs/reference/scalar-types.md`, the new ADR and the upgrade instructions describe the final names, and `pnpm lint:deps` and the CI-only checks pass.

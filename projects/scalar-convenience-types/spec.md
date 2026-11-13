# Convenience types for the scalars that are not dates or times

Linear: TML-3715 (PostgreSQL, done), TML-3789 (PostgreSQL `Json`), TML-3790 (SQLite, MySQL and MongoDB).

## Summary

```prisma
// PostgreSQL
model Event {
  id      Int     @id            // exactly Int4
  name    String                 // exactly Text
  payload Json                   // exactly PlainJson: a json column
  fast    Json(storage: jsonb)   // exactly Jsonb: a jsonb column
}

// MongoDB
model Event {
  id      ObjectId @id @map("_id")
  visits  Int                    // exactly Int32
  total   BigInt(as: number)     // exactly Int64Number
  payload Json                   // a JSON value stored as BSON
}
```

`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` name what a field means in the application. On every target each is a convenience type: its `storage` and `as` arguments choose one explicit type, and the contract stores only that explicit type. An explicit type names one codec and is named after what stores it.

The mechanism is the type choice of ADR 279. It lives in the framework domain and does not change.

## State

| Part | State |
| --- | --- |
| PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` | Merged, prisma/orm#30942. Recorded in ADR 316. |
| PostgreSQL `Json` | To build. This spec. |
| SQLite, MySQL, MongoDB | To build. This spec. |

## Rules that hold on every target

These come from ADR 279, ADR 315 and ADR 316. They are listed here because every table below follows them.

1. A convenience name is a concept, not a representation. Its options are the same on every target; the values of `storage` and `as`, and the defaults, are each target's own.
2. Every convenience type has a `storage` option, even where a target has one storage for it. It has an `as` option only where some target reads the concept as more than one kind of value. Today only `BigInt` does.
3. A bare convenience name gives the codec that name gave before, so no existing schema or contract changes.
4. An explicit type is named after the database type that stores it, plus a suffix for the application value where that database type has more than one codec.
5. An explicit name that disappears stays for one release line as a deprecated alias that warns `PSL_DEPRECATED_SCALAR_NAME` and emits the same contract.
6. `contract infer`, `contract print` and the schema readers write the convenience call, with only the arguments that differ from the defaults.
7. A convenience type and an explicit type cannot share a name: a type choice row names its explicit type in the same namespace. So wherever a convenience name is also the name rule 4 would give the explicit type, the explicit type needs another name.

## PostgreSQL `Json`

| Convenience type | `storage` | Becomes | Codec | Column |
| --- | --- | --- | --- | --- |
| `Json(storage?)` | `json` (default) | `PlainJson` | `pg/json@1` | `json` |
| | `jsonb` | `Jsonb` | `pg/jsonb@1` | `jsonb` |

- **`Json` still means a `json` column.** `Json` is the exact name of a PostgreSQL type, so it must not mean a different one. A user who wants `jsonb` writes `Json(storage: jsonb)` or `Jsonb`.
- **No schema or contract changes.** A field written `Json` keeps codec `pg/json@1`. There is no migration and no upgrade step for PSL schemas.
- **`PlainJson` is the explicit name of the `json` type,** under rule 7. It is the one explicit name not derived from rule 4, and ADR 316 records it as that exception. Users meet it in hover text and in the type reference; the tools never write it.
- **Tools.** A `json` column is written `Json`. A `jsonb` column is written `Json(storage: jsonb)`, where the tools wrote `Jsonb` before. The Prisma 7 reader writes Prisma 7's `Json`, which was `jsonb`, as `Json(storage: jsonb)`, and `@db.Json` as `Json`.
- **TypeScript.** `type.Json()` and `type.Json({ storage: 'jsonb' })` are typed as the explicit type they choose. The column helper `jsonColumn` becomes `plainJsonColumn`, with no alias, as ADR 316 did for `int8Column`. That rename gets an upgrade instruction with a detection pattern.
- **Docs.** `docs/reference/scalar-types.md` and the `prisma-8` skill say what a `json` column cannot do (no equality filter, no index, no unique constraint) and that `Json(storage: jsonb)` can.

Out of scope here: clearer errors where a `json` field hits one of those limits. It gets its own ticket. An earlier warning for a bare `Json` (prisma/orm#30085) was rejected, so the ticket covers errors at the point of failure only.

## SQLite

SQLite's column types are `text`, `integer`, `real` and `blob`.

| Convenience type | `as` | `storage` | Becomes | Codec | Name today |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `integer` | `IntegerNumber` | `sqlite/integer@1` | `Int` |
| `BigInt(as?, storage?)` | `bigint` (default) | `integer` | `IntegerBigInt` | `sqlite/bigint@1` | `BigInt` |
| | `number` | `integer` | `IntegerSafeNumber` (open) | `sqlite/bigintnumber@1` | `BigIntNumber` |
| `Float(storage?)` | | `real` | `Real` | `sqlite/real@1` | `Float` |
| `Decimal(storage?)` | | `text` | `Text` | `sqlite/text@1` | `Decimal` |
| `String(storage?)` | | `text` | `Text` | `sqlite/text@1` | `String` |
| `Bytes(storage?)` | | `blob` | `Blob` | `sqlite/blob@1` | `Bytes` |
| `Json(storage?)` | | `text` | `PlainJson` (open) | `sqlite/json@1` | `Json` |

- `Decimal` and `String` are one codec today, so both become `Text`, and the tools write a `text` column as `String`. A decimal codec for SQLite is not part of this project.
- SQLite declares no `Boolean` today, so it gets none here. Adding a type is a separate change.
- `BigIntNumber` stays as a deprecated alias of its new name.

## MySQL

MySQL is a proof of concept with three scalars. It gets convenience types for those three only.

| Convenience type | `storage` | Becomes | Codec | Name today |
| --- | --- | --- | --- | --- |
| `Int(storage?)` | `int` | open | `mysql/int@1` | `Int` |
| `BigInt(as?, storage?)` | `bigint` | open | `mysql/bigint@1` | `BigInt` |
| `String(storage?, length?)` | `varchar` (default) | `Varchar`, length 191 unless written | `sql/varchar@1` | `String` |

MySQL's column types are named `int` and `bigint`, so rule 4 gives the explicit types the names the convenience types take. See the open questions.

## MongoDB

MongoDB's explicit types are already named after BSON types, so most rows only add the convenience type.

| Convenience type | `as` | `storage` | Becomes | Codec | Change |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int32` | `Int32` | `mongo/int32@1` | `Int` stops being a deprecated alias |
| `BigInt(as?, storage?)` | `bigint` (default) | `int64` | `Int64` | `mongo/int64@1` | new |
| | `number` | `int64` | `Int64Number` | `mongo/int64Number@1` | |
| `Float(storage?)` | | `double` | `Double` | `mongo/double@1` | `Float` stops being a deprecated alias |
| `Decimal(storage?)` | | `decimal128` | `Decimal128` | `mongo/decimal128@1` | new |
| `Boolean(storage?)` | | `bool` | `Bool` | `mongo/bool@1` | `Boolean` stops being a deprecated alias |
| `Bytes(storage?)` | | `binData` | `Binary` | `mongo/binary@1` | new |
| `String(storage?)` | | `string` | open | `mongo/string@1` | explicit `String` needs a name |
| `Json(storage?)` | | `bson` (open) | `PlainJson` (open) | `mongo/json@1` | explicit `Json` needs a name |

- **`Json` has one storage, BSON.** MongoDB stores a JSON value as native BSON values, which is its idiomatic form, so that is the default and the only value. A JSON string storage would need a new codec and is not part of this project.
- **`Int`, `Float` and `Boolean` stop warning.** Today they warn and point to `Int32`, `Double` and `Bool`. As convenience types they are the names a user is meant to write. Their codecs do not change.
- **`Int64` keeps its name.** Rule 4 would rename it `Int64BigInt`, because `int64` has two codecs. See the open questions.
- **The deprecation warning fires wherever a deprecated name is written,** as the SQL family's does: with or without arguments, in a field, a value object member or a `types {}` alias. Today MongoDB's fires only for a bare name in a field.
- The Prisma 6 schema reader keeps its bindings; it names codecs, not PSL names.

## The SQL family's `sql.String(n)` and `sql.Char(n)`

`sql.String(n)` is a `varchar(n)` column on every SQL target. It now shares a name with the `String` convenience type and means something else. It is renamed `sql.Varchar(n)`, and `sql.String` stays for one release line as a deprecated alias. `sql.Char(n)` keeps its name.

## Open questions for Will

Each is a name the rules do not give. I state what I would choose.

1. **The explicit JSON type on SQLite and MongoDB.** I would use `PlainJson` on every target: one name for "a JSON value and nothing else", already approved for PostgreSQL. On MongoDB it reads correctly beside `Bson`, which holds any BSON value.
2. **MongoDB's explicit string type.** The BSON type is `string`, so rule 4 gives `String`, which the convenience type takes. PostgreSQL and SQLite have `Text`, but BSON has no type of that name. I have no name to propose.
3. **MySQL's explicit `int` and `bigint` types.** Rule 4 gives `Int` and `BigInt`. MySQL accepts `int4` and `int8` as other names for the same column types, so `Int4` and `Int8BigInt` would match PostgreSQL. I would use those.
4. **SQLite's `integer` read as a `number` in the safe-integer range** (`sqlite/bigintnumber@1`). `sqlite/integer@1` also reads a `number`, so the suffix `Number` is taken. I wrote `IntegerSafeNumber`; I would like your name for it.
5. **MongoDB's `Int64`.** Rule 4 says `Int64BigInt`. I would leave `Int64` alone: it is the BSON type's name, it is in released schemas, and renaming it buys only consistency.
6. **The `storage` value for MongoDB's `Json`.** A JSON value is stored as several BSON types, so no single BSON type names it. I would use `bson`.

## Scope

In scope: the type declarations of the four targets, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the `prisma-8` skill references, upgrade instructions for every rename, and the ADRs: ADR 316 gains PostgreSQL `Json`, and a new ADR records the other targets' tables as ADR 315 did for the date and time types.

Also in scope, because main is wrong today: main has two ADRs numbered 316. The one from prisma/orm#30956 (an extension pack's extension is found through the search path) merged second and takes the next free number.

Out of scope:

- The type choice mechanism, and anything else under `packages/1-framework`.
- New codecs: a SQLite decimal or boolean, a MongoDB JSON string, MySQL's missing scalars.
- Convenience types for single-concept types such as `Uuid`, `ObjectId`, `Vector` and `Bson`.
- Clearer errors for `json` limits on PostgreSQL.

## Acceptance criteria

- [ ] On each target, each row of its table resolves to its explicit type in PSL and in a TypeScript contract.
- [ ] On each target, a schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files.
- [ ] `contract infer` and `contract print` write the convenience calls, and the print round-trip tests pass.
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract. MongoDB's `Int`, `Float` and `Boolean` no longer warn.
- [ ] Every rename a user must act on has an upgrade instruction with a detection pattern.
- [ ] `docs/reference/scalar-types.md` and the ADRs describe the final names.
- [ ] No file under `packages/1-framework` changes.

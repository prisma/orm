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
  payload Json                   // exactly PlainJson: a JSON value stored as BSON
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

SQLite's column types are `text`, `integer`, `real` and `blob`. An explicit type is the column type, plus the value it reads where the column type has more than one codec.

| Convenience type | `as` | `storage` | Becomes | Codec | Name today |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `integer` | `IntegerNumber` | `sqlite/integer@1` | `Int` |
| `BigInt(as?, storage?)` | `bigint` (default) | `integer` | `IntegerBigInt` | `sqlite/bigint@1` | `BigInt` |
| | `number` | `integer` | `IntegerNumber` | `sqlite/integer@1` | |
| `Float(storage?)` | | `real` | `Real` | `sqlite/real@1` | `Float` |
| `Decimal(storage?)` | | `text` | `DecimalString` | new, `sqlite/decimal@1` | `Decimal`, as `sqlite/text@1` |
| `String(storage?)` | | `text` | `Text` | `sqlite/text@1` | `String` |
| `Boolean(storage?)` | | `integer` | `IntegerBoolean` | new | none |
| `Bytes(storage?)` | | `blob` | `Blob` | `sqlite/blob@1` | `Bytes` |
| `Json(storage?)` | | `text` | `PlainJson` | `sqlite/json@1` | `Json` |

- **`Decimal` gets its own data type, `sqlite/decimal`, stored as text.** Today it is the same codec as `String`, so nothing in the contract says the column holds a decimal, and a new required `Decimal` field is filled with `''`. This is TML-3562, which this slice closes. It is the one place where rule 3 is broken: the contract of every SQLite project with a `Decimal` field changes, with an upgrade instruction. The stored text does not change, so no data moves.
- **`DecimalString` is named after its data type, not its column.** SQLite has no decimal column type, so the name follows ADR 315's rule for that case, as `DateString` and `DurationString` do. `TextString` would say nothing.
- **`Boolean` is new on SQLite,** stored as `integer` 0 or 1, which is what SQLite's own `TRUE` and `FALSE` are.
- **`BigInt(as: number)` and `Int` are the same explicit type.** `sqlite/integer@1` and `sqlite/bigintnumber@1` both store an `integer` and both read a `number` checked against the safe-integer range. `BigIntNumber` stays for one release line as a deprecated name with its own codec; its upgrade instruction says to write `Int`.

## MySQL

MySQL has codecs for `int`, `bigint`, `text` and `varchar` only. Every other row below needs a new codec, as the date and time project added MySQL's date and time codecs (ADR 315). The defaults are the columns Prisma 7 created for the same names; check them against Prisma 7's documentation before building.

MySQL's usual names for these columns are convenience names. MySQL accepts a second name for each, and those are the names PostgreSQL's explicit types already have, so MySQL uses the same explicit names.

| Convenience type | `as` | `storage` | Becomes | Column | MySQL also calls it | Codec |
| --- | --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int` | `Int4` | `int` | `INT4` | `mysql/int@1` |
| `BigInt(as?, storage?)` | `bigint` (default) | `bigint` | `Int8BigInt` | `bigint` | `INT8` | `mysql/bigint@1` |
| | `number` | `bigint` | `Int8Number` | `bigint` | `INT8` | new |
| `Float(storage?)` | | `double` (default) | `Float8` | `double` | `FLOAT8` | new |
| | | `float` | `Float4` | `float` | `FLOAT4` | new |
| `Decimal(storage?, precision?, scale?)` | | `decimal` | `NumericString` | `decimal(p,s)` | `NUMERIC` | new |
| `String(storage?, length?)` | | `varchar` (default) | `Varchar`, length 191 unless written | `varchar(n)` | | `sql/varchar@1` |
| | | `text` | `Text` | `text` | | `mysql/text@1` |
| `Boolean(storage?)` | | `tinyint` | `Bool` | `tinyint(1)` | `BOOL` | new |
| `Bytes(storage?)` | | `longblob` | `Longblob` | `longblob` | | new |
| `Json(storage?)` | | `json` | `PlainJson` | `json` | | new |

- MySQL's migration planner does not change a column's type yet, so changing a field between these types is refused by `migration plan`, as for the date and time types.

## MongoDB

MongoDB's explicit types are already named after BSON types, so most rows only add the convenience type. The `storage` values are BSON's own type names, as `storage: date` and `storage: string` already are for the date and time types.

| Convenience type | `as` | `storage` | Becomes | Codec | Change |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int` | `Int32` | `mongo/int32@1` | `Int` stops being a deprecated alias |
| `BigInt(as?, storage?)` | `bigint` (default) | `long` | `Int64BigInt` | `mongo/int64@1` | explicit `Int64` renamed |
| | `number` | `long` | `Int64Number` | `mongo/int64Number@1` | |
| `Float(storage?)` | | `double` | `Double` | `mongo/double@1` | `Float` stops being a deprecated alias |
| `Decimal(storage?)` | | `decimal` | `Decimal128` | `mongo/decimal128@1` | new |
| `Boolean(storage?)` | | `bool` | `Bool` | `mongo/bool@1` | `Boolean` stops being a deprecated alias |
| `Bytes(storage?)` | | `binData` | `Binary` | `mongo/binary@1` | new |
| `String(storage?)` | | `string` | `BsonString` | `mongo/string@1` | explicit `String` renamed |
| `Json(storage?)` | | `bson` | `PlainJson` | `mongo/json@1` | explicit `Json` renamed |

- **`Json` has one storage, `bson`.** MongoDB stores a JSON value as whichever BSON value fits it, which is its idiomatic form. A JSON string storage would need a new codec and is not part of this project.
- **`Int`, `Float` and `Boolean` stop warning.** Today they warn and point to `Int32`, `Double` and `Bool`. As convenience types they are the names a user is meant to write. Their codecs do not change.
- **`Int64` becomes `Int64BigInt`,** with `Int64` kept for one release line as a deprecated alias. BSON's `long` has two codecs, so both carry a suffix for the value they read, as PostgreSQL's `Int8BigInt` and `Int8Number` do.
- **`BsonString` is the name MongoDB's C# and Java drivers give the type.** The explicit `String` and `Json` need no deprecated alias: the bare convenience names give the same codecs.
- **The deprecation warning fires wherever a deprecated name is written,** as the SQL family's does: with or without arguments, in a field, a value object member or a `types {}` alias. Today MongoDB's fires only for a bare name in a field.
- The Prisma 6 schema reader keeps its bindings; it names codecs, not PSL names.

## Code the targets share

The new codecs repeat value logic across targets: decimal text on PostgreSQL, MySQL, MongoDB and now SQLite; a boolean read from an integer on SQLite and MySQL; the check that a value is plain JSON on all four. ADR 314 says where such code goes: value logic that depends on no database and no family lives in `@internal/type-implementations`, and codec classes, errors and SQL stay in the target or the family.

Each slice that adds a codec applies that rule, and records what it found:

- Decimal text handling moves into `@internal/type-implementations` when the second new decimal codec is written. This is TML-3782, which the MySQL slice closes.
- The plain-JSON check is TML-3783. The MySQL JSON codec uses the shared check from the start.
- Where two SQL targets need the same codec class, not only the same value logic, the slice says so in its PR and does not invent a new shared home. Whether the SQL family should hold codec classes is a question for Will, with the cases in hand.

## The SQL family's `sql.String(n)` and `sql.Char(n)`

`sql.String(n)` is a `varchar(n)` column on every SQL target. It now shares a name with the `String` convenience type and means something else. It is renamed `sql.Varchar(n)`, and `sql.String` stays for one release line as a deprecated alias. `sql.Char(n)` keeps its name.

## Names

Will accepted every explicit name and `storage` value in the tables above on 2026-11-17. No name is open.

## Scope

In scope: the type declarations of the four targets, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the `prisma-8` skill references, upgrade instructions for every rename, and the ADRs: ADR 316 gains PostgreSQL `Json`, and a new ADR records the other targets' tables as ADR 315 did for the date and time types.

Also in scope, because main is wrong today: main has two ADRs numbered 316. The one from prisma/orm#30956 (an extension pack's extension is found through the search path) merged second and takes the next free number.

Out of scope:

- The type choice mechanism, and anything else under `packages/1-framework`.
- A MongoDB JSON string storage. The codecs SQLite and MySQL lack are in scope.
- Convenience types for single-concept types such as `Uuid`, `ObjectId`, `Vector` and `Bson`.
- Clearer errors for `json` limits on PostgreSQL.

## Acceptance criteria

- [ ] On each target, each row of its table resolves to its explicit type in PSL and in a TypeScript contract.
- [ ] On each target, a schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files, except SQLite fields written `Decimal`.
- [ ] `contract infer` and `contract print` write the convenience calls, and the print round-trip tests pass.
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract. MongoDB's `Int`, `Float` and `Boolean` no longer warn.
- [ ] Every rename a user must act on has an upgrade instruction with a detection pattern.
- [ ] `docs/reference/scalar-types.md` and the ADRs describe the final names.
- [ ] No file under `packages/1-framework` changes.

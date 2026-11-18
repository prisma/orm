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
| PostgreSQL `Json`, and `sql.Varchar` | Merged, prisma/orm#31065. Recorded in ADR 316. |
| MongoDB | Merged, prisma/orm#31067. Recorded in ADR 322. |
| SQLite | Built, not merged. Recorded in ADR 322. |
| MySQL | To build. This spec. |

## Rules that hold on every target

These come from ADR 279, ADR 315 and ADR 316. They are listed here because every table below follows them.

1. A convenience name is a concept, not a representation. Its options are the same on every target; the values of `storage` and `as`, and the defaults, are each target's own.
2. Every convenience type has a `storage` option, even where a target has one storage for it. It has an `as` option only where some target reads the concept as more than one kind of value. Today only `BigInt` does.
3. A bare convenience name gives the codec that name gave before, so no existing schema or contract changes.
4. An explicit type is named after the database type that stores it, plus a suffix for the application value where that database type has more than one codec.
5. An explicit name that disappears stays for one release line as a deprecated alias that warns `PSL_DEPRECATED_SCALAR_NAME` and emits the same contract.
6. Tools that write PSL write the convenience call, with only the arguments that differ from the defaults. Only PostgreSQL has such tools (`contract infer`, `contract print`, the Prisma 7 reader). On the other targets the same fact is tested directly: for each explicit type, `findAuthoringTypeChoiceCall` returns the convenience call its table shows.
7. A convenience type and an explicit type cannot share a name: a type choice row names its explicit type in the same namespace. Where rule 4 would give a convenience name, the explicit type takes, in this order: (a) the database's own second name for the type, where it has one (MySQL `INT4`, `NUMERIC`, `BOOL`); (b) the value suffix of ADR 315 rule 5, where that gives a meaningful name (SQLite `DecimalString`); (c) a name recorded as an exception. The exceptions are `PlainJson` on all four targets and MongoDB's `BsonString`. `JsonJson` and `StringString` say nothing, which is why the suffix was not used for them.

## PostgreSQL `Json`

| Convenience type | `storage` | Becomes | Codec | Column |
| --- | --- | --- | --- | --- |
| `Json(storage?)` | `json` (default) | `PlainJson` | `pg/json@1` | `json` |
| | `jsonb` | `Jsonb` | `pg/jsonb@1` | `jsonb` |

- **`Json` still means a `json` column.** `Json` is the exact name of a PostgreSQL type, so it must not mean a different one. A user who wants `jsonb` writes `Json(storage: jsonb)` or `Jsonb`.
- **No schema or contract changes.** A field written `Json` keeps codec `pg/json@1`. There is no migration and no upgrade step for PSL schemas.
- **`PlainJson` is the explicit name of the `json` type,** an exception under rule 7(c). ADR 316 and ADR 257 record rule 7 as written above, with the list of exceptions. Users meet `PlainJson` in hover text, in the type reference, and in one message: the refusal of `@db.Json` says to write `PlainJson`, because that message always names the explicit type (as `@db.Integer` names `Int4`). `contract infer` and `contract print` never write it.
- **`Jsonb` stays** as the explicit type of the `jsonb` column, unchanged.
- **Tools.** A `json` column is written `Json`. A `jsonb` column is written `Json(storage: jsonb)`, where the tools wrote `Jsonb` before. The Prisma 7 reader writes Prisma 7's `Json`, which was `jsonb`, as `Json(storage: jsonb)`, and `@db.Json` as `Json`.
- **TypeScript.** `type.Json()` and `type.Json({ storage: 'jsonb' })` are typed as the explicit type they choose. The column helper `jsonColumn` becomes `plainJsonColumn`, with no alias, as ADR 316 did for `int8Column`. That rename gets an upgrade instruction whose detection pattern matches the import from the PostgreSQL packages, because SQLite exports a `jsonColumn` too. Its test includes a SQLite file that is not matched.
- **The removed `json()` preset.** Its refusal says to write `Jsonb` today. It says `Json(storage: jsonb)` in PSL and `type.Json({ storage: 'jsonb' })` in TypeScript, as the other hints name convenience types.
- **Docs.** `docs/reference/scalar-types.md` and the `prisma-8` skill say what a `json` column cannot do (no equality filter, no index, no unique constraint) and that `Json(storage: jsonb)` can.

Areas this slice changes, from the footprint of prisma/orm#30942:

- Declarations: `type-constructors.ts` (the `inferred` mark moves from `Json` to `PlainJson` and stays on `Jsonb`; the stale comment at line 86 goes), the type choice, the column helper export.
- Expected output only, no code change: the printer and infer tests (`postgres/1-target/test/psl-infer`, `test/psl-print`, `test/integration/test/psl-print`, `psl-infer`, `cli-journeys`), `prisma7-type-map.test.ts` (the renamed-native-types map gains `Json: 'PlainJson'`), fill-value messages (a `json` column is named `Json`, a `jsonb` column `Jsonb`; add a test).
- Fixtures: `Json` fields are not touched. `Jsonb` fields in `packages/3-extensions/supabase/src/contract/contract.prisma` are rewritten by hand to `Json(storage: jsonb)`. The two fixtures and three READMEs that use `jsonColumn`.
- Docs: `docs/reference/scalar-types.md`, `docs/reference/error-reference.md`, the READMEs of `contract-psl`, `contract-ts` (and its `API.md`) and `postgres/1-target`, the `prisma-8` skill, ADR 316, ADR 257, ADR 279 ("Not decided here"), `ADR-INDEX.md`.

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
| `Boolean(storage?)` | | `integer` | `IntegerBoolean` | new, `sqlite/boolean@1` | none |
| `Bytes(storage?)` | | `blob` | `Blob` | `sqlite/blob@1` | `Bytes` |
| `Json(storage?)` | | `text` | `PlainJson` | `sqlite/json@1` | `Json` |

- **`Decimal` gets its own data type, `sqlite/decimal`, stored as text.** Today it is the same codec as `String`, so nothing in the contract says the column holds a decimal, and a new required `Decimal` field is filled with `''`. This is TML-3562, which this slice closes. It is the one place where rule 3 is broken: the contract of every SQLite project with a `Decimal` field changes, with an upgrade instruction. The stored text does not change, so no data moves. The slice must show this: a CLI journey test on a project signed with the old contract checks that `migration plan` produces no table rebuild and what `db verify` reports. A fixture with a `Decimal` field is added before the change so the contract difference is visible.
- **What `sqlite/decimal@1` does.** It refuses to write text that is not a decimal. Reading text that is not a decimal (such as the `''` an earlier fill wrote) raises a decode error that names the column; the upgrade instruction says how to find such rows. A new required field is filled with `'0'`. It allows equality filters only: text compares by characters, so ordering and aggregates are not offered.
- **`DecimalString` is named after its data type, not its column.** SQLite has no decimal column type, so the name follows ADR 315's rule for that case, as `DateString` and `DurationString` do. `TextString` would say nothing.
- **`Boolean` is new on SQLite,** with its own data type `sqlite/boolean`, stored as `integer` 0 or 1, which is what SQLite's own `TRUE` and `FALSE` are. The codec writes 0 or 1, because `node:sqlite` does not bind booleans. It reads 0 as `false` and 1 as `true` from a number, bigint or text, and raises a decode error for any other value. `@default(true)` renders as `1`.
- **`BigInt(as: number)` and `Int` are the same explicit type.** `sqlite/integer@1` and `sqlite/bigintnumber@1` both store an `integer` and read a `number`. They did not check alike: `sqlite/bigintnumber@1` refused a value outside the safe-integer range or not an integer on write and on read, while `sqlite/integer@1` wrote any number as it was and read a number from a row without checking it. The slice makes `sqlite/integer@1` check as `sqlite/bigintnumber@1` does, so a `BigIntNumber` field keeps its checks; every `Int` field gets them too, with its own upgrade instruction (`sqlite-integer-safe-range`). The one remaining difference is that `sqlite/bigintnumber@1` also reads a `bigint` from the driver, which `node:sqlite` does not return here. `BigIntNumber` becomes a deprecated alias of `IntegerNumber`. This is the second place rule 3 is broken: a field written `BigIntNumber` changes codec id from `sqlite/bigintnumber@1` to `sqlite/integer@1` on the next emit, with no column change. It shares the `Decimal` upgrade instruction and journey test. The codec `sqlite/bigintnumber@1` itself stays, because aggregates return it.
- **`Int` is declared before `BigInt`,** so the convenience call for `IntegerNumber` is `Int`. A test fixes this. It is an exception to ADR 316's "each explicit type has one convenience call", recorded in the new ADR.
- **Column helpers are named after the explicit type they give,** as ADR 316 requires: `integerColumn`, `bigintColumn` and `jsonColumn` are renamed to match `IntegerNumber`, `IntegerBigInt` and `PlainJson`, helpers are added for `DecimalString` and `IntegerBoolean`, and each rename gets an upgrade instruction.

## MySQL

Of the scalars here, MySQL has codecs for `int`, `bigint`, `text` and `varchar` only. Every other row below needs a new codec, as the date and time project added MySQL's date and time codecs (ADR 315). The defaults are the columns Prisma 7 created for the same names; check them against Prisma 7's documentation before building.

Where MySQL has a second name for a column type and PostgreSQL's explicit type already uses it, MySQL uses the same explicit name. The `storage` values are the names MySQL reports (`int`, `double`, `decimal`, `tinyint`), so on MySQL a `storage` value and its explicit name differ. The new ADR says so.

| Convenience type | `as` | `storage` | Becomes | Column | MySQL also calls it | Codec |
| --- | --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int` | `Int4` | `int` | `INT4` | `mysql/int@1` |
| `BigInt(as?, storage?)` | `bigint` (default) | `bigint` | `Int8BigInt` | `bigint` | `INT8` | `mysql/bigint@1` |
| | `number` | `bigint` | `Int8Number` | `bigint` | `INT8` | new, `mysql/bigintnumber@1` |
| `Float(storage?)` | | `double` (default) | `Float8` | `double` | `FLOAT8` | new, `mysql/double@1` |
| | | `float` | `Float4` | `float` | `FLOAT4` | new, `mysql/float@1` |
| `Decimal(storage?, precision?, scale?)` | | `decimal` | `NumericString`, precision 65 and scale 30 unless written | `decimal(p,s)` | `NUMERIC` | new, `mysql/decimal@1` |
| `String(storage?, length?)` | | `varchar` (default) | `Varchar`, length 191 unless written | `varchar(n)` | | `sql/varchar@1` |
| | | `text` | `Text` | `text` | | `mysql/text@1` |
| `Boolean(storage?)` | | `tinyint` | `Bool` | `tinyint(1)` | `BOOL` | new, `mysql/boolean@1` |
| `Bytes(storage?)` | | `longblob` | `Longblob` | `longblob` | | new, `mysql/longblob@1` |
| `Json(storage?)` | | `json` | `PlainJson` | `json` | | new, `mysql/json@1` |

- **New codec ids follow MySQL's existing ones,** which are named after the type MySQL reports (`mysql/int@1`, `mysql/bigint@1`). `Bool`'s data type claims `tinyint(1)` only, so other `tinyint` widths stay free for a later integer type.
- **A bare `Decimal` is `decimal(65,30)`,** the column Prisma 7 created. MySQL's own default, `decimal(10,0)`, holds no fraction digits.
- **MySQL gains top-level `Varchar` and `Text` explicit types,** because a type choice row can only name a type at its own level, not `sql.Varchar`.
- **Wire behaviour is probed, not assumed.** The driver is the `mariadb` package using the text protocol, with parameters written into the SQL, so each codec receives text or bytes. The first step of the slice probes a live MySQL and a live MariaDB server and fills a table in this spec for each new codec: value on the wire in each direction, how a parameter is given its type in SQL (a string compared with a `decimal` column is compared as a float unless cast), catalog text for `db verify`, how defaults render and read back, and which operations are allowed. Known questions for the probe: what `tinyint(1)` values other than 0 and 1 read as; whether `float` reads back rounded to six digits; how a JSON `null` differs from SQL `NULL`.
- **MariaDB shares these declarations.** Its `JSON` is another name for `longtext` with a check constraint. The probe decides how `Json` verifies there; if it cannot be made to verify in this slice, `Json` is refused on MariaDB with a clear error, and the spec says so.
- The slice extends `examples/prisma-8-demo-mysql`, as the MySQL project requires of every slice.

- MySQL's migration planner does not change a column's type yet, so changing a field between these types is refused by `migration plan`, as for the date and time types.

## MongoDB

MongoDB's explicit types are already named after BSON types, so most rows only add the convenience type. The `storage` values are BSON's own type names, as `storage: date` and `storage: string` already are for the date and time types. The one exception is `bson` for `Json`, which means "whichever BSON value fits". It does not mean the explicit type `Bson`, which accepts any BSON value; the docs say so.

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
- **`Int64` becomes `Int64BigInt`,** with `Int64` kept for one release line as a deprecated alias in PSL. In a TypeScript contract `type.Int64()` is removed at once, because the MongoDB builder gives a deprecated name no helper (ADR 257, amended 2026-10-30). An upgrade instruction with a detection pattern covers it.
- **Texts that name the old types are corrected:** `removedMongoFieldPresets` (points to `Int64`) and `EARLIER_MONGO_SCALAR_NAMES` (says `BigInt`, `Bytes` and `Decimal` are not MongoDB types). ADR 257 is amended: `Int`, `Float` and `Boolean` have `type.*` helpers again. BSON's `long` has two codecs, so both carry a suffix for the value they read, as PostgreSQL's `Int8BigInt` and `Int8Number` do.
- **`BsonString` is the name MongoDB's C# and Java drivers give the type.** The explicit `String` and `Json` need no deprecated alias: the bare convenience names give the same codecs.
- **The deprecation warning fires wherever a deprecated name is written,** as the SQL family's does: with or without arguments, in a field, a value object member or a `types {}` alias. Today MongoDB's does not fire for a name written with parentheses (`interpreter.ts:963`) or for the base of a `types {}` alias (`type-aliases.ts:209`). The warner is widened inside the MongoDB family; it is a second copy of the SQL family's, because a shared home would be the framework. Tests: one per place (bare, with parentheses, value object member, alias); `Int`, `Float` and `Boolean` warn in none; `types { X = String }` and `types { X = Int }` still resolve.
- The Prisma 6 schema reader keeps its bindings; it names codecs, not PSL names.

## Code the targets share

The new codecs repeat value logic across targets: decimal text on PostgreSQL, MySQL, MongoDB and now SQLite; a boolean read from an integer on SQLite and MySQL; the check that a value is plain JSON on all four. ADR 314 says where such code goes: value logic that depends on no database and no family lives in `@internal/type-implementations`, and codec classes, errors and SQL stay in the target or the family.

Each slice that adds a codec applies that rule, and records what it found:

- Decimal text handling moves into `@internal/type-implementations` in the SQLite slice, where its third user appears. PostgreSQL and MongoDB move to it in that slice, so the MySQL slice edits no released target's codecs. This is TML-3782. The framework's own decimal code stays where it is.
- The boolean-from-integer logic goes into the shared package in the SQLite slice; MySQL is its second user.
- The plain-JSON check is TML-3783. Today it lives in the MongoDB target. The MySQL slice extracts it as value logic that returns the failure as data, and uses it in MongoDB and MySQL. PostgreSQL and SQLite JSON codecs do not refuse a non-JSON value today and are left unchanged; ADR 257's sentence about the check's home is corrected.
- A codec class that two SQL targets need goes in the SQL family beside `SqlTextCodec` and the others in `relational-core/src/ast/sql-codecs.ts`, as ADR 314 says.

## The SQL family's `sql.String(n)` and `sql.Char(n)`

`sql.String(n)` is a `varchar(n)` column on every SQL target. It now shares a name with the `String` convenience type and means something else. It is renamed `sql.Varchar(n)`, and `sql.String` stays for one release line as a deprecated alias. `sql.Char(n)` keeps its name, so the namespace ends as `sql.Varchar(n)` and `sql.Char(n)`.

The rename is built in the PostgreSQL `Json` slice, because PostgreSQL is the released target it affects. That slice amends ADR 316, which says `sql.String(n)` stays. Tests under `packages/1-framework` that mention `sql.String(` are left on the deprecated name. Criteria: `sql.String(n)` warns and emits the same contract on all three SQL targets, and no tool writes it.

## Names

Will accepted every explicit name and `storage` value in the tables above on 2026-11-17. No name is open.

## Scope

In scope: the type declarations of the four targets, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the `prisma-8` skill references, upgrade instructions for every rename, and the ADRs: ADR 316 gains PostgreSQL `Json`, and a new ADR records the shared rules and the other targets' tables as ADR 315 did for the date and time types. The MongoDB slice starts that ADR; the SQLite and MySQL slices add their tables.

Also in scope, because main is wrong today: main has two ADRs numbered 316. The one from prisma/orm#30956 (an extension pack's extension is found through the search path) merged second and takes the next free number, chosen from main and open pull requests at the time the slice is pushed. The renumbering is its own commit.

Out of scope:

- The type choice mechanism, and anything else under `packages/1-framework`.
- A MongoDB JSON string storage. The codecs SQLite and MySQL lack are in scope.
- Convenience types for single-concept types such as `Uuid`, `ObjectId`, `Vector` and `Bson`.
- Clearer errors for `json` limits on PostgreSQL.

## Acceptance criteria

- [ ] On each target, each row of its table resolves to its explicit type in PSL and in a TypeScript contract.
- [ ] On each target, a schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files, except SQLite fields written `Decimal` or `BigIntNumber`. `pnpm fixtures:check` shows no difference at all in the PostgreSQL, MongoDB and MySQL slices.
- [ ] On PostgreSQL, `contract infer` and `contract print` write the convenience calls, and the print round-trip tests pass. On the other targets, each explicit type's convenience call is tested directly, and MySQL's `inferred` marks name one explicit type per column type (`Int8BigInt` for `bigint`).
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract, except SQLite `BigIntNumber`. MongoDB's `Int`, `Float` and `Boolean` no longer warn.
- [ ] PostgreSQL `Json`: `Json`, `Json(storage: json)` and `PlainJson` emit the same column; `Json(storage: jsonb)` and `Jsonb` emit the same column; `Json` works as a list, as a `types {}` alias base and with a JSON `@default`; `type.Json()` is typed `pg/json@1` and `type.Json({ storage: 'jsonb' })` `pg/jsonb@1`; `type.Json({ storage: 'text' })` and `type.Json({ as: 'string' })` do not compile; `contract infer` reads a live `json` and `jsonb` column; a Prisma 7 `Json` and `Json @db.Json` read as `Json(storage: jsonb)` and `Json`.
- [ ] Each limit the docs state for `json` (no equality filter, no index, no unique constraint) is checked against the code or a test before it is written.
- [ ] `pnpm check:upgrade-coverage`, `pnpm lint:ratchets` and `pnpm lint:deps` pass in every slice.
- [ ] Every rename a user must act on has an upgrade instruction with a detection pattern.
- [ ] `docs/reference/scalar-types.md` and the ADRs describe the final names.
- [ ] No source file under `packages/1-framework` changes.

# ADR 322 — Each target declares the scalar convenience types over its own explicit types

**Status:** Accepted. The MongoDB and SQLite sections are decided; MySQL's section is pending and is added when MySQL gets these types.
**Builds on:** [ADR 279 — Convenience types choose an explicit type from their arguments](ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md), [ADR 316 — PostgreSQL scalars get convenience types](ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md), [ADR 315 — Each target declares the convenience date and time types over its own explicit types](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md)
**Uses:** [ADR 314 — Code shared by several targets' type implementations lives in one package](ADR%20314%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md)
**Amends:** [ADR 257 — Scalar types are named after the target on every surface](ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md)

## At a glance

```prisma
// MongoDB
model Event {
  id      ObjectId @id @map("_id")
  visits  Int                  // exactly Int32: a BSON int
  total   BigInt               // exactly Int64BigInt: a BSON long, read as a bigint
  rank    BigInt(as: number)   // exactly Int64Number: a BSON long, read as a number
  price   Decimal              // exactly Decimal128
  name    String               // exactly BsonString
  payload Json                 // exactly PlainJson: a JSON value stored as BSON
}

// SQLite
model Account {
  id      Int      @id         // exactly IntegerNumber: an integer read as a number
  balance BigInt               // exactly IntegerBigInt: an integer read as a bigint
  price   Decimal              // exactly DecimalString: decimal text in a text column
  active  Boolean @default(true) // exactly IntegerBoolean: an integer 0 or 1
  payload Json                 // exactly PlainJson: JSON text in a text column
}
```

`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` name what a field means in the application. ADR 316 made them convenience types on PostgreSQL. This ADR records the rules every other target follows when it gets them, and each target's table. MongoDB was the first and SQLite the second. MySQL's table is added to this ADR when MySQL gets these types.

## Decision

These rules hold on every target. The first five restate ADR 279, ADR 315 and ADR 316 so that each table below can be read on its own.

1. **A convenience name is a concept, not a representation.** Its options are the same on every target. The values of `storage` and `as`, and the defaults, are each target's own.
2. **Every convenience type has a `storage` option,** even where a target has one storage for it. It has an `as` option only where some target reads the concept as more than one kind of value. Today only `BigInt` does.
3. **A bare convenience name gives the codec that name gave before,** so no existing schema or contract changes.
4. **An explicit type is named after the database type that stores it,** plus a suffix for the application value where that database type is read by more than one codec of its data type, such as PostgreSQL's `Int8BigInt` and `Int8Number`. A type with a data type of its own, which a column of another type stores, is named after that data type where the database has no column type for it, as ADR 315's rule 5 names `DateString`.
5. **An explicit name that disappears stays in PSL for one release line** as a deprecated alias that warns `PSL_DEPRECATED_SCALAR_NAME` and emits the same contract. The one-release-line promise of ADR 257 covers PSL names, because a schema that names a removed type stops resolving with nothing to say what to write. A TypeScript helper is not covered: a renamed helper fails at compile time, and the upgrade instruction rewrites the call, as ADR 316's column helper renames did. On MongoDB the TypeScript `type.*` helper of a renamed explicit type goes at once, and a JavaScript caller that reads it gets `CONTRACT.FIELD_HELPER_UNKNOWN` naming the replacement. The SQL builder keeps a deprecated helper for the release line instead (ADR 316).
6. **Each explicit type has exactly one convenience call that becomes it,** and that is the call a tool that writes PSL writes, with only the arguments that differ from the defaults. Only PostgreSQL has such tools today: `contract infer`, `contract print` and the Prisma 7 schema reader. On every target the invariant is tested for each explicit type in its table. SQLite's `IntegerNumber` is the one exception, recorded in its section: both `Int` and `BigInt(as: number)` become it, and the call written for it is `Int`.
7. **A convenience type and an explicit type cannot share a name,** because a type choice row names its explicit type in the same namespace. Where rule 4 would give an explicit type a convenience name, it takes the first of these that applies:
   1. the database's own second name for the type, where it has one, such as `INT4`, `NUMERIC` and `BOOL`, the names MySQL's explicit types will take;
   2. the value suffix of ADR 315 (rule 5), where that gives a meaningful name, such as `DecimalString`, the name of SQLite's explicit decimal type;
   3. a name recorded as an exception. The exceptions are `PlainJson`, on every target, MongoDB's `BsonString` and SQLite's `IntegerBoolean`. The suffix would give `JsonJson`, `StringString` and `BooleanBoolean`, which say nothing. `IntegerBoolean` is named after the column type that stores it plus the value, as SQLite's other `integer` types are.

The SQL family's `sql.String(n)` was a `varchar(n)` column on every SQL target, and it shared a name with the `String` convenience type while meaning something else. It is renamed `sql.Varchar(n)` on PostgreSQL, SQLite and MySQL, with `sql.String` kept for one release line as a deprecated alias ([ADR 316](ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md)). `sql.Char(n)` keeps its name.

## MongoDB

MongoDB's explicit types were already named after BSON types, so most rows only add the convenience type. The `storage` values are BSON's own type names, as `storage: date` and `storage: string` already are for the date and time types, except `bson` on `Json`, explained below.

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

- **`Int`, `Float` and `Boolean` stop warning.** Before, they were deprecated aliases pointing to `Int32`, `Double` and `Bool`. As convenience types they are the names a user is meant to write, and they have `type.Int()`, `type.Float()` and `type.Boolean()` helpers again. Their codecs do not change.
- **`Int64` is renamed `Int64BigInt`.** BSON's `long` has two codecs, so both carry a suffix for the value they read, as PostgreSQL's `Int8BigInt` and `Int8Number` do. `Int64` stays in PSL for one release line as a deprecated alias. `type.Int64()` is removed at once, as rule 5 says; an upgrade instruction rewrites it to `type.BigInt()`.
- **`String` and `Json` become convenience names, and their explicit types are `BsonString` and `PlainJson`.** `BsonString` is the name MongoDB's C# and Java drivers give the type. Neither needs a deprecated alias: the bare names now give the same codecs.
- **`Json` has one storage, `bson`.** MongoDB stores a JSON value as whichever BSON value fits it: an object, array, string, number, bool or null. That is its idiomatic form. `storage: bson` does not mean the explicit type `Bson`, which accepts any BSON value, dates and ObjectIds included. A JSON string storage would need a new codec and is not part of this decision.
- **The Prisma 6 schema reader is unchanged.** It maps each Prisma 6 type to a codec, not to a PSL name, so the renames do not reach it.

## SQLite

SQLite's column types are `text`, `integer`, `real` and `blob`. An explicit type is named after the SQLite column type that stores it: `Text`, `Real` and `Blob`. `integer` is read as three kinds of value, so its types carry the value too: `IntegerNumber`, `IntegerBigInt` and `IntegerBoolean`. A type stored as `text` that holds a value with a form of its own is named after that value instead: `DecimalString`, `PlainJson` and the date and time types. The `storage` values are those column types.

| Convenience type | `as` | `storage` | Becomes | Codec | Change |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `integer` | `IntegerNumber` | `sqlite/integer@1` | explicit `Int` becomes the convenience name |
| `BigInt(as?, storage?)` | `bigint` (default) | `integer` | `IntegerBigInt` | `sqlite/bigint@1` | explicit `BigInt` becomes the convenience name |
| | `number` | `integer` | `IntegerNumber` | `sqlite/integer@1` | `BigIntNumber` becomes a deprecated alias, and its codec id changes |
| `Float(storage?)` | | `real` | `Real` | `sqlite/real@1` | explicit `Float` becomes the convenience name |
| `Decimal(storage?)` | | `text` | `DecimalString` | `sqlite/decimal@1` | new codec, where `Decimal` was `sqlite/text@1` |
| `String(storage?)` | | `text` | `Text` | `sqlite/text@1` | explicit `String` becomes the convenience name |
| `Boolean(storage?)` | | `integer` | `IntegerBoolean` | `sqlite/boolean@1` | new |
| `Bytes(storage?)` | | `blob` | `Blob` | `sqlite/blob@1` | explicit `Bytes` becomes the convenience name |
| `Json(storage?)` | | `text` | `PlainJson` | `sqlite/json@1` | explicit `Json` becomes the convenience name |

- **`Int`, `BigInt`, `Float`, `String`, `Bytes` and `Json` keep their codecs.** Before, each was an explicit type. As convenience names they give the same codecs, so no contract changes and they need no deprecated alias. The TypeScript column helpers are named after the explicit type they give, as ADR 316 requires: `integerColumn`, `bigintColumn` and `jsonColumn` are renamed `integerNumberColumn`, `integerBigIntColumn` and `plainJsonColumn`, with no alias, and `decimalStringColumn` and `integerBooleanColumn` are added.
- **`Decimal` gets its own data type, `sqlite/decimal`, stored as `text`.** Before, `Decimal` was the same codec as `String`, so nothing in the contract said the column held a decimal, and a new required `Decimal` column was filled with `''`. The codec `sqlite/decimal@1` refuses to write text that is not a decimal and stores it without leading zeros or a minus sign on zero. Reading stored text that is not a decimal raises a decode error that names the column. A new required column is filled with `'0'`. Text compares by its characters, so the codec offers equality only: no ordering and no aggregates. This breaks rule 3: the contract of every SQLite project with a `Decimal` field changes. The stored text and the column do not change, so the database only needs to be signed with the new contract, and an upgrade instruction says how, and how to find stored text that is not a decimal.
- **`DecimalString` is named after its data type, not its column.** SQLite has no decimal column type, so the name follows ADR 315's rule for that case, as `DateString` and `DurationString` do, and rule 7(2) here. `Boolean` did not take the same route: its column type plus its value gives `IntegerBoolean`, a distinct name that says what is stored, while for a decimal it gives `TextString`, which is what `Text` already is.
- **`Boolean` is new on SQLite,** with its own data type `sqlite/boolean`, stored as `integer` 0 or 1, which is what SQLite's own `TRUE` and `FALSE` are. The codec `sqlite/boolean@1` writes 1 or 0, because `node:sqlite` binds no boolean. It reads 0 as `false` and 1 as `true` from a number, a bigint or text, and raises a decode error that names the column for any other value. `@default(true)` is written `DEFAULT 1`, a new required column is filled with 0, and the codec offers equality. `Boolean` did not exist on SQLite, so no contract changes and there is no deprecated alias.
- **`Int` and `BigInt(as: number)` are the same explicit type, `IntegerNumber`.** A SQLite `integer` holds 64 bits either way, and both read a JavaScript `number`. `BigIntNumber`, the explicit name `BigInt(as: number)` had, becomes a deprecated alias of `IntegerNumber`. This is the second place rule 3 is broken: a field written `BigIntNumber` changes codec id from `sqlite/bigintnumber@1` to `sqlite/integer@1` on the next emit, with no column change. It shares `Decimal`'s upgrade instruction. The codec `sqlite/bigintnumber@1` stays, because `count` and the `sum` of an integer column read their result through it; see Alternatives considered.
- **`sqlite/integer@1` checks the safe integer range in both directions, as `sqlite/bigintnumber@1` did.** Before, it wrote any number as it was and read a stored number without checking it. Now a write of a number that is not an integer within ±(2^53 − 1), such as `1.5`, fails with `RUNTIME.ENCODE_FAILED`, and a read of a stored number that is not one, such as a `real` an earlier write stored, fails with `RUNTIME.DECODE_FAILED`. Without this, a `BigIntNumber` field would lose its checks when its codec id changed. The change applies to every `Int` field too, and has its own upgrade instruction.
- **`Int` is declared before `BigInt`, so `IntegerNumber` is written `Int`.** Two convenience calls become `IntegerNumber`, against rule 6, which is the one exception to it. `findAuthoringTypeChoiceCall` takes the first type choice that becomes an explicit type, so the declaration order decides, and a test fixes it.
- **The value logic two targets share lives in `@internal/type-implementations`,** as ADR 314 says. Decimal text handling moves there, and PostgreSQL's `numeric` and MongoDB's `Decimal128` codecs use it too. Reading a boolean from an integer 0 or 1 and writing one back goes there as well, for MySQL's `tinyint(1)` to use later. The codec classes and their errors stay in the SQLite target.

## Consequences

- On MongoDB a user writes the same scalar names as on PostgreSQL and gets a working field. The explicit types say exactly which BSON type stores the value.
- No MongoDB contract changes. A schema that writes `Int64` warns and emits the same contract. A TypeScript contract that calls `type.Int64()` stops compiling until it is rewritten.
- The hints for the removed `field.*` helpers and the refusal of a `Json` write now name the convenience type, such as `type.BigInt()` for the removed `field.int64()` helper and "declare the field `BigInt` or `Bson`". A message about a deprecated name names its replacement, which is the explicit type.
- `Int` on MongoDB is a 32-bit BSON int. Prisma 6 stored a MongoDB `Int` as a BSON long, so a field ported from a Prisma 6 schema by hand as `Int` holds longs, and the type for it is `BigInt(as: number)`. Before this change a hand-ported `Int` warned; now it is a recommended name and does not. The Prisma 6 schema reader already reads a Prisma 6 `Int` as `Int64Number`, the explicit type `BigInt(as: number)` becomes.
- `BigInt`, `Bytes` and `Decimal`, which MongoDB refused before, now resolve, so the message that mapped them to `Int64`, `Binary` and `Decimal128` is removed.
- On SQLite a user writes the same eight names as on PostgreSQL and MongoDB, and `Boolean` works where it did not before.
- The contract of a SQLite project changes where a field is written `Decimal` or `BigIntNumber`. No column changes and no data moves; `migration plan` writes a migration with no operations and `db update` runs none, and either signs the database.
- A SQLite `Decimal` field can no longer be ordered or given a `min` or `max`, which compared its text by characters before. Stored text that is not a decimal, such as the `''` an earlier fill wrote, fails to read until it is fixed.
- A SQLite `Int` field refuses a number that is not an integer in the safe integer range, which SQLite stored as a `real` or with digits lost before.

## Alternatives considered

**Keep `type.Int64()` as a deprecated helper for one release line, as the SQL builder does.** Users who call it would keep compiling for a release line. Not taken: the MongoDB builder gives a helper to every type that is not deprecated and none to a deprecated name, and adding one for a single alias would make the builder read the `deprecated` marker two ways. A TypeScript caller gets a compile error and an upgrade instruction that applies the rewrite, and a JavaScript caller gets an error naming `type.Int64BigInt()`, so nobody is left without a fix.

**Keep `Int`, `Float` and `Boolean` deprecated on MongoDB, and add only the missing names.** Users would write `Int` on PostgreSQL and `Int32` on MongoDB for the same concept, against rule 1.

**Keep the explicit name `Int64` beside `Int64Number`.** No rename, but one of the two readings of a BSON `long` would carry a suffix and the other not, and `Int64` would not say which value it reads.

**Keep SQLite's `Decimal` on `sqlite/text@1`.** No contract would change. Not taken: nothing would say the column holds a decimal, so nothing could check the text, a new required column would keep being filled with `''`, and ordering would keep comparing characters.

**Keep `BigIntNumber` as its own explicit type on `sqlite/bigintnumber@1`.** No contract would change. Not taken: `IntegerNumber` and `BigIntNumber` would be two explicit types for one column type and one application value, which rule 4 leaves no name for.

**Point SQLite's `count` and `sum` at `sqlite/integer@1` and remove `sqlite/bigintnumber@1`.** After this change the two codecs read the same column type into a `number` and check the same range, so one is enough. Not taken here: the result types of `count` and `sum` are recorded in every emitted SQLite `contract.d.ts`, so the removal changes the generated types of every SQLite project, which is outside the `Decimal` and `BigIntNumber` changes this decision makes. It needs its own change and upgrade instruction.

**Store SQLite's `Boolean` as the text `true` or `false`.** Not taken: SQLite's own `TRUE` and `FALSE` are the integers 1 and 0, and a `boolean` column declared in SQL gets `numeric` affinity and stores them, so the integer is what a database not written by Prisma holds.

**Name the explicit string type `StringString`.** It follows rule 7(2) mechanically and says nothing. `BsonString` names the stored BSON type, which is what rule 4 asks for.

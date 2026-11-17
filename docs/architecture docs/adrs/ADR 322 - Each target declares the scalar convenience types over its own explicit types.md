# ADR 322 — Scalar convenience types on the targets other than PostgreSQL

**Status:** Accepted
**Builds on:** [ADR 279 — Convenience types choose an explicit type from their arguments](ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md), [ADR 316 — PostgreSQL scalars get convenience types](ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md), [ADR 315 — Each target declares the convenience date and time types over its own explicit types](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md)
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
```

`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` name what a field means in the application. ADR 316 made them convenience types on PostgreSQL. This ADR records the rules every other target follows when it gets them, and each target's table. MongoDB is the first. SQLite's and MySQL's tables are added to this ADR when those targets get these types.

## Decision

These rules hold on every target. The first five restate ADR 279, ADR 315 and ADR 316 so that each table below can be read on its own.

1. **A convenience name is a concept, not a representation.** Its options are the same on every target. The values of `storage` and `as`, and the defaults, are each target's own.
2. **Every convenience type has a `storage` option,** even where a target has one storage for it. It has an `as` option only where some target reads the concept as more than one kind of value. Today only `BigInt` does.
3. **A bare convenience name gives the codec that name gave before,** so no existing schema or contract changes.
4. **An explicit type is named after the database type that stores it,** plus a suffix for the application value where that database type has more than one codec.
5. **An explicit name that disappears stays for one release line** as a deprecated alias that warns `PSL_DEPRECATED_SCALAR_NAME` and emits the same contract. A deprecated alias has no TypeScript `type.*` helper on MongoDB, because that builder gives none to a deprecated name; there the TypeScript name goes at once.
6. **Tools that write PSL write the convenience call,** with only the arguments that differ from the defaults. Only PostgreSQL has such tools: `contract infer`, `contract print` and the Prisma 7 schema reader. On the other targets the same fact is tested directly: for each explicit type, `findAuthoringTypeChoiceCall` returns the convenience call its table shows.
7. **A convenience type and an explicit type cannot share a name,** because a type choice row names its explicit type in the same namespace. Where rule 4 would give an explicit type a convenience name, it takes the first of these that applies:
   1. the database's own second name for the type, where it has one, such as MySQL's `INT4`, `NUMERIC` and `BOOL`;
   2. the value suffix of ADR 315 (rule 5), where that gives a meaningful name, such as SQLite's `DecimalString`;
   3. a name recorded as an exception. The exceptions are `PlainJson`, on every target, and MongoDB's `BsonString`. The suffix would give `JsonJson` and `StringString`, which say nothing.

The SQL family's `sql.String(n)` was a `varchar(n)` column on every SQL target, and it shared a name with the `String` convenience type while meaning something else. It is renamed `sql.Varchar(n)` on PostgreSQL, SQLite and MySQL, with `sql.String` kept for one release line as a deprecated alias ([ADR 316](ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md)). `sql.Char(n)` keeps its name.

## MongoDB

MongoDB's explicit types were already named after BSON types, so most rows only add the convenience type. The `storage` values are BSON's own type names, as `storage: date` and `storage: string` already are for the date and time types.

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
- **`Int64` is renamed `Int64BigInt`.** BSON's `long` has two codecs, so both carry a suffix for the value they read, as PostgreSQL's `Int8BigInt` and `Int8Number` do. `Int64` stays in PSL for one release line as a deprecated alias. `type.Int64()` is removed at once; an upgrade instruction rewrites it to `type.BigInt()`.
- **`String` and `Json` become convenience names, and their explicit types are `BsonString` and `PlainJson`.** `BsonString` is the name MongoDB's C# and Java drivers give the type. Neither needs a deprecated alias: the bare names now give the same codecs.
- **`Json` has one storage, `bson`.** MongoDB stores a JSON value as whichever BSON value fits it: an object, array, string, number, bool or null. That is its idiomatic form. `storage: bson` does not mean the explicit type `Bson`, which accepts any BSON value, dates and ObjectIds included. A JSON string storage would need a new codec and is not part of this decision.
- **The Prisma 6 schema reader is unchanged.** It maps each Prisma 6 type to a codec, not to a PSL name, so the renames do not reach it.

## Consequences

- On MongoDB a user writes the same scalar names as on PostgreSQL and gets a working field. The explicit types say exactly which BSON type stores the value.
- No MongoDB contract changes. A schema that writes `Int64` warns and emits the same contract. A TypeScript contract that calls `type.Int64()` stops compiling until it is rewritten.
- Messages that name a type for the user now name the convenience type, such as `type.BigInt()` for the removed `field.int64()` helper and "declare the field `BigInt` or `Bson`" in a refused `Json` write.
- A schema that names a type missing from MongoDB before, such as `BigInt`, `Bytes` or `Decimal`, now resolves, so MongoDB no longer has a message that maps those earlier Prisma names to its own.

## Alternatives considered

**Keep `Int`, `Float` and `Boolean` deprecated on MongoDB, and add only the missing names.** Users would write `Int` on PostgreSQL and `Int32` on MongoDB for the same concept, against rule 1.

**Keep the explicit name `Int64` beside `Int64Number`.** No rename, but one of the two readings of a BSON `long` would carry a suffix and the other not, and `Int64` would not say which value it reads.

**Name the explicit string type `StringString`.** It follows rule 7(2) mechanically and says nothing. `BsonString` names the stored BSON type, which is what rule 4 asks for.

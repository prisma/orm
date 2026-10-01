# Scalar types

Each target names its scalar types after what the database stores ([ADR 257](../architecture%20docs/adrs/ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md)). This page lists every scalar type per target, then maps the types across targets by concept, with the Prisma 6/7 name for readers migrating a schema. Other docs link here rather than repeat the lists.

Columns: the PSL name, the TypeScript builder helper (inside the `defineContract` callback), the codec id recorded in `contract.json`, the storage type, and the application type a query reads and writes.

## MongoDB

| PSL name | TS helper | Codec id | Storage type (BSON) | Application type |
| --- | --- | --- | --- | --- |
| `String` | `field.string()` | `mongo/string@1` | `string` | `string` |
| `Int32` | `field.int32()` | `mongo/int32@1` | `int` | `number` |
| `Int64` | `field.int64()` | `mongo/int64@1` | `long` | `bigint` |
| `Int64Number` | `field.int64Number()` | `mongo/int64Number@1` | `long` | `number` (safe-integer range) |
| `Double` | `field.double()` | `mongo/double@1` | `double` | `number` |
| `Decimal128` | `field.decimal128()` | `mongo/decimal128@1` | `decimal` | `string` (decimal text without an exponent; a stored value with an extreme exponent such as `1E-6176` reads back as a digit string of about 6,100 characters) |
| `Bool` | `field.bool()` | `mongo/bool@1` | `bool` | `boolean` |
| `Date` | `field.date()` | `mongo/date@1` | `date` | `Date` |
| `ObjectId` | `field.objectId()` | `mongo/objectId@1` | `objectId` | `string` (hex) |
| `Binary` | `field.binary()` | `mongo/binary@1` | `binData` | `Uint8Array` |
| `Json` | `field.json()` | `mongo/json@1` | `object`, `array`, `string`, `double`, `int`, `long`, `bool` or `null` | `JsonValue` |
| `Bson` | `field.bson()` | `mongo/bson@1` | any BSON type; the validator does not constrain it (a list field must still be an array) | `BsonValue` |
| — | `field.vector()` | `mongo/vector@1` | `vector` | `readonly number[]` |

`Json` holds a JSON value and nothing else: writing or reading a `Date`, `ObjectId`, `Decimal128`, `Binary` or other non-JSON BSON value inside it fails with the path of the value. `Bson` holds any BSON value, `Code`, `MinKey`, `MaxKey` and `BSONSymbol` included, and reads it back as the driver produces it: a stored regex as a native `RegExp` (a `BSONRegExp` appears only with a driver configured with `bsonRegExp: true`), and a `{ $ref, $id }` subdocument, which the driver reads as a `DBRef`, as that document. A write also accepts a `Uint8Array` or `Buffer`, stored as binData and read back as `Binary`, and refuses anything else outside `BsonValue` (a `Map`, `Set`, class instance, other typed array, or sparse-array hole) with its path. `BsonValue` and the write type `BsonInputValue` are exported from `@prisma/orm-mongo/target/codec-types`. `Bson` returns numbers as the driver reads them: a stored `long` in the safe-integer range and an integral `double` read back as a JavaScript `number`, and writing that `number` back stores a BSON `int` when it fits in 32 bits. Wrap a value in `Long` or `Double` to keep its BSON type across a read and a write.

To find documents whose `Json` field holds a value `Json` refuses, before declaring the field `Json` on existing data or after other code has written to it, query the collection:

```js
db.<collection>.find({
  $or: [
    { <field>: { $exists: true, $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } },
    { <field>: { $elemMatch: { $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } } },
    { <field>: { $type: 'long', $gt: 9007199254740991 } },
    { <field>: { $type: 'long', $lt: -9007199254740991 } },
    { <field>: { $in: [NaN, Infinity, -Infinity] } },
  ],
})
```

The first clause checks the field's own value, and the second checks each element of the field when the value is an array. The last three clauses, for a `long` outside the safe-integer range and for `NaN` or an infinite `double`, match at both of those levels. The query misses exactly the values nested deeper: inside an object, inside an array of objects, or inside an array of arrays. Reading every document through the ORM finds those too, because the read fails with the path of the first such value. Change a field whose documents hold such values to `Bson`.

A `temporal.*` preset field added to a collection that already has documents needs a backfill; see [Execution defaults](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md#execution-defaults).

The collection validator is derived from the contract only when the contract is written in Prisma 8 PSL. A contract built with the TypeScript builder or read from a Prisma 6 schema (`prisma6Schema`) gets no validator, so there the codecs' checks on read and write are the only ones.

The PSL names `Int`, `Float`, `Boolean` and `DateTime` are deprecated aliases of `Int32`, `Double`, `Bool` and `Date`; they report `PSL_DEPRECATED_SCALAR_NAME` as a warning and will be removed.

Two limitations to know about:

- `Binary` reads every binData subtype back as its bytes and writes subtype 0, so a UUID stored as subtype 4 round-trips as subtype 0. Use `Bson` to keep the subtype.
- `field.temporal.timestamp(undefined, 'now')` sets an update default only, and TypeScript infers both phases as optional, so its update default is typed as possibly absent. `field.temporal.timestamp()` and `field.temporal.timestamp('now', 'now')` are typed exactly.

### Values through the Mongo ORM

- A whole number written to a `Double` field is stored as a BSON `double`, not an `int`, so `$type: 'double'` matches it. An `Int32` field refuses a fraction or a number outside the signed 32-bit range with `RUNTIME.ENCODE_FAILED`.
- The update operations `inc` and `mul` exist on required single-valued `Int32`, `Double`, `Int64` and `Decimal128` fields and take the field's write type: a `number`, a `bigint` for `Int64` (`u.karma.inc(2n)`), and decimal text for `Decimal128` (`u.balance.inc('0.5')`).
- A list field is encoded element by element through its element codec, so an `ObjectId[]` field stores hex strings as `ObjectId`s and an `Int64[]` field stores `bigint`s as `long`s.
- `create()` and `createAll()` return each document as stored, decoded as a read decodes it. The ORM computes it from the document it sent, without a second query: a `Bson` field comes back as a read returns it, and a nullable field left out comes back as `null`.
- A nullable field missing from a stored document reads as `null`, the same as one that holds `null`.
- A `MongoFieldFilter` passed to the ORM's `where()` compares the field's application value, encoded through the field's codec as the object form of `where()` is: a hex string or an `ObjectId` for an `ObjectId` field, a `bigint` for an `Int64` field. A value that is not a `MongoValue`, such as a `bigint` or an `ObjectId`, goes in a `MongoParamRef`: `MongoFieldFilter.gt('views', new MongoParamRef(5n))`. The query builder's `match()` does not know the field's codec and sends values as given, so compare there with the driver's classes, such as `new MongoParamRef(new ObjectId(hex))`.
- Each codec refuses a value of the wrong type with `RUNTIME.ENCODE_FAILED` naming the field, a list element included: a `null` in a `String[]` list, a string for a `Bool` field, an invalid `Date`, or anything but a 24-digit hex string or an `ObjectId` for an `ObjectId` field.
- A write refuses a value outside the field's enum and `null` for a field that is not nullable, with `RUNTIME.ENCODE_FAILED` naming the field. A filter accepts both, so it can find documents that hold one.

## PostgreSQL

These are the current names. The Postgres and SQLite rename project will change several of them to the target's own type names and update this table.

| PSL name | TS helper | Codec id | Storage type | Application type |
| --- | --- | --- | --- | --- |
| `String` | `field.text()` | `pg/text@1` | `text` | `string` |
| `VarChar(n?)` | — | `sql/varchar@1` | `character varying` | `string` |
| `Char(n?)` | — | `sql/char@1` | `character` | `string` |
| `Boolean` | `field.boolean()` | `pg/bool@1` | `bool` | `boolean` |
| `SmallInt` | — | `pg/int2@1` | `int2` | `number` |
| `Int` | `field.int()` | `pg/int4@1` | `int4` | `number` |
| `BigInt` | `field.bigint()` | `pg/int8@1` | `int8` | `bigint` |
| `BigIntNumber` | — | `pg/int8number@1` | `int8` | `number` (safe-integer range) |
| `UnboundedInt` | — | `pg/unboundedint@1` | `numeric` | `bigint` |
| `Real` | — | `pg/float4@1` | `float4` | `number` |
| `Float` | `field.float()` | `pg/float8@1` | `float8` | `number` |
| `Decimal`, `Numeric(p?, s?)` | `field.decimal()` | `pg/numeric@1` | `numeric` | `string` (decimal text) |
| `DateTime`, `Timestamptz(p?)` | `field.dateTime()` | `pg/timestamptz-temporal@1` | `timestamptz` | `Temporal.Instant` |
| `TimestamptzJsDate(p?)` | — | `pg/timestamptz-date@1` | `timestamptz` | `Date` |
| `TimestamptzString(p?)` | — | `pg/timestamptz-string@1` | `timestamptz` | `string` |
| `Timestamp(p?)` | — | `pg/timestamp-temporal@1` | `timestamp` | `Temporal.PlainDateTime` |
| `TimestampString(p?)` | — | `pg/timestamp-string@1` | `timestamp` | `string` |
| `Date` | — | `pg/date-temporal@1` | `date` | `Temporal.PlainDate` |
| `DateString` | — | `pg/date-string@1` | `date` | `string` |
| `Time(p?)` | — | `pg/time-temporal@1` | `time` | `Temporal.PlainTime` |
| `TimeString(p?)` | — | `pg/time-string@1` | `time` | `string` |
| `Timetz(p?)` | — | `pg/timetz@1` | `timetz` | `string` |
| `Uuid` | `field.uuidNative()` | `pg/uuid@1` | `uuid` | `string` |
| `Inet` | — | `pg/inet@1` | `inet` | `string` |
| `Json` | — | `pg/json@1` | `json` | `JsonValue` |
| `Jsonb` | `field.json()` | `pg/jsonb@1` | `jsonb` | `JsonValue` |
| `Bytes` | `field.bytes()` | `pg/bytea@1` | `bytea` | `Uint8Array` |
| `pg.enum(Name)` | — | `pg/enum@1` | the native enum type | `string` |

A literal default of a date or time type is stored in the type's canonical form, whichever codec the column uses and however the default was written; [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#date-and-time-types) states each form.

## SQLite

These are the current names; the Postgres and SQLite rename project will update this table. SQLite has no scalar TS helpers; use `field.column(...)`.

| PSL name | TS helper | Codec id | Storage type | Application type |
| --- | --- | --- | --- | --- |
| `String` | — | `sqlite/text@1` | `text` | `string` |
| `Int` | — | `sqlite/integer@1` | `integer` | `number` |
| `BigInt` | — | `sqlite/bigint@1` | `integer` | `bigint` |
| `BigIntNumber` | — | `sqlite/bigintnumber@1` | `integer` | `number` (safe-integer range) |
| `Float` | — | `sqlite/real@1` | `real` | `number` |
| `Decimal` | — | `sqlite/text@1` | `text` | `string` |
| `DateTime` | — | `sqlite/datetime@1` | `text` | `Date` |
| `Json` | — | `sqlite/json@1` | `text` | `JsonValue` |
| `Bytes` | — | `sqlite/blob@1` | `blob` | `Uint8Array` |

A `DateTime` default is stored in the canonical form of `sqlite/datetime`, however it was written; [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#date-and-time-types) states the form and the text it takes.

## Across targets

The PSL name on each target for a concept, and the Prisma 6/7 name a migrating schema uses. A dash means the target has no scalar type for the concept.

| Concept | Prisma 6/7 name | PostgreSQL | SQLite | MongoDB |
| --- | --- | --- | --- | --- |
| 32-bit integer | `Int` (on MongoDB, `Int @db.Int`) | `Int` | — (`Int` stores a 64-bit `integer`) | `Int32` |
| 64-bit integer | `BigInt` | `BigInt` | `BigInt` | `Int64` |
| 64-bit integer read as a `number` | `Int` on MongoDB, which Prisma 6 stores as a BSON long | `BigIntNumber` | `BigIntNumber` | `Int64Number` |
| double | `Float` | `Float` | `Float` | `Double` |
| decimal | `Decimal` | `Decimal`, `Numeric(p?, s?)` | `Decimal` (stored as text) | `Decimal128` |
| boolean | `Boolean` | `Boolean` | — | `Bool` |
| timestamp | `DateTime` | `DateTime`, `Timestamptz(p?)` | `DateTime` | `Date` |
| text | `String` | `String` | `String` | `String` |
| bytes | `Bytes` | `Bytes` | `Bytes` | `Binary` |
| JSON | `Json` | `Json`, `Jsonb` | `Json` | `Json` |
| any value | — | — | — | `Bson` |
| ObjectId | `String @db.ObjectId` (MongoDB) | — | — | `ObjectId` |

A Prisma 6 MongoDB schema read with `prisma6Schema` may keep its native types. Each native type Prisma 6.19 accepts gives the field the MongoDB type of what Prisma 6 stores: `Int @db.Int` is `Int32`, `Int @db.Long` is `Int64Number` like a plain `Int`, `BigInt @db.Long` is `Int64`, `Bytes @db.ObjectId` is `ObjectId`, and `@db.String`, `@db.Bool`, `@db.Double`, `@db.Date`, `@db.BinData` and `@db.Json` are the same type as the plain field. `DateTime @db.Timestamp` stores a BSON timestamp, which no MongoDB scalar type holds, so `prisma6Schema` refuses it.

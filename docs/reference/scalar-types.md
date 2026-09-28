# Scalar types

Each target names its scalar types after what the database stores. This page lists every scalar type per target, then maps the types across targets by concept, with the Prisma 6/7 name for readers migrating a schema. Other docs link here rather than repeat the lists.

Columns: the PSL name, the TypeScript builder helper (inside the `defineContract` callback), the codec id recorded in `contract.json`, the storage type, and the application type a query reads and writes.

## MongoDB

| PSL name | TS helper | Codec id | Storage type (BSON) | Application type |
| --- | --- | --- | --- | --- |
| `String` | `field.string()` | `mongo/string@1` | `string` | `string` |
| `Int32` | `field.int32()` | `mongo/int32@1` | `int` | `number` |
| `Int64` | `field.int64()` | `mongo/int64@1` | `long` | `bigint` |
| `Double` | `field.double()` | `mongo/double@1` | `double` | `number` |
| `Decimal128` | `field.decimal128()` | `mongo/decimal128@1` | `decimal` | `string` (decimal text without an exponent) |
| `Bool` | `field.bool()` | `mongo/bool@1` | `bool` | `boolean` |
| `Date` | `field.date()` | `mongo/date@1` | `date` | `Date` |
| `ObjectId` | `field.objectId()` | `mongo/objectId@1` | `objectId` | `string` (hex) |
| `Binary` | `field.binary()` | `mongo/binary@1` | `binData` | `Uint8Array` |
| `Json` | `field.json()` | `mongo/json@1` | `object`, `array`, `string`, `double`, `int`, `long`, `bool` or `null` | `JsonValue` |
| `Bson` | `field.bson()` | `mongo/bson@1` | any BSON type; the validator does not constrain it (a list field must still be an array) | `BsonValue` |
| — | `field.vector()` | `mongo/vector@1` | `vector` | `readonly number[]` |

`Json` holds a JSON value and nothing else: writing or reading a `Date`, `ObjectId`, `Decimal128`, `Binary` or other non-JSON BSON value inside it fails with the path of the value. `Bson` holds any BSON value, `Code`, `MinKey`, `MaxKey` and `BSONSymbol` included, and reads it back as the driver produces it: a stored regex as a native `RegExp` (a `BSONRegExp` appears only with a driver configured with `bsonRegExp: true`), and a `{ $ref, $id }` subdocument, which the driver reads as a `DBRef`, as that document. A write also accepts a `Uint8Array` or `Buffer`, stored as binData and read back as `Binary`, and refuses anything else outside `BsonValue` (a `Map`, `Set`, class instance, other typed array, or sparse-array hole) with its path. `BsonValue` and the write type `BsonInputValue` are exported from `@prisma/orm-mongo/target/codec-types`. `Bson` returns numbers as the driver reads them: a stored `long` in the safe-integer range and an integral `double` read back as a JavaScript `number`, and writing that `number` back stores a BSON `int` when it fits in 32 bits. Wrap a value in `Long` or `Double` to keep its BSON type across a read and a write.

The collection validator is derived from the contract only when the contract is written in Prisma 8 PSL. A contract built with the TypeScript builder or read from a Prisma 6 schema (`prisma6Schema`) gets no validator, so there the codecs' checks on read and write are the only ones.

The PSL names `Int`, `Float`, `Boolean` and `DateTime` are deprecated aliases of `Int32`, `Double`, `Bool` and `Date`; they report `PSL_DEPRECATED_SCALAR_NAME` as a warning and will be removed.

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

## Across targets

The PSL name on each target for a concept, and the Prisma 6/7 name a migrating schema uses. A dash means the target has no scalar type for the concept.

| Concept | Prisma 6/7 name | PostgreSQL | SQLite | MongoDB |
| --- | --- | --- | --- | --- |
| 32-bit integer | `Int` | `Int` | — (`Int` stores a 64-bit `integer`) | `Int32` |
| 64-bit integer | `BigInt` | `BigInt` | `BigInt` | `Int64` |
| double | `Float` | `Float` | `Float` | `Double` |
| decimal | `Decimal` | `Decimal`, `Numeric(p?, s?)` | `Decimal` (stored as text) | `Decimal128` |
| boolean | `Boolean` | `Boolean` | — | `Bool` |
| timestamp | `DateTime` | `DateTime`, `Timestamptz(p?)` | `DateTime` | `Date` |
| text | `String` | `String` | `String` | `String` |
| bytes | `Bytes` | `Bytes` | `Bytes` | `Binary` |
| JSON | `Json` | `Json`, `Jsonb` | `Json` | `Json` |
| any value | — | — | — | `Bson` |
| ObjectId | `String @db.ObjectId` (MongoDB) | — | — | `ObjectId` |

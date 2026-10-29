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
| — | `field.vector()` | `mongo/vector@1` | `array` | `readonly number[]` |

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

A field the ORM fills, such as `temporal.CreatedAt` or `Date @onCreate(now())`, added to a collection that already has documents needs a backfill; see [Execution defaults](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md#execution-defaults).

A contract written in Prisma 8 PSL and one built with the TypeScript builder get the same collection validator, derived from the contract. A contract read from a Prisma 6 schema (`prisma6Schema`) gets no validator, so there the codecs' checks on read and write are the only ones.

The PSL names `Int`, `Float`, `Boolean` and `DateTime` are deprecated aliases of `Int32`, `Double`, `Bool` and `Date`; they report `PSL_DEPRECATED_SCALAR_NAME` as a warning and will be removed.

One limitation to know about:

- `Binary` reads every binData subtype back as its bytes and writes subtype 0, so a UUID stored as subtype 4 round-trips as subtype 0. Use `Bson` to keep the subtype.

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

The date and time types have two layers ([ADR 279](../architecture%20docs/adrs/ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md)). Each explicit type in the table below names one column type and one kind of value. The convenience types `DateTime`, `Date`, `Time` and `Duration` are named for what a field means, and each becomes one explicit type, chosen by its optional `as` and `storage` arguments: `as` is the value the application reads, and `storage` is the database type that stores it; `precision` is passed on to the explicit type. The contract stores only the explicit type, so `DateTime(as: temporal)` and `TimestamptzTemporal` emit the same contract.

| Convenience type | `as` | `storage` | Becomes |
| --- | --- | --- | --- |
| `DateTime(as?, storage?, precision?)` | `jsDate` (default) | `timestamptz` (default) | `TimestamptzJsDate`, precision 3 unless written |
| | `temporal` | `timestamptz` | `TimestamptzTemporal` |
| | `string` | `timestamptz` | `TimestamptzString` |
| | `jsDate` | `timestamp` | `TimestampJsDate`, precision 3 unless written |
| | `temporal` | `timestamp` | `TimestampInstant` |
| | `string` | `timestamp` | `TimestampString` |
| `Date(as?, storage?)` | `string` (default) | `date` (default) | `DateString` |
| | `temporal` | `date` | `DateTemporal` |
| `Time(as?, storage?, precision?)` | `string` (default) | `time` (default) | `TimeString` |
| | `temporal` | `time` | `TimeTemporal` |
| | `string` | `timetz` | `Timetz` |
| `Duration(as?, storage?, precision?)` | `string` (default) | `interval` (default) | `IntervalString` |
| | `parts` | `interval` | `IntervalParts` |

The arguments are written as bare names, by name or in this order: `DateTime(as: string, precision: 6)`, `DateTime(temporal, timestamp)`. A combination the table does not list, such as `Time(as: temporal, storage: timetz)` or `Date(as: jsDate)`, is refused at the argument that makes it invalid, naming the values it accepts; so is a `precision` the chosen type does not take. No default needs a global `Temporal`. In a TypeScript contract the helpers take the same arguments as one object, `type.DateTime({ as: 'string', precision: 6 })`, and are typed as the explicit type they choose; a combination the table does not list, or an argument the chosen type does not take, does not compile. An options object kept in a variable needs `as const`, so each option keeps its literal value: `const options = { as: 'string' } as const; type.DateTime(options)`.

| PSL name | TS helper | Codec id | Storage type | Application type |
| --- | --- | --- | --- | --- |
| `String` | `field.column(type.String())` | `pg/text@1` | `text` | `string` |
| `VarChar(n?)`, `sql.String(n)` | `field.column(type.VarChar(n))` | `sql/varchar@1` | `character varying` | `string` |
| `Char(n?)`, `sql.Char(n)` | `field.column(type.Char(n))` | `sql/char@1` | `character` | `string` |
| `Boolean` | `field.column(type.Boolean())` | `pg/bool@1` | `bool` | `boolean` |
| `SmallInt` | — | `pg/int2@1` | `int2` | `number` |
| `Int` | `field.column(type.Int())` | `pg/int4@1` | `int4` | `number` |
| `BigInt` | `field.column(type.BigInt())` | `pg/int8@1` | `int8` | `bigint` |
| `BigIntNumber` | — | `pg/int8number@1` | `int8` | `number` (safe-integer range) |
| `UnboundedInt` | — | `pg/unboundedint@1` | `numeric` | `bigint` |
| `Real` | — | `pg/float4@1` | `float4` | `number` |
| `Float` | `field.column(type.Float())` | `pg/float8@1` | `float8` | `number` |
| `Decimal`, `Numeric(p?, s?)` | `field.column(type.Decimal())` | `pg/numeric@1` | `numeric` | `string` (decimal text) |
| `TimestamptzTemporal(p?)` | `field.column(type.TimestamptzTemporal())` | `pg/timestamptz-temporal@1` | `timestamptz` | `Temporal.Instant` |
| `TimestamptzJsDate(p?)` | — | `pg/timestamptz-date@1` | `timestamptz` | `Date` |
| `TimestamptzString(p?)` | — | `pg/timestamptz-string@1` | `timestamptz` | `string` (ISO 8601) |
| `TimestampTemporal(p?)` | — | `pg/timestamp-temporal@1` | `timestamp` | `Temporal.PlainDateTime` |
| `TimestampString(p?)` | — | `pg/timestamp-string@1` | `timestamp` | `string` (ISO 8601) |
| `TimestampJsDate(p?)` | — | `pg/timestamp-date@1` | `timestamp` | `Date`, the stored date and time read as UTC |
| `TimestampInstant(p?)` | — | `pg/timestamp-instant@1` | `timestamp` | `Temporal.Instant`, the stored date and time read as UTC |
| `DateTemporal` | — | `pg/date-temporal@1` | `date` | `Temporal.PlainDate` |
| `DateString` | — | `pg/date-string@1` | `date` | `string` (ISO 8601) |
| `TimeTemporal(p?)` | — | `pg/time-temporal@1` | `time` | `Temporal.PlainTime` |
| `TimeString(p?)` | — | `pg/time-string@1` | `time` | `string` (ISO 8601) |
| `Timetz(p?)` | — | `pg/timetz@1` | `timetz` | `string` (ISO 8601) |
| `Uuid` | `field.column(type.Uuid())` | `pg/uuid@1` | `uuid` | `string` |
| `Inet` | — | `pg/inet@1` | `inet` | `string` |
| `IntervalParts(p?)` | — | `pg/interval@1` | `interval` | `{ months: number; days: number; micros: bigint }` |
| `IntervalString(p?)` | — | `pg/interval-string@1` | `interval` | `string`, the ISO 8601 duration, such as `P1Y2M` |
| `Bit(n?)` | — | `pg/bit@1` | `bit` | `string` (the bits as `0` and `1`) |
| `VarBit(n?)` | — | `pg/varbit@1` | `bit varying` | `string` (the bits as `0` and `1`) |
| `Json` | — | `pg/json@1` | `json` | `JsonValue` |
| `Jsonb` | `field.column(type.Jsonb())` | `pg/jsonb@1` | `jsonb` | `JsonValue` |
| `Bytes` | `field.column(type.Bytes())` | `pg/bytea@1` | `bytea` | `Uint8Array` |
| `pg.enum(Name)` | — | `pg/enum@1` | the native enum type | `string` |

`TimestampJsDate` and `TimestampInstant` read the date and time a `timestamp` column stores as UTC, and write a value's UTC date and time with no offset, so a value the application writes reads back as the same instant whatever the time zone of the server, the session or the application. A database default is different: PostgreSQL fills a `timestamp` column's `@default(now())` in the session's time zone, so on a server whose `TimeZone` is not UTC that value reads back shifted by the zone's offset. `@onCreate(now())` writes the client's time in UTC and reads back unshifted. On a column read as a `Date` with a precision below 3, `now()` is rounded down to that precision, so the client holds the value the column stores. A `Date` holds milliseconds, so on a `TimestampJsDate` column with a precision above 3 a read drops the extra digits, and an equality filter with a value read back misses a row stored with microseconds. Use `TimestampInstant` or `TimestampString` to keep them. They refuse `infinity`, `-infinity` and a value after `+275760-09-13T00:00:00`, which no `Date` or `Temporal.Instant` holds, and name `TimestampString`, which holds them. `IntervalString` reads every `IntervalStyle` and writes an ISO 8601 duration; it refuses any other text on write.

A literal default of a date, time, interval or bytes type is written with the tag of its type, as in `@default(timestamptz`2024-01-01T00:00:00Z`)` or `@default(bytea`\x0102`)`; a quoted string is refused with a message that shows the tag. It is stored in the one form its data type stores, whichever codec the column uses and however the default was written, and a default with more fraction digits or more scale than its column holds is refused rather than rounded; [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#date-and-time-types) states each form.

The tools that write a schema for you write the convenience types, with only the arguments that differ from the defaults, and the explicit type only where no convenience call becomes it, such as `TimestampTemporal` for a `timestamp` read as `Temporal.PlainDateTime`.

- `prisma orm init` writes `createdAt DateTime @default(now()) @onCreate(now())` and `updatedAt temporal.UpdatedAt` in a PSL schema, and `field.column(type.DateTime()).default(now()).onCreate(gen.now())` and `field.column(type.temporal.UpdatedAt())` in a TypeScript contract.
- `prisma contract infer` takes the default path for each column: a `timestamptz(3)` column is `DateTime`, a `timestamp(3)` column `DateTime(storage: timestamp)`, a `date` column `Date`, a `time(0)` column `Time(precision: 0)`, a `timetz` column `Time(storage: timetz)` and an `interval` column `Duration`. A column with no declared precision holds microseconds, as precision 6 does, so a `timestamptz` column is `DateTime(precision: 6)`; `db verify` and the migration planner count an omitted precision on a date or time column as 6. A `Date` holds milliseconds, so a timestamp column with more digits reads with them dropped, and a timestamp default with digits below a millisecond is written as its raw `sql` expression. To keep the digits, change the field to `DateTime(as: temporal)` or `DateTime(as: string)`. When the default-path type cannot read the column's own default as a row at all, as a `Date` cannot read `infinity` or `-infinity`, infer writes the first row, in the order the convenience type declares its rows, of the same storage whose type can, which for those values is `as: string`: a `timestamp(3)` column with `DEFAULT 'infinity'` is ``DateTime(as: string, storage: timestamp, precision: 3) @default(timestamp`infinity`)``. Infer reads only the default, not the rows: a row that stores `infinity` or `-infinity` in a column read as a `Date` fails to read with `RUNTIME.DECODE_FAILED`, so add `as: string` to such a field and keep its other arguments, such as `DateTime(as: string, storage: timestamp, precision: 3)` for a `timestamp(3)` column; `as: temporal` cannot hold those values either.
- `prisma contract print` writes each column as the convenience call that becomes its explicit type exactly, such as `DateTime(as: temporal)` for `TimestamptzTemporal`, and otherwise the explicit type.
- `prisma7Schema(...)` reads Prisma 7's `DateTime` as `TimestampJsDate(3)`, a `timestamp(3)` column read as a `Date` as Prisma 7 read it, printed `DateTime(storage: timestamp)`, and `@db.Timestamptz(p)` as `TimestamptzJsDate(p)`.

On a column read as a `Date` (`TimestamptzJsDate`, `TimestampJsDate`, and `DateTime` at its default), a default with digits below a millisecond is refused: write it with a string or `Temporal` type, or as a `sql` expression. A TypeScript contract cannot write one, because its `.default()` takes a `Date`. `db verify` compares a default on such a column as the application reads it, so it does not see a difference smaller than a millisecond.

`temporal.CreatedAt` is `DateTime @onCreate(now())` and `temporal.UpdatedAt` is `DateTime @onCreate(now()) @onUpdate(now())`. Five types read and write `Temporal` values: `TimestamptzTemporal`, `TimestampTemporal`, `TimestampInstant`, `DateTemporal` and `TimeTemporal`, which the convenience types choose with `as: temporal`. Their TypeScript types come from `temporal-spec`, so a project needs no global `Temporal` declarations to type them. An application that uses them needs a global `Temporal`: on a runtime without one, such as Node.js 24, install it, for example with `import 'temporal-polyfill/full/global'`.

A text date or time type reads and writes ISO 8601, the form its data type stores: `TimestamptzString` reads `2024-01-01T00:00:00Z`, the instant in UTC, whatever the session's time zone; `TimestampString` reads `2024-01-01T12:34:56.5`; `DateString` reads `2024-01-01`; `TimeString` reads `12:34:56`; and `Timetz` reads `12:34:56+02:00`, or `12:34:56Z` for a zero offset. A year before 1 or after 9999 is a sign and six digits, as in `-000043-03-15` for 44 BC. `infinity` and `-infinity` read as those words. A value PostgreSQL holds beyond the range of the `Temporal` and `Date` types reads in the same shape: the time `24:00:00`, and a date with a seven-digit year, such as `+5874897-12-31`. A value written in another form PostgreSQL reads is stored as the value it names and reads back in ISO 8601: `2024-01-01 01:00:00+01` written to a `TimestamptzString` column reads back as `2024-01-01T00:00:00Z`; a literal default or enum member must be written in the stored form.

PostgreSQL prints a date or timestamp in the connection's `DateStyle`. The PostgreSQL target requires `DateStyle=ISO` on every session, and the PostgreSQL driver ensures it on every connection it uses: it starts each connection it opens with `DateStyle=ISO` as a startup option, after any `options` the URL or `PGOPTIONS` gives, which a `RESET ALL` keeps; on a `pg.Pool` or `pg.Client` you pass to Prisma, it sets `DateStyle=ISO` on each connection before first use, and again after a connection held for a transaction, an ORM operation or a Supabase role scope is released, one statement each time. When the driver could not ensure it, because a statement set a `DateStyle` other than `ISO` on a connection Prisma uses or a connection pooler dropped the startup option, every date and time codec that reads a date or timestamp, text, `Temporal` or `Date`, fails with `RUNTIME.DATE_STYLE_NOT_ISO`. Behind a connection pooler that refuses startup options, pass Prisma your own `pg.Pool`, which the driver sets with a statement instead; behind one that runs each statement on another server connection, also set `DateStyle=ISO` on the role or database (`ALTER ROLE <role> SET DateStyle = 'ISO'`).

## SQLite

These are the current names; the Postgres and SQLite rename project will update this table. Write a TypeScript field as `field.column(type.X())` with the type of the PSL name, such as `field.column(type.DateTime())`, or `field.column(...)` with a column type from `adapter/column-types`. `sql.String(n)` and `sql.Char(n)` exist on every SQL target; SQLite accepts their length and does not enforce it.

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
| `sql.String(n)` | `field.column(type.sql.String(n))` | `sql/varchar@1` | `character varying` | `string` |
| `sql.Char(n)` | `field.column(type.sql.Char(n))` | `sql/char@1` | `character` | `string` |

A `DateTime` default is written with the `datetime` tag, as in `@default(datetime`2024-01-01T00:00:00Z`)`, and a `Json` default with the `json` tag. A `DateTime` column has the data type `sqlite/datetime` and a `Json` column `sqlite/json`, both stored as `text`. A `DateTime` default is stored as the instant in UTC with three fraction digits, the text every row holds, however it was written; [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#date-and-time-types) states the form and the text it takes.

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
| timestamp | `DateTime` | `DateTime` (a `TimestamptzJsDate(3)`) | `DateTime` | `Date` |
| text | `String` | `String` | `String` | `String` |
| bytes | `Bytes` | `Bytes` | `Bytes` | `Binary` |
| JSON | `Json` | `Json`, `Jsonb` | `Json` | `Json` |
| any value | — | — | — | `Bson` |
| ObjectId | `String @db.ObjectId` (MongoDB) | — | — | `ObjectId` |

A Prisma 6 MongoDB schema read with `prisma6Schema` may keep its native types. Each native type Prisma 6.19 accepts gives the field the MongoDB type of what Prisma 6 stores: `Int @db.Int` is `Int32`, `Int @db.Long` is `Int64Number` like a plain `Int`, `BigInt @db.Long` is `Int64`, `Bytes @db.ObjectId` is `ObjectId`, and `@db.String`, `@db.Bool`, `@db.Double`, `@db.Date`, `@db.BinData` and `@db.Json` are the same type as the plain field. `DateTime @db.Timestamp` stores a BSON timestamp, which no MongoDB scalar type holds, so `prisma6Schema` refuses it.

A Prisma 7 PostgreSQL schema read with `prisma7Schema`, or a database Prisma 7 created and `contract infer` reads, gets `TimestampJsDate(3)` for `DateTime`, written `DateTime(storage: timestamp)`, and `TimestampJsDate(p)`, `TimestamptzJsDate(p)`, `DateString`, `TimeString(p)` and `Timetz(p)` for `@db.Timestamp`, `@db.Timestamptz`, `@db.Date`, `@db.Time` and `@db.Timetz`, so a `DateTime` field still reads a JavaScript `Date`. The PostgreSQL cell above is what a new Prisma 8 schema writes for the concept.

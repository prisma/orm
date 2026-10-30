# Slice 4: MongoDB's convenience date and time types

Project spec: [../spec.md](../spec.md). Needs slice 1 (`@internal/type-implementations`) and slice 3 (the MongoDB builder's `type.*`).

## Outcome

```prisma
model Order {
  id        ObjectId @id @map("_id")
  paidAt    DateTime                 // exactly DateJsDate: a BSON date read as a JavaScript Date (mongo/date@1, today's Date)
  settledAt DateTime(as: temporal)   // exactly DateInstant: a BSON date read as Temporal.Instant
  shipBy    Date                     // exactly DateString: a BSON date at midnight UTC, read as "2024-02-29"
  opensAt   Time                     // exactly TimeString: a BSON string "09:30:00.000"
  lasts     Duration                 // exactly DurationString: a BSON string "PT1H30M"
}
```

```ts
paidAt: field.scalar(type.DateTime()),
shipBy: field.scalar(type.Date({ as: 'temporal' })),
```

## The table

| Convenience type | `as` | `storage` | Explicit type | Codec | BSON | Value |
| --- | --- | --- | --- | --- | --- | --- |
| `DateTime` | `jsDate` (default) | `date` | `DateJsDate` | `mongo/date@1` (today's) | date | `Date` |
| | `temporal` | `date` | `DateInstant` | `mongo/date-instant@1` | date | `Temporal.Instant` |
| | `string` | `date` | `DateInstantString` | `mongo/date-instant-string@1` | date | ISO 8601 instant in UTC, three fraction digits |
| `Date` | `string` (default) | `date` | `DateString` | `mongo/date-string@1` | date at midnight UTC | `"2024-02-29"` |
| | `temporal` | `date` | `DateTemporal` | `mongo/date-temporal@1` | date at midnight UTC | `Temporal.PlainDate` |
| `Time` | `string` (default) | `string` | `TimeString` | `mongo/time-string@1` | string | `"09:30:00.000"` |
| | `temporal` | `string` | `TimeTemporal` | `mongo/time-temporal@1` | string | `Temporal.PlainTime` |
| `Duration` | `string` | `string` | `DurationString` | `mongo/duration-string@1` | string | ISO 8601 duration, as written |

## Decisions

- **`Date` changes concept at once.** Today `Date` is `mongo/date@1`, a moment in time. It becomes the calendar date. `DateTime`, deprecated today, becomes the convenience type whose default is today's `Date`, renamed `DateJsDate`, so `createdAt DateTime` emits today's contract. The upgrade instruction rewrites `Date` to `DateTime` in MongoDB schemas and `type.Date()` to `type.DateTime()` in TypeScript contracts, with a script. A missed rewrite fails on the first read of a value with a time of day: the calendar codecs refuse a BSON date not at midnight UTC, naming the field.
- **A calendar date is a BSON date at midnight UTC,** the form MongoDB's Java (`LocalDateCodec`) and C# (`DateOnlySerializer`) drivers write and Prisma 6's `DateTime @db.Date` stored. The collection validator stays `bsonType: 'date'`.
- **`Time` and `Duration` are BSON strings,** with new data types `mongo/time` and `mongo/duration` (`bsonTypes: ['string']`), text forms as on SQLite: three fraction digits for a time; a duration as written.
- **Writes** refuse digits below a millisecond rather than round, as on SQLite; a Temporal value of the wrong kind or a non-ISO calendar is refused naming the codec.
- **`now()`:** `@onCreate`/`@onUpdate(now())` generators for every new codec, from `@internal/type-implementations`. MongoDB has no database defaults.
- **`temporal.CreatedAt` and `temporal.UpdatedAt`** are `DateTime`.
- **Temporal fallback:** the MongoDB target's control entry sets it; `temporal-polyfill` becomes a required peer of `@prisma/orm-mongo` and `@prisma/orm-target-mongo`; application entries do not load it (published-entry test through `@repo/test-utils/temporal-fallback-entries`).
- **Prisma 6 reader:** `DateTime @db.Date` maps to `mongo/date-string@1`; plain `DateTime` stays `mongo/date@1`.
- **Removed preset row:** `temporal.timestamp` in `packages/2-mongo-family/2-authoring/contract-psl/src/removed-field-presets.ts` is written as `DateTime`.
- **Every MongoDB schema, fixture and example** that writes `Date` for an instant is rewritten to `DateTime`; contracts emit unchanged.

## Tests

- Unit tests per codec, data type, tag and generator; type-level tests for `type.DateTime({ as: 'temporal' })` and a combination with no row; the facade's no-`Temporal`-global typecheck.
- Integration against `mongod`: write and read every row, `now()` read-back, a calendar codec refusing a non-midnight date with an error naming the field, the same with no global `Temporal` in a child process (copy `test/integration/test/convenience-date-time-types/sqlite-without-temporal.e2e.test.ts`).
- The upgrade script rewrites a fixture schema and TypeScript contract, and the result emits the original contract.
- `examples/mongo-demo` gains `Date` and `Time` fields, written and read in its test.

## Docs (orchestrator)

ADR 315's MongoDB section and "Not decided here", ADR 279, ADR 257 (the `Date` rename), ADR 254 (the new data types), `docs/reference/scalar-types.md`'s MongoDB section and cross-target table, the error reference, the `prisma-8` skill, the MongoDB family subsystem doc, and the upgrade-instructions fragment's prose.

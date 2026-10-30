# ADR 315 — Each target declares the convenience date and time types over its own explicit types

**Status:** Accepted
**Builds on:** [ADR 279 — Convenience types choose an explicit type from their arguments](ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md), [ADR 257 — Scalar types are named after the target on every surface](ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md), [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md)

## At a glance

```prisma
// SQLite
model Event {
  id      Int      @id
  at      DateTime                 // exactly DatetimeJsDate: TEXT read as a JavaScript Date
  exactAt DateTime(as: temporal)   // exactly DatetimeTemporal: Temporal.Instant
  day     Date                     // exactly DateString: "2024-02-29"
  opensAt Time                     // exactly TimeString: "09:30:00.000"
  lasts   Duration                 // exactly DurationString: "PT1H30M"
}
```

`DateTime`, `Date`, `Time` and `Duration` mean the same concept on every target: a moment in time, a calendar date, a time of day and a length of time. Each target chooses how it stores the concept and which values the application can read it as. The type choice mechanism is ADR 279's; this ADR records each target's tables.

## Decision

1. **A convenience name is a concept, not a representation.** A target declares each convenience type as a type choice over its own explicit types, with the options `as:` and `storage:`. Its `storage:` values are the target's own database types, and its `as:` values are the kinds of value its codecs read.
2. **The defaults are the same kind of value on every target**, so none needs a global `Temporal`: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings. `as: temporal` reads `Temporal.Instant`, `Temporal.PlainDate` and `Temporal.PlainTime`.
3. **A target's `DateTime` with no arguments is the explicit type its `DateTime` named before**, so a schema written before the convenience types emits the same contract.
4. **A target with no interval type stores `Duration` as ISO 8601 text** and offers only `as: string`.
5. **An explicit type is named after what stores it, with a suffix for the value it reads.** Where the database has a column type for the concept, the name is that column type's, as on PostgreSQL. Where it has none, the name is the target's data type, which records what the stored value holds: SQLite's `sqlite/date` gives `DateString`. A type whose bare name would be a convenience name always takes the suffix, even when it is the only codec of its data type, so `sqlite/duration`'s one codec is `DurationString`, not `Duration`.

## SQLite

SQLite has no date or time column types. Every type below is stored as TEXT, so `storage:` lists only `text`, and the data type records what the text holds.

| Convenience type | `as` | Explicit type | Data type | Stored text |
| --- | --- | --- | --- | --- |
| `DateTime` | `jsDate` (default) | `DatetimeJsDate` | `sqlite/datetime` | `2024-01-01T00:00:00.000Z` |
| | `temporal` | `DatetimeTemporal` | `sqlite/datetime` | |
| | `string` | `DatetimeString` | `sqlite/datetime` | |
| `Date` | `string` (default) | `DateString` | `sqlite/date` | `2024-02-29` |
| | `temporal` | `DateTemporal` | `sqlite/date` | |
| `Time` | `string` (default) | `TimeString` | `sqlite/time` | `09:30:00.000` |
| | `temporal` | `TimeTemporal` | `sqlite/time` | |
| `Duration` | `string` (default) | `DurationString` | `sqlite/duration` | `PT1H30M` |

The instant and the time of day always carry three fraction digits, which is what `toISOString()` and SQLite's `strftime('%f')` write, so SQLite compares the stored text in the order of the values. A write converts a value in another ISO form to the stored form and refuses digits below a millisecond rather than round them.

A duration is stored as written, because ISO 8601 gives a duration no single form: `P1M` and `P30D` are different lengths, and `PT60M` and `PT1H` are one length written two ways. So a `DurationString` field compares its text, not its length: a filter on `PT60M` does not match a row written as `PT1H`, and the field cannot be ordered. On PostgreSQL the database compares interval values, so the same filter matches there. An application that filters durations on SQLite writes them in one form.

SQLite gets no `storage: integer` for epoch milliseconds, the form the Prisma ORM query engine wrote: `DatetimeJsDate` already reads such rows, and no Prisma 7 schema reader for SQLite exists to need it.

## MySQL

MySQL has `datetime`, `timestamp`, `date` and `time` columns, so its explicit types are named after them. It has no interval type, so `Duration` is ISO 8601 text.

| Convenience type | `as` | `storage` | Explicit type | Codec | Column |
| --- | --- | --- | --- | --- | --- |
| `DateTime` | `jsDate` (default) | `datetime` (default) | `DatetimeJsDate`, precision 3 unless written | `mysql/datetime@1` | `datetime(p)` |
| | `temporal` | `datetime` | `DatetimeTemporal`, precision 6 unless written | `mysql/datetime-temporal@1` | `datetime(p)` |
| | `string` | `datetime` | `DatetimeString`, precision 6 unless written | `mysql/datetime-string@1` | `datetime(p)` |
| | `jsDate` | `timestamp` | `TimestampJsDate`, precision 3 unless written | `mysql/timestamp-date@1` | `timestamp(p)` |
| | `temporal` | `timestamp` | `TimestampTemporal`, precision 6 unless written | `mysql/timestamp-temporal@1` | `timestamp(p)` |
| | `string` | `timestamp` | `TimestampString`, precision 6 unless written | `mysql/timestamp-string@1` | `timestamp(p)` |
| `Date` | `string` (default) | `date` | `DateString` | `mysql/date-string@1` | `date` |
| | `temporal` | `date` | `DateTemporal` | `mysql/date-temporal@1` | `date` |
| `Time` | `string` (default) | `time` | `TimeString`, precision 6 unless written | `mysql/time-string@1` | `time(p)` |
| | `temporal` | `time` | `TimeTemporal`, precision 6 unless written | `mysql/time-temporal@1` | `time(p)` |
| `Duration` | `string` (default) | `varchar` | `DurationString` | `mysql/duration-string@1` | `varchar(191)` |

- **Precision.** A MySQL `datetime`, `timestamp` or `time` column with no written precision holds whole seconds. So the `temporal` and `string` rows default to 6 fraction digits, which is what an omitted precision holds on PostgreSQL, and the `jsDate` rows to 3, which is what a `Date` holds. A bare `DateTime` is `DatetimeJsDate(3)`, a `datetime(3)` column, which is what `DateTime` named before.
- **Every instant is UTC.** The driver sets each session's `time_zone` to `+00:00`, so `datetime` and `timestamp` both hold the instant in UTC, and both are read as an instant. That is why `TimestampTemporal` reads a `Temporal.Instant` on MySQL, while the same name reads a `Temporal.PlainDateTime` on PostgreSQL, whose `timestamp` has two Temporal codecs. A `datetime` read as a `Temporal.PlainDateTime` would need a name that says its Temporal type, as PostgreSQL's `TimestampInstant` does.
- **Ranges.** `datetime` and `date` hold the years 1000 to 9999, and `timestamp` holds 1970-01-01T00:00:01Z to 2038-01-19T03:14:07.999999Z. A value outside its column's range is refused on write. A value MySQL returns is read as it is, so a row written outside Prisma with an earlier year still reads. MySQL's `time` holds -838:59:59 to 838:59:59, but `Time` is a time of day, so `TimeString` and `TimeTemporal` refuse a value outside 00:00:00 to 23:59:59.999999 on write and on read.
- **Fraction digits.** MySQL rounds a value with more fraction digits than its column holds, which can carry it into the next second, the next day or past its range. So a write is cut to its column's precision before it is sent, where a column with no written precision holds whole seconds, and a literal default with more fraction digits than its column holds is refused. The `now()` generators also round down. A raw query parameter that names a codec but gives no precision is sent whole, because it names no column.
- **`now()`.** `@default(now())` is `CURRENT_TIMESTAMP(p)` on a `datetime` or `timestamp` column, `CURRENT_DATE` on a `date` column and `CURRENT_TIME(p)` on a `time` column. MySQL reports them back as `current_timestamp(p)`, `curdate()` and `curtime(p)`, and each is read back under its own name, so `db verify` tells them apart. `now()` on a column that holds no date or time, such as a `Duration`, is refused.
- **`Duration`** is stored as written, in `varchar(191)` like `String`, so a `Duration` field can be indexed, which MySQL refuses for a `text` column. As on SQLite, it compares its text, not its length.
- **Codec ids.** `DatetimeJsDate` keeps `mysql/datetime@1`, which existing contracts record. Every new codec carries a suffix for its value, as on PostgreSQL, so the `timestamp` read as a `Date` is `mysql/timestamp-date@1`.
- **Changing a field's type.** MySQL's migration planner does not change a column's type yet. Changing a field between these types makes `db verify` report the difference, and `migration plan` refuses it.
- `temporal.CreatedAt` and `temporal.UpdatedAt` are `DateTime` on MySQL too.

## Not decided here

MongoDB. Until its tables are recorded here, MongoDB's `Date`, which is a moment in time, is an explicit type.

## Consequences

- On every target whose tables are recorded here, a user writes `DateTime`, `Date`, `Time` or `Duration` and gets a working field whose value needs nothing installed.
- Changing a field from one of these types to another changes the column's data type and its `now()` default, which the next migration writes, but it does not convert the values existing rows hold. On SQLite, where all of them are stored as text, a row written as a `DateTime` keeps its instant text in a column that is now a `Date`, and fails to read. Convert such rows with a data migration.
- The contract, the migration planner and the runtime see only explicit types, as ADR 279 decided.
- The code the targets' date and time codecs share lives in `@internal/type-implementations` ([ADR 314](ADR%20314%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md)).

## Alternatives considered

**One representation per concept on every target.** A calendar date would be the same database type and value everywhere. No such type exists on every database: SQLite has none, and MongoDB stores a BSON date. The concept is what a user needs to carry between targets.

**SQLite `Time` without a fixed number of fraction digits.** Shorter text, but `09:30:00` and `09:30:00.000` would be one value stored two ways, and SQLite compares text byte by byte.

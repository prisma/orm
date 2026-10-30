# Slice 2: MySQL's convenience date and time types

Project spec: [../spec.md](../spec.md). Branch: `tml-3714-mysql`, stacked on slice 1 (`tml-3714-type-implementations-and-sqlite`, prisma/orm#30922).

## Outcome

```prisma
model Event {
  id        Int      @id
  at        DateTime @default(now())        // DatetimeJsDate(3): datetime(3) read as a Date
  exactAt   DateTime(as: temporal)          // DatetimeTemporal(6): Temporal.Instant
  loggedAt  DateTime(storage: timestamp)    // TimestampJsDate(3): timestamp(3) read as a Date
  day       Date                            // DateString: "2024-02-29"
  opensAt   Time                            // TimeString(6): "09:30:00"
  lasts     Duration                        // DurationString: "PT1H30M"
  createdAt temporal.CreatedAt
}
```

## The table

| Convenience | `as` | `storage` | Explicit type | Data type | Value |
| --- | --- | --- | --- | --- | --- |
| `DateTime` | `jsDate` (default) | `datetime` (default) | `DatetimeJsDate`, precision 3 unless written | `mysql/datetime` (today's codec `mysql/datetime@1`) | `Date` |
| | `temporal` | `datetime` | `DatetimeTemporal`, precision 6 unless written | `mysql/datetime` | `Temporal.Instant` |
| | `string` | `datetime` | `DatetimeString`, precision 6 unless written | `mysql/datetime` | ISO 8601 instant in UTC |
| | `jsDate` | `timestamp` | `TimestampJsDate`, precision 3 unless written | new `mysql/timestamp` | `Date` |
| | `temporal` | `timestamp` | `TimestampTemporal`, precision 6 unless written | `mysql/timestamp` | `Temporal.Instant` |
| | `string` | `timestamp` | `TimestampString`, precision 6 unless written | `mysql/timestamp` | ISO 8601 instant in UTC |
| `Date` | `string` (default), `temporal` | `date` | `DateString`, `DateTemporal` | new `mysql/date` | `"2024-02-29"`, `Temporal.PlainDate` |
| `Time` | `string` (default), `temporal` | `time` | `TimeString`, `TimeTemporal`, precision 6 unless written | new `mysql/time` | `"09:30:00"`, `Temporal.PlainTime` |
| `Duration` | `string` | `text` | `DurationString` | new `mysql/duration`, stored as text | ISO 8601 duration as written |

Decisions (copying PostgreSQL, where an omitted precision holds microseconds):
- MySQL's `datetime`, `timestamp` and `time` default to zero fraction digits, so each `temporal` and `string` row gives `precision: 6` unless written, and each `jsDate` row `precision: 3`, as PostgreSQL's `DateTime` does. A bare `DateTime` stays `DatetimeJsDate(3)` = `datetime(3)`, today's type, so contracts do not change.
- Every instant is read and written as UTC: the driver already sets `time_zone = '+00:00'` on each session. `timestamp` holds 1970-01-01 to 2038-01-19 UTC; `datetime` 1000-01-01 to 9999-12-31; `date` the same years. A value outside its range is refused on write.
- `time` holds -838:59:59 to 838:59:59 in MySQL; `TimeString` and `TimeTemporal` hold a time of day, so they refuse a value outside 00:00:00 to 23:59:59.999999 on write and on read.
- The string codecs read the value as its ISO stored form with fraction trailing zeros dropped, as PostgreSQL's do; the Temporal codecs use `@internal/type-implementations`.
- `now()`: `@default(now())` renders `CURRENT_TIMESTAMP(p)` on `datetime` and `timestamp`, `(CURRENT_DATE)` on `date`, `(CURRENT_TIME(p))` on `time`; the default normalizer reads each back so that verify tells them apart, as on SQLite; `@onCreate`/`@onUpdate(now())` generators for every new codec; `now()` refused on a column that holds no date or time.
- Literal default tags for the new data types, as PostgreSQL's (`timestamp`, `date`, `time`, `duration`), each refusing text its type does not take.
- `temporal.CreatedAt` and `temporal.UpdatedAt` on MySQL: `DateTime @onCreate(now())` and `DateTime @onCreate(now()) @onUpdate(now())`, from `temporalTypeAliases`.
- Introspection, `db verify` and the planner know `timestamp(p)`, `date` and `time(p)`.
- Temporal fallback: MySQL's control entry sets it, as PostgreSQL's and SQLite's do; `temporal-polyfill` becomes a required peer of `@prisma/orm-mysql` and `@prisma/orm-target-mysql`, with an upgrade instruction for Yarn.

## Tests

- Unit tests per codec, tag, generator, data type and type choice; type-level test for the helpers; the facade's no-`Temporal`-global typecheck; the published-entry test through `@repo/test-utils/temporal-fallback-entries`.
- Live tests against MySQL 8.4 (`MYSQL_URL`): migrate, `db verify` clean, write and read every row, `now()` read-back, a change from `DateTime` to `Date` planned.
- `examples/prisma-8-demo-mysql` gains `DateTime`, `Date` and `Time` fields, written and read in its CI test, through whatever write path MySQL has today.

## Docs (orchestrator)

ADR 315's MySQL section; `docs/reference/scalar-types.md` MySQL section; ADR 254 for the new data types and tags; the error reference; the `prisma-8` skill; upgrade instructions.

# Convenience date and time types on SQLite, MySQL and MongoDB

Linear: TML-3714.

## Summary

```prisma
// SQLite
model Event {
  id       Int      @id
  at       DateTime                    // exactly DatetimeJsDate: TEXT read as a JavaScript Date
  exactAt  DateTime(as: temporal)      // exactly DatetimeTemporal: Temporal.Instant
  day      Date                        // exactly DateString: "2024-02-29"
}

// MongoDB
model Order {
  id     ObjectId @id @map("_id")
  paidAt DateTime                      // exactly DateJsDate: a BSON date read as a JavaScript Date
  shipBy Date                          // exactly DateString: a BSON date at midnight UTC, read as "2024-02-29"
}
```

PostgreSQL has the convenience types `DateTime`, `Date`, `Time` and `Duration` (ADR 279). This project gives them to SQLite, MySQL and MongoDB. Each target declares them as type choices over its own explicit types. A convenience name is the same concept on every target, not the same representation: each target picks its own database type and JavaScript value.

## Decisions

- **Shared code goes in a new package, `@internal/type-implementations`,** at `packages/3-targets/0-shared/type-implementations`: code that more than one target's codecs, data types or `now()` generators use, and that depends on no database and no family. It is registered in the `targets` domain, shared plane, so both the target packs (domain `extensions`) and the adapters (domain `targets`) can import it. Its only dependency is `temporal-spec`, for types. This project moves PostgreSQL's database-agnostic date and time logic into it: finding `Temporal` and its fallback, the `now()` values, Temporal and ISO text conversions, `Date` checks, ISO 8601 duration text. PostgreSQL's wire text, `DateStyle`, ` BC` years, `infinity` and interval parts stay in the PostgreSQL target. Codec classes, error envelopes and generator registration stay in each target. ADR 278 is amended for the `0-shared/` folder. Will, 2026-10-30: the framework is not a home for code that is shared only for reuse.
- **An existing `DateTime` keeps its contract** on SQLite, MySQL and MongoDB: each becomes a type choice whose default is the type it has today. The explicit type gets a suffixed name.
- **SQLite** stores every date and time type as TEXT, so `storage:` lists only `text`. New data types `sqlite/date`, `sqlite/time` and `sqlite/duration`.
- **MySQL** gets the data types `mysql/timestamp`, `mysql/date` and `mysql/time` beside `mysql/datetime`. `DateTime` offers `storage: datetime` (default) and `timestamp`.
- **MongoDB `Date`** is a calendar date stored as a BSON date at midnight UTC, the form MongoDB's Java and C# drivers write for a date without a time and Prisma 6's `@db.Date` stored. Its codecs refuse a BSON date that is not at midnight UTC. `Time` and `Duration` are BSON strings.
- **MongoDB's `Date` changes concept at once,** as PostgreSQL's renames did. The upgrade instructions rewrite today's `Date` to `DateTime`. A missed rewrite fails on the first read of a value with a time of day, naming the field.
- **MongoDB's TypeScript builder takes its helpers from the contributed type constructors,** like the SQL builder (ADR 241, ADR 275), before MongoDB gets its convenience types. Today its helpers are hard-coded in the family package and name the target's codec ids. That slice has its own design.
- **`as: temporal` rows** read `Temporal.Instant`, `Temporal.PlainDate` and `Temporal.PlainTime`, as on PostgreSQL. No default needs a global `Temporal`.
- **`Duration`** is an ISO 8601 string with `as: string` only on SQLite, MySQL and MongoDB, none of which has an interval type.

## The tables

SQLite (`storage: text` only):

| Convenience | `as` | Explicit type |
| --- | --- | --- |
| `DateTime` | `jsDate` (default), `temporal`, `string` | `DatetimeJsDate` (`sqlite/datetime@1`, today's), `DatetimeTemporal`, `DatetimeString` |
| `Date` | `string` (default), `temporal` | `DateString`, `DateTemporal` |
| `Time` | `string` (default), `temporal` | `TimeString`, `TimeTemporal` |
| `Duration` | `string` | `DurationString` |

MySQL:

| Convenience | `as` | `storage` | Explicit type |
| --- | --- | --- | --- |
| `DateTime` | `jsDate` (default), `temporal`, `string` | `datetime` (default), `timestamp` | `DatetimeJsDate(3)` (today's), `DatetimeTemporal`, `DatetimeString`, `TimestampJsDate(3)`, `TimestampTemporal`, `TimestampString` |
| `Date` | `string` (default), `temporal` | `date` | `DateString`, `DateTemporal` |
| `Time` | `string` (default), `temporal` | `time` | `TimeString`, `TimeTemporal` |
| `Duration` | `string` | `text` | `DurationString` |

MongoDB:

| Convenience | `as` | `storage` | Explicit type |
| --- | --- | --- | --- |
| `DateTime` | `jsDate` (default), `temporal`, `string` | `date` | `DateJsDate` (`mongo/date@1`, today's), `DateInstant`, `DateInstantString` |
| `Date` | `string` (default), `temporal` | `date` (midnight UTC) | `DateString`, `DateTemporal` |
| `Time` | `string` (default), `temporal` | `string` | `TimeString`, `TimeTemporal` |
| `Duration` | `string` | `string` | `DurationString` |

## Requirements

- Every row works end to end on its target: emit, plan, migrate, read and write, with and without a global `Temporal`.
- `@onCreate(now())` and `@onUpdate(now())` work on every new explicit type that can hold the current time, as on PostgreSQL.
- `temporal.CreatedAt` and `temporal.UpdatedAt` are built on each target's `DateTime`; MySQL gains them.
- Each target's tools write the convenience types where they exist. SQLite and MySQL have no `contract infer`, `contract print` or Prisma 7 reader; `prisma orm init`'s templates use the convenience types. MongoDB's Prisma 6 reader maps to codec ids and needs no change beyond `@db.Date`, which becomes `DateString`'s codec.
- Each slice extends the target's example app, which runs it in CI.
- Docs: `docs/reference/scalar-types.md`, ADR 279's "Not decided here", ADR 278, ADR 257's `field.<token>()` sentence, `docs/architecture docs/Package-Layering.md`, `docs/reference/error-reference.md`, the subsystem docs, the `prisma-8` skill and the pending upgrade instructions.

## Adapter impact

SQLite, MySQL and MongoDB targets, adapters and facades; the PostgreSQL target (moved code). No driver changes expected.

## Contract impact

No new contract kinds. New codec ids and data type ids on SQLite, MySQL and MongoDB. Existing contracts emit unchanged, except MongoDB contracts that use `Date` once they are rewritten.

## Non-goals

- `contract infer`, `contract print` or a Prisma 7 reader for SQLite or MySQL.
- SQLite `storage: integer` (epoch milliseconds). The `jsDate` codec already reads such rows.
- Moving other shared value logic into `@internal/type-implementations` (safe-integer checks, decimal text, the plain-JSON check, the framework's ISO date text reader): each gets a ticket.
- TML-3767 (resolve a type-choice call once per field): framework work that does not simplify this project.

## Project Definition of Done

Inherits `drive/calibration/dod.md`, plus:

- Every table above works end to end, with and without a global `Temporal`, proven by tests and by each target's example app in CI.
- Docs, skills and upgrade instructions updated.
- Every slice PR merged; TML-3714 set to Done with a closing comment.

# ADR 312 — Each target declares the convenience date and time types over its own explicit types

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

SQLite gets no `storage: integer` for epoch milliseconds, the form the Prisma ORM query engine wrote: `DatetimeJsDate` already reads such rows, and no Prisma 7 schema reader for SQLite exists to need it.

## Consequences

- A user writes `DateTime` or `Date` on any target and gets a working field whose value needs nothing installed.
- The contract, the migration planner and the runtime see only explicit types, as ADR 279 decided.
- The code the targets' date and time codecs share lives in `@internal/type-implementations` ([ADR 311](ADR%20311%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md)).

## Alternatives considered

**One representation per concept on every target.** A calendar date would be the same database type and value everywhere. No such type exists on every database: SQLite has none, and MongoDB stores a BSON date. The concept is what a user needs to carry between targets.

**SQLite `Time` without a fixed number of fraction digits.** Shorter text, but `09:30:00` and `09:30:00.000` would be one value stored two ways, and SQLite compares text byte by byte.

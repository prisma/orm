# Project spec — Convenience date and time types

**Linear:** [Convenience date and time types](https://linear.app/prisma-company/project/convenience-date-and-time-types-6a969ca1c76e) ([TML-3709](https://linear.app/prisma-company/issue/TML-3709)) · **Branch:** `tml-3709-plan-datetime-convenience-types` · **Design record:** [ADR 279 — Convenience types choose an explicit type from their arguments](../../docs/architecture%20docs/adrs/ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md) (Accepted)

## Purpose

Prisma 8 gives users explicit, predictable controls first, then makes the common cases easy with convenience APIs built on top. PostgreSQL date and time columns have the explicit half only. Each of eleven type names fixes both the column type and the value the application reads, and nothing says which one to start with. The obvious name, `DateTime`, reads a `Temporal.Instant`, which fails on Node without a polyfill. The string types return text whose format depends on the database server's settings. And an app upgraded from Prisma 7 goes from `Date` values to those strings.

This project gives a user one type per concept in their application (a moment in time, a calendar date, a time of day, a length of time), with defaults that work on stock Node. Every explicit choice stays available. Along the way, the values every date and time type returns become predictable.

## At a glance

```prisma
model Order {
  id        Int      @id
  paidAt    DateTime                                  // timestamptz(3), read as a JavaScript Date
  shipBy    Date                                      // date, read as "2024-02-29"
  opensAt   Time(precision: 0)                        // time(0), read as "09:30:00"
  period    Duration                                  // interval, read as "P1M"
  settledAt DateTime(as: temporal)                 // timestamptz, read as a Temporal.Instant
  legacyAt  DateTime(storage: timestamp)               // timestamp(3), read as a JavaScript Date, stored as UTC
  exactAt   TimestamptzTemporal(6)                    // an explicit type, written directly
}
```

`DateTime`, `Date`, `Time` and `Duration` are convenience types. Each becomes one explicit type, chosen by its optional `as:` and `storage:` arguments. The contract stores only the explicit type, so `settledAt` is stored exactly as `settledAt TimestamptzTemporal` would be.

## Decisions settled in discussion (2026-10-21 and 2026-10-22)

The reasoning and the alternatives rejected are in [`design-notes.md`](./design-notes.md) and ADR 279.

1. **Two layers.** The explicit types stay, named after the database as ADR 257 says, each fixing one codec. The convenience types are named for what a field means in the application, and each becomes exactly one explicit type. Nothing is reversed: the explicit layer is the precise form, the convenience layer is the short form.
2. **A convenience type is a type choice: a declaration whose arguments name the explicit type constructor it becomes**, through a table with defaults and refusals. Not a codec parameterized by database type (a codec represents one data type, ADR 254), not a type alias (an alias attaches attributes to one fixed type), and not a select template over option arguments (no defaults or refusals; being removed with the presets). Settled 2026-10-22 when slice 4 was grounded.
3. **The four PostgreSQL convenience types and their choices:**

   | Type | `as:` | `storage:` | Default |
   | --- | --- | --- | --- |
   | `DateTime` | `jsDate`, `temporal` (`Temporal.Instant`), `string` | `timestamptz`, `timestamp` | `jsDate`, `timestamptz`; precision 3 when the value is `jsDate`, PostgreSQL's default otherwise |
   | `Date` | `string`, `temporal` (`Temporal.PlainDate`) | `date` | `string` |
   | `Time` | `string`, `temporal` (`Temporal.PlainTime`) | `time`, `timetz` (with `string` only) | `string`, `time` |
   | `Duration` | `string` (ISO 8601 duration), `parts` (`{ months, days, micros }`) | `interval` | `string` |

   The value names repeat the suffixes of the explicit types (`TimestamptzJsDate`, `TimestamptzTemporal`, `TimestamptzString`).
4. **Defaults need no setup.** No default needs a Temporal polyfill. `DateTime` defaults to a JavaScript `Date`, which is also what Prisma 7 users have. `Date`, `Time` and `Duration` default to plain ISO 8601 strings. A JavaScript `Date` is never offered for a calendar date or a time of day.
5. **Plain strings, no brand and no Prisma value class.** A brand or class adds friction on every write and does not survive JSON. The codec validates the format on write.
6. **Every explicit type of a column with several codecs carries a suffix.** `Timestamptz`, `Timestamp`, `Date` and `Time` become `TimestamptzTemporal`, `TimestampTemporal`, `DateTemporal` and `TimeTemporal`. `Interval` becomes `IntervalParts`, next to the new `IntervalString`.
7. **Four codecs are added:** a `timestamp` column read as a `Date` and as a `Temporal.Instant`, both treating the stored value as UTC; and an `interval` column read as an ISO 8601 duration string. (The `parts` codec already exists.)
8. **String values are ISO 8601, the same on every server.** Every string codec returns the form ADR 254 stores, not PostgreSQL's display text. The codec ids do not change: this is a bug fix, and nothing keeps the old format before RC. The PostgreSQL target requires `DateStyle=ISO`, and the driver ensures it on every connection it hands out: as a startup option on connections it opens, and with a statement on a pool or client the user supplies. A connection that still prints another style is refused with an error naming the setting. Time zones need no setting: the `timestamptz` codec converts any session offset to UTC, and the `timetz` codec keeps the offset stored with the value.
9. **Temporal fields are never typed `any`.** The Temporal codecs and generators take their types from `temporal-spec`, a types-only package, instead of an undeclared global. No polyfill code is added anywhere. A missing global `Temporal` at runtime is still reported on first use, as today; a startup check was considered and dropped, because Temporal values are now an explicit opt-in.
10. **`contract infer` and `contract print` write convenience types**, with arguments only where they differ from the defaults; a column no convenience type covers (`Temporal.PlainDateTime`) is written as its explicit type. **The Prisma 7 reader** maps Prisma 7's `DateTime` to `TimestampJsDate(3)`, printed `DateTime(storage: timestamp)`, so an upgraded app reads `Date` values again, and maps Prisma 7's `@default(now())` to `@default(now()) @onCreate(now())`, as Prisma 7 behaved ([TML-3719](https://linear.app/prisma-company/issue/TML-3719)).
11. **PostgreSQL only.** A convenience name means the same thing on every target; SQLite and MongoDB follow in [TML-3714](https://linear.app/prisma-company/issue/TML-3714).
12. **TypeScript:** `type.DateTime(...)`, `type.Date(...)`, `type.Time(...)` and `type.Duration(...)` take their arguments as one object, `type.DateTime({ as: 'string', precision: 6 })`, with one overload per row, so a call is typed as the explicit type it picks and a combination with no row does not compile. Explicit constructors stay positional. Settled 2026-10-23 with the option names `as:` and `storage:`.

## Non-goals

- SQLite and MongoDB convenience types ([TML-3714](https://linear.app/prisma-company/issue/TML-3714)).
- Convenience types for other scalars, such as an `Int` choosing between `Int2`, `Int4` and `Int8` ([TML-3715](https://linear.app/prisma-company/issue/TML-3715)).
- The rest of the field-preset removal. This project rebuilds only the contributed `temporal.CreatedAt` and `temporal.UpdatedAt` aliases on `DateTime` (slice 5).
- A `Temporal.PlainDateTime` convenience form. It stays reachable as the explicit `TimestampTemporal`.
- Bundling a Temporal polyfill.
- Any change to how values are stored: the contract form of a value (ADR 254) and every existing codec's stored form stay as they are.

## Place in the larger world

- **ADR 254, data types and casts.** Codecs, data types and stored forms are unchanged. A type constructor still names exactly one codec; a type choice is a second kind of declaration that resolves to a type constructor. The text codecs today keep PostgreSQL's year text (` BC`); decision 8 changes that to the ISO form, which amends the "Date and time types" section.
- **ADR 257, scalar names.** The explicit layer follows it. The `Temporal` suffix applies the suffix rule to every codec of a multi-codec column. Its one-release deprecation rule is not applied before RC: renamed names become errors at once.
- **ADR 275.** The `option` argument kind and the `select` template stay removed with the presets; a type choice has its own option arguments. The contributed `temporal.*` aliases are built on `DateTime`.
- **The PostgreSQL and SQLite rename project** (`projects/target-named-scalars-sql/`, not started) must keep `DateTime` and take this project's renames instead of its own `DateTime` and `Timestamptz` rows.
- **The field-preset removal project** (`projects/remove-field-presets/`, slice 1 merged): its contributed aliases are built on `DateTime` (slice 5), and their `String` and `JsDate` variants are removed.
- **`prisma orm init`** writes `TimestamptzString` and `temporal.updatedAtString()` today. It moves to the convenience types in slice 5.

## Cross-cutting requirements

1. **The contract records only explicit types.** A schema written with a convenience type and the same schema written with the explicit type it becomes emit byte-identical `contract.json` and equal storage and execution hashes.
2. **Every argument combination is either a listed choice or an error at the argument** that names the accepted choices. No combination silently picks a codec.
3. **Every default works on Node 24 with no polyfill.** A test runs each convenience type's default in a process with no global `Temporal`.
4. **A string value round-trips.** A string written through a string codec reads back as the same string, on a server whose `TimeZone` is not UTC and whose `DateStyle` is not ISO.
5. **Renamed explicit names are renamed outright.** Before RC there are no deprecated aliases: `Timestamptz`, `Timestamp` and `Interval` become errors, and the upgrade instructions give the rewrite. `DateTime`, `Date` and `Time` change meaning when the convenience types take them.
6. **Every user-visible change ships upgrade instructions** in the same PR (`skills-contrib/record-upgrade-instructions`).
7. **Docs move with the code.** `docs/reference/scalar-types.md`, the error reference, the editor hover text and the codec authoring guide are updated in the slice that changes what they describe.

## Transitional-shape constraints

- Until slice 4 lands, `DateTime`, `Date` and `Time` keep today's explicit meaning. Slice 3 adds the `Temporal`-suffixed names beside them, so slice 3 alone breaks nothing; slice 4 takes the old names over.
- Slice 5 changes what `contract infer` and the Prisma 7 reader write, and so the codec of adopted columns. It ships with the upgrade instruction to re-emit and `db sign`.

## Contract-impact

No new contract entities or kinds. New codec ids: `pg/timestamp-date@1`, `pg/timestamp-instant@1` and `pg/interval-string@1`. Contracts that use the existing codecs do not change. Contracts emitted by `contract infer` and `prisma7Schema` after slice 5 use different codecs for date and time columns.

## Adapter-impact

PostgreSQL target and adapter only: data-type-bound codecs, type constructors, the runtime connection setup (slice 1), the Prisma 7 reader and `contract infer`'s type map. The framework authoring layer changes (codec choice in a type constructor); the SQL family's PSL column resolution and the TypeScript builder's type-level resolver follow. SQLite and MongoDB are untouched.

## ADR pointer

ADR 279, Accepted. It builds on ADR 241, 254 and 257 and amends ADR 275; ADR 254, 257 and 275 get a note in the slice that implements the change.

## Project DoD

Inherits the team floor in [`drive/calibration/dod.md`](../../drive/calibration/dod.md). In addition:

- [ ] Every row of the decision 3 table works end to end: a PSL schema emits, `migration plan` produces the expected column DDL, and a query on PostgreSQL reads and writes the expected value type, with and without a global `Temporal` as each row requires.
- [ ] A new project from `prisma orm init`, and a Prisma 7 project adopted with `prisma7Schema(...)`, run their first query on Node with no polyfill and read `Date` values for their timestamps; a create through Prisma 8 on an adopted project, on a server whose `TimeZone` is not UTC, stores UTC.
- [ ] The report's use-case table (see References) re-run against the shipped surface, with each row's Prisma 8 cell updated.
- [ ] ADR 279 accepted; ADR 254, 257 and 275 carry notes; `docs/reference/scalar-types.md` describes both layers.
- [ ] TML-3714 and TML-3715 remain open with their context.

## Open questions

- None open. The new codecs are `pg/timestamp-date@1` (`TimestampJsDate`), `pg/timestamp-instant@1` (`TimestampInstant`) and `pg/interval-string@1` (`IntervalString`).

## References

- ADR 279 and the ADRs it builds on or amends: 241, 254, 257, 275.
- The research report comparing Prisma 7 and Prisma 8 date and time fields on PostgreSQL (2026-10-21, published as a private artifact; ask the operator).
- [TML-3418](https://linear.app/prisma-company/issue/TML-3418), the server-dependent string bug, now slice 1.
- The pull request that moved inferred and Prisma 7 date columns to string types: prisma/orm#30553.

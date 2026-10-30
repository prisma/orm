# Slice 1: `@internal/type-implementations`, and SQLite's convenience date and time types

Project spec: [../spec.md](../spec.md). Branch: `tml-3714-type-implementations-and-sqlite`.

## Outcome

```prisma
model Event {
  id      Int      @id
  at      DateTime @onCreate(now())       // DatetimeJsDate: "2024-01-01T00:00:00.000Z" read as a Date
  exactAt DateTime(as: temporal)          // DatetimeTemporal: Temporal.Instant
  day     Date                            // DateString: "2024-02-29"
  opensAt Time                            // TimeString: "09:30:00.000"
  lasts   Duration                        // DurationString: "PT1H30M"
}
```

## Part A: the shared package

`packages/3-targets/0-shared/type-implementations`, package `@internal/type-implementations`, private.

- Registered in `architecture.config.json` as domain `targets`, plane `shared`; in `tsconfig.base.json` references; README states purpose and domain/layer/plane. Depends only on `temporal-spec` (types). No `@internal/*` dependency.
- Scope rule (README): code that more than one target's codecs, data types or `now()` generators use, and that depends on no database and no family. Nothing that builds SQL or BSON, no codec classes, no error envelopes, no generator descriptors.
- Contents, moved from `packages/3-targets/postgres/1-target/src/core`:
  - finding `Temporal`: the global, else a fallback set once per process; returns the implementation or `undefined`, and the target raises its own error;
  - the `now()` value functions and their generator id constants (`instantNow`, `plainDateNow`, `plainTimeNow`, the ISO string forms), with the maximum fraction digits as a parameter rather than PostgreSQL's 6;
  - Temporal from ISO text and Temporal to ISO text: the `Symbol.toStringTag` check, the ISO-calendar check, `withoutUtcDesignator`, describing a wrong input; failures returned as data for the target to wrap in its error;
  - `Date` checks: valid, whole milliseconds, within the `Date` range;
  - the ISO 8601 duration pattern.
- PostgreSQL keeps `DateStyle`, ` BC` and long years, `infinity`, `timetz`, interval parts, its codec classes, errors and generator registration, and now imports the moved logic. Its behaviour and tests do not change; moved unit tests move with the code.

## Part B: SQLite

Every type is stored as TEXT; `storage:` lists only `text`.

| Explicit type | Codec | Data type | Stored text | Value |
| --- | --- | --- | --- | --- |
| `DatetimeJsDate` | `sqlite/datetime@1` (today's `DateTime`) | `sqlite/datetime` | `2024-01-01T00:00:00.000Z` | `Date` |
| `DatetimeTemporal` | new | `sqlite/datetime` | same | `Temporal.Instant` |
| `DatetimeString` | new | `sqlite/datetime` | same | `string`, the stored text |
| `DateString` | new | new `sqlite/date` | `2024-02-29` | `string` |
| `DateTemporal` | new | `sqlite/date` | same | `Temporal.PlainDate` |
| `TimeString` | new | new `sqlite/time` | `09:30:00.000`, always three fraction digits as SQLite's `%f` writes | `string` |
| `TimeTemporal` | new | `sqlite/time` | same | `Temporal.PlainTime` |
| `DurationString` | new | new `sqlite/duration` | an ISO 8601 duration, as written | `string` |

- Type choices `DateTime`, `Date`, `Time`, `Duration` exactly as in the project spec's SQLite table, with `as:` and `storage: text`. `DateTime` with no arguments is `DatetimeJsDate`, so existing schemas emit the same contract.
- Writes store the stored form: a string or Temporal value in another ISO form is converted (an offset to UTC for an instant); a value with digits below a millisecond is refused, not rounded; a `Temporal` value of the wrong kind or with a non-ISO calendar is refused naming the field. Reads accept what `sqlite/datetime@1` accepts today for the instant types (including epoch milliseconds and text without an offset read as UTC), and the stored form for the others.
- Literal default tags `date`, `time`, `duration` beside `datetime`, each refusing text its type does not take.
- `now()`: `@onCreate`/`@onUpdate` generators for every new codec (UTC, truncated to milliseconds); `@default(now())` on `sqlite/date` and `sqlite/time` renders `date('now')` and `strftime('%H:%M:%f','now')`, and the default normalizer reads both back as `now()`.
- Planner fill values, min/max aggregates and adapter column helpers cover the new data types.
- `temporal.CreatedAt` and `temporal.UpdatedAt` stay on `sqlite/datetime@1`.
- Temporal fallback: SQLite's control entry sets the fallback as PostgreSQL's does; without a global `Temporal` the Temporal codecs raise `RUNTIME.TEMPORAL_UNAVAILABLE`, and every default works.

## Tests

- Unit tests per new codec, tag, generator and type choice, copied from PostgreSQL's equivalents; a type-level test that `type.DateTime({ as: 'temporal' })` is typed `Temporal.Instant` and a combination with no row does not compile; the facade's no-`Temporal`-global typecheck.
- Integration: emit, `db init`/migrate, write and read every row against SQLite; the same in a child process without `Temporal` (copy `test/integration/test/cli-journeys/convenience-date-time-types-without-temporal.e2e.test.ts` and its siblings); `now()` read-back.
- `examples/prisma-8-demo-sqlite` uses `DateTime`, `Date` and `Time` fields and runs a read/write test in CI.

## Docs (orchestrator)

ADR 278 amendment for `0-shared/`, ADR 279's "Not decided here", `docs/reference/scalar-types.md` SQLite section and cross-target table, `docs/architecture docs/Package-Layering.md`, `docs/reference/error-reference.md` for `RUNTIME.TEMPORAL_UNAVAILABLE`, the `prisma-8` skill's type lists, and an upgrade-instructions fragment.

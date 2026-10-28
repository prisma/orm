# Slice 5 — `contract infer`, `contract print`, the Prisma 7 reader and `orm init` write the convenience types

**Linear:** [TML-3713](https://linear.app/prisma-company/issue/TML-3713) · **Parent:** [project spec](../../spec.md), decision 10 · **Design record:** ADR 279, "What the tools write" · **Builds on:** slice 4 (the type choices) and slice 2 (the Prisma 7 `now()` mapping)

## At a glance

A database the user adopts with `contract infer`:

```sql
CREATE TABLE event (
  at       timestamptz,        -- no declared precision
  paid_at  timestamptz(3),
  legacy   timestamp(3),
  day      date,
  opens    time(0),
  local_at timetz,
  span     interval
);
```

```prisma
model Event {
  at      DateTime(precision: 6)        // TimestamptzJsDate: a JavaScript Date
  paidAt  DateTime                      // TimestamptzJsDate(3)
  legacy  DateTime(storage: timestamp)   // TimestampJsDate(3)
  day     Date                          // DateString
  opens   Time(precision: 0)            // TimeString(0)
  localAt Time(storage: timetz)          // Timetz
  span    Duration                      // IntervalString
}
```

`contract print` writes the same forms for the same codecs; a `timestamp` column read as `Temporal.PlainDateTime` (`TimestampTemporal`), which no convenience type reaches, prints as its explicit type.

A Prisma 7 schema read by `prisma7Schema(...)`: `DateTime` becomes `TimestampJsDate(3)` (prints `DateTime(storage: timestamp)`), `@db.Timestamptz(p)` becomes `TimestamptzJsDate(p)`, `@db.Date` `DateString`, `@db.Time(p)` `TimeString(p)`, `@db.Timetz(p)` `Timetz(p)`.

`prisma orm init` writes `createdAt DateTime @default(now()) @onCreate(now())` and `updatedAt temporal.UpdatedAt`.

## Chosen design

1. **Infer always takes the default path where it can** (operator ruling, 2026-10-23: "infer should always choose the default path, where possible, since that's the simplest to see in your contract, as a user, and ought to represent the well-trodden path"). For each date and time column, infer picks the codec of the convenience type's default value for that column type, and writes the convenience call with only the arguments that differ from its defaults. The explicit type is written only where no convenience call reproduces the column.
   - Consequence the docs state: a `Date` holds milliseconds, so a `timestamptz` or `timestamp` column with more than 3 digits of precision reads with the extra digits dropped, and `infinity` is refused on read. The upgrade and infer docs say to write `DateTime(as: temporal)` or `DateTime(as: string)` to keep the digits, and `DateTime(as: string)` for a column whose rows hold `infinity`.
   - The one exception (operator ruling, 2026-10-27): when the default-path type cannot read the column's own default, such as `infinity` for a `Date`, infer takes the first row of the same convenience type and storage whose type can, because every row created with that default would otherwise fail to read.
2. **An omitted precision equals precision 6** on `pg/timestamptz`, `pg/timestamp`, `pg/time`, `pg/timetz` and `pg/interval` when columns are compared (the data type's normal form, ADR 254), because PostgreSQL stores microseconds either way. That lets infer write `DateTime(precision: 6)` for a column with no declared precision without `db verify` or the planner seeing a difference. The contract keeps parameters as written; stored contracts and hashes do not change. If this normal-form change would change any existing contract, hash or plan in the repository's fixtures, stop and report.
3. **The `inferred` marks move to the default explicit types:** `pg/timestamptz` → `TimestamptzJsDate`, `pg/timestamp` → `TimestampJsDate`, `pg/interval` → `IntervalString`; `DateString`, `TimeString`, `Timetz` keep theirs. Both infer and the Prisma 7 reader follow the marks, which gives the Prisma 7 table above. The guard test that forbids Temporal codecs in these maps keeps passing and gains `pg/timestamp-instant@1`.
4. **Print and infer write convenience calls through one framework helper** beside `resolveAuthoringTypeChoice`: given an explicit constructor call, find the type choice row (at the same namespace level) that names that constructor, build named arguments from the row (options from its `when`, passed-on arguments by name), drop arguments equal to the defaults, re-resolve to prove it reproduces the same codec and parameters, and otherwise return nothing so the caller writes the explicit call. Arguments are always written by name (positional `DateTime(6)` would land in `as`).
5. **The Prisma 7 reader's generators follow the codec**: `@updatedAt` and slice 2's `@onCreate(now())` resolve `timestampNow` for the `Date` codecs.
6. **`temporal.CreatedAt` and `temporal.UpdatedAt`** are rebuilt on `TimestamptzJsDate(3)` (exactly what bare `DateTime` resolves to, pinned by a test comparing them), with `@onCreate(now())`, and `@onUpdate(now())` for the second; the `String` and `JsDate` variants are removed. A contributed alias stays a literal type, so `type.temporal.CreatedAt()` keeps a precise codec type.
7. **`orm init`** writes the convenience forms in both its PSL and TypeScript templates.
8. **Upgrade instructions:** adopted projects re-emit (the reader and infer pick new codecs; the storage hash changes) and run `prisma db sign`; code that read strings from those columns now reads `Date`. Projects using the removed alias variants rewrite them. Slice 2's upgrade instruction (`prisma7-now-default-on-create`), which names `TimestampString(3)`, is updated.

## Scope

**In:** the framework helper, print and infer (`psl-print/column-types.ts`, `psl-build/column-types.ts`, `infer-model-blocks.ts`, `infer-default-codec.ts`, `inferred-type-constructors.ts`), the data types' normal form, the marks, the Prisma 7 reader, the aliases, `orm init` templates, `examples/prisma7-adoption` (contract, snapshot, `src/main.ts`, README, tests), every fixture and test pinning today's output, docs (`scalar-types.md`, `gotchas.md`, the contract-prisma7 and contract-ts READMEs, skills), ADR 275's alias line. ADR 279 already describes this design; it is not edited unless the built behaviour differs from it.

**Out:** SQLite, MySQL and MongoDB (TML-3714); regenerating the Supabase pack contract (TML-3417).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `timestamptz` with no declared precision | `DateTime(precision: 6)`, by decision 2 |
| `timestamp` column read as `Temporal.PlainDateTime` | Explicit `TimestampTemporal` |
| An inferred `infinity` default on a `timestamptz` or `timestamp` column | The `Date` codec cannot read it, so infer writes the first row that can: `DateTime(as: string, ...)` with the default as written (decision 1's exception) |
| `time` with no precision | `Time` (string default; omitted precision equals 6 by decision 2) |
| `examples/prisma7-adoption` reading `updatedAt.replace(' ', 'T')` | Code updated to read a `Date` |
| Two type choices naming one constructor | The helper takes the first in namespace order; no PostgreSQL constructor is named twice |

## Slice-specific done conditions

- `contract infer` on the at-a-glance table writes exactly the at-a-glance schema, which emits, verifies clean against the same database with `db verify`, and plans no migration; a Prisma 7 adoption journey reads `Date` values for its `DateTime` columns.

## Dispatch plan

1. **The helper, the normal form and the marks** — outcome: print and infer write convenience calls for every reachable codec, the normal form treats omitted precision as 6, marks moved; unit and round-trip print/infer tests. Gates: framework-components, family-sql, target-postgres package tests; the psl-print and psl-infer integration tests; typecheck; lint; `pnpm lint:deps`; `pnpm fixtures:check`.
2. **The Prisma 7 reader, the aliases, `orm init` and the example** — builds on 1. Outcome: the at-a-glance Prisma 7 table, the aliases, the init templates, the adoption example and journeys. Gates: contract-prisma7 and CLI package tests; the Prisma 7 and infer journeys; `examples/prisma7-adoption` tests; `pnpm fixtures:check`; `pnpm check:upgrade-coverage --mode pr`.
3. **Docs and upgrade instructions** — builds on 2. Gates: `pnpm lint:docs`; `pnpm check:upgrade-coverage --mode pr`.

# Slice 3 — The explicit date and time types: Temporal suffix, missing codecs, Temporal types from `temporal-spec`

**Linear:** [TML-3711](https://linear.app/prisma-company/issue/TML-3711) · **Parent:** [project spec](../../spec.md), decisions 6, 7 and 9 · **Design record:** ADR 279, items 6 and 7

## At a glance

```prisma
model Event {
  id        Int                    @id
  at        TimestamptzTemporal(3) // was Timestamptz(3): timestamptz(3), Temporal.Instant
  local     TimestampTemporal      // was Timestamp: timestamp, Temporal.PlainDateTime
  legacyAt  TimestampJsDate(3)     // new: timestamp(3), a JavaScript Date, stored as UTC
  utcAt     TimestampInstant(6)    // new: timestamp(6), a Temporal.Instant, stored as UTC
  day       DateTemporal           // new name beside Date: date, Temporal.PlainDate
  opens     TimeTemporal(0)        // new name beside Time: time(0), Temporal.PlainTime
  period    IntervalParts          // was Interval: interval, { months, days, micros }
  span      IntervalString         // new: interval, "P1Y2M"
}
```

`Timestamptz`, `Timestamp` and `Interval` are errors after this slice, with the upgrade instruction giving the rewrite. `DateTime`, `Date` and `Time` keep today's meaning until slice 4.

## Chosen design

1. **Renames are outright.** No deprecated aliases before RC. The old names are removed from `postgresPslTypeConstructors` (`packages/3-targets/3-targets/postgres/src/core/type-constructors.ts`); every `.prisma` file, PSL string in tests, doc and skill reference moves to the new names. `DateTemporal` and `TimeTemporal` are added; `Date` and `Time` stay as second names until slice 4.
2. **Three codecs, each a complete citizen** (every file the codec anatomy needs: id constant, codec class, descriptor with data type, traits, JSON projection, registration, `codec-type-map`, `OutputTypeMap` where precision-refined, aggregates, `now` binding, PSL constructor, adapter column helper, conformance and aggregate-matrix cases, enum eligibility):
   - `pg/timestamp-date@1`, `TimestampJsDate(p)`: data type `pg/timestamp`; reads `timestamp` text as UTC (append `Z` before `new Date`), writes the stored form without an offset; refuses `infinity` naming `TimestampString`; `now` → `timestampNow`.
   - `pg/timestamp-instant@1`, `TimestampInstant(p)`: data type `pg/timestamp`; reads as `Temporal.Instant` in UTC, writes the UTC wall-clock time without an offset; refuses `infinity`; needs a global `Temporal` like the other Temporal codecs; `now` → `instantNow`.
   - `pg/interval-string@1`, `IntervalString(p)`: data type `pg/interval`; application value is the ISO 8601 duration ADR 254 stores; reads every `IntervalStyle` the existing interval reader handles; `keepsWrittenForm: true` (equal intervals can differ in form); `sum`/`avg` rows like `IntervalParts`; no `now`.
3. **`inferred` marks do not move** except `Interval`'s, which moves to `IntervalParts`. No new codec is inferred.
4. **Fix the `Interval(p)` output type** while renaming: today a precision makes it a branded string although the codec reads `PgInterval` (`packages/3-targets/3-targets/postgres/src/exports/codec-types.ts`).
5. **Temporal types from `temporal-spec`.** The Temporal codecs, the Temporal `now` generators and every exported signature that names a `Temporal` type import it with `import type { Temporal } from 'temporal-spec'`; `temporal-spec` becomes a dependency of the PostgreSQL target (types only). The emitted `.d.mts` then names the type through a real import, so a project without the polyfill's global declarations gets precise types, not `any`. No runtime import of `temporal-polyfill` is added anywhere; verify the built runtime entries contain none.
6. **`contract print`** writes the new names; check it never prints a removed name.

## Coherence rationale

One reviewable change: the explicit layer becomes complete and uniformly named. The three codecs follow one template each, and the renames are mechanical. The large fixture regeneration (about 268 `contract.d.ts` files gain aggregate rows) is mechanical and called out in the PR.

## Scope

**In:** everything above, the TS adapter column helpers (`timestampJsDateColumn`, `timestampInstantColumn`, `intervalStringColumn`, renamed helpers where they carry an old type name), docs (`docs/reference/scalar-types.md` tables, the codec authoring guide, package READMEs, the `prisma-8` skill references), and an `app` upgrade instruction with the rename table.

**Out:** the convenience types and codec choice by arguments (slice 4); `DateTime`, `Date`, `Time` changing meaning (slice 4); `contract infer` / Prisma 7 reader output (slice 5); the `field.temporal.*` presets (being removed by the field-preset removal project).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Precision above 3 on `TimestampJsDate` | Refused at authoring by the parameter bound, since a `Date` holds milliseconds; decide and test |
| Years before 1 and after 9999 | Through `isoYearText` / `postgresYearText`, as the `timestamptz` codecs do |
| A `timestamp` value PostgreSQL holds beyond `Date`/`Temporal` range | Refused on read, naming `TimestampString` |
| Supabase's contract (`packages/3-extensions/supabase/src/contract/contract.prisma`, 78 `Timestamptz` lines) | Renamed; its committed contract regenerated if it changes; storage hash must not change |
| `temporal-spec` version | Match the version `temporal-polyfill` 1.0.x re-exports |

## Slice-specific done conditions

- A project without the polyfill's global type declarations type-checks a `TimestamptzTemporal` field as `Temporal.Instant` (a `not.toBeAny()` type test), and each new codec round-trips on PostgreSQL through the conformance kit.

## Dispatch plan

1. **Renames and the Temporal type source** — outcome: old names gone, new names resolve, `temporal-spec` types in every exported signature, `Interval(p)` typed correctly, all call sites and docs moved, fixtures regenerated. Gates: `pnpm build`, `pnpm --filter @internal/target-postgres test`, `pnpm --filter @internal/adapter-postgres test`, the SQL `contract-psl` and postgres extension package tests, `pnpm typecheck`, per-package `pnpm lint`, `pnpm fixtures:check`, `pnpm lint:deps`.
2. **The three codecs** — builds on 1. Outcome: each codec complete with conformance and aggregate cases, and the three codec probes from `drive/calibration/dod.md`. Gates: as 1, plus the codec testkit's conformance and aggregate-resolution files, plus `pnpm check:upgrade-coverage --mode pr` after the upgrade instruction lands.

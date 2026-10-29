# Plan — Convenience date and time types

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Convenience date and time types](https://linear.app/prisma-company/project/convenience-date-and-time-types-6a969ca1c76e)

## Summary

Five slices. Slices 1, 2 and 3 are independent and can run in parallel. Slice 4 builds on slice 3, and slice 5 on slices 2 and 4.

Five is one over the usual ceiling. Slices 1 and 2 are bug fixes the research found that any naming would need; they share the project because they serve the same purpose (date and time values that are predictable), not because the other slices depend on them. A startup check for a missing Temporal was planned as slice 2 and dropped (2026-10-22): Temporal values are now an explicit opt-in, and its type half moved into slice 3.

## Slices

| # | Slice | Linear | Builds on | Hands to |
| --- | --- | --- | --- | --- |
| 1 | String date and time types read ISO 8601 that does not depend on the server | [TML-3418](https://linear.app/prisma-company/issue/TML-3418) | — | String codecs whose value is the ADR 254 stored form, for `Date`, `Time` and `Duration` to default to |
| 2 | `prisma7Schema` maps `@default(now())` to `@default(now()) @onCreate(now())` | [TML-3719](https://linear.app/prisma-company/issue/TML-3719) | — | Adopted Prisma 7 schemas write the client's UTC time on create, as Prisma 7 did |
| 3 | Explicit types carry a `Temporal` suffix; `timestamp` and `interval` get the missing codecs | [TML-3711](https://linear.app/prisma-company/issue/TML-3711) | — | A complete explicit layer: every cell of the spec's decision 3 table has an explicit type, and `TimestamptzTemporal`, `TimestampTemporal`, `DateTemporal`, `TimeTemporal`, `IntervalParts`, `IntervalString` exist |
| 4 | PSL convenience types `DateTime`, `Date`, `Time` and `Duration` | [TML-3712](https://linear.app/prisma-company/issue/TML-3712) | 3 | Type constructors that choose their codec; the four convenience types; the TypeScript resolver evaluating the choice |
| 5 | `contract infer`, `contract print`, the Prisma 7 reader and `orm init` write the convenience types | [TML-3713](https://linear.app/prisma-company/issue/TML-3713) | 2, 4 | Adopted and new projects read `Date` timestamps with no polyfill |

### Slice 1 — ISO strings

`pg/timestamptz-string@1`, `pg/timestamp-string@1`, `pg/date-string@1`, `pg/time-string@1` and `pg/timetz@1` return the ISO 8601 form ADR 254 stores, on any server `TimeZone` and `DateStyle`, BC years and years past 9999 included; `infinity` stays `infinity`. Covers the related case in the ticket: a database `now()` default on a `timestamp` column and the client's `now()` generator store the same clock. Amends ADR 254's "Date and time types" paragraph on text codecs.

### Slice 2 — Prisma 7 `now()` defaults

`prisma7Schema` reads Prisma 7's `@default(now())` as the database default `now()` plus the client generator `@onCreate(now())` resolved from the column's codec. Today it writes the database default only, so on a server whose `TimeZone` is not UTC a create through Prisma 8 stores local time where Prisma 7 stored UTC. A bug fix independent of the naming work.

### Slice 3 — The explicit layer

Renames outright, with no deprecated aliases before RC: `Timestamptz` → `TimestamptzTemporal`, `Timestamp` → `TimestampTemporal`, `Interval` → `IntervalParts`. New explicit names `DateTemporal` and `TimeTemporal` beside today's `Date` and `Time`, which keep their meaning until slice 4. New codecs and explicit types: `TimestampJsDate` (`pg/timestamp-date@1`, a `timestamp` read as a `Date`, UTC), `TimestampInstant` (`pg/timestamp-instant@1`, a `timestamp` read as a `Temporal.Instant`, UTC) and `IntervalString` (`pg/interval-string@1`). The Temporal codecs and generators take their types from `temporal-spec`, so a Temporal field is never typed `any`; no polyfill code is added. Each new codec passes the codec conformance kit and the three codec probes (dod.md).

### Slice 4 — The convenience types

A new framework declaration, the type choice, picks one explicit type constructor from a table by its `as:` and `storage:` options; every reader of a field's codec resolves the call first. The four types with the spec's choices and defaults; an unlisted combination is an error at the argument. `DateTime`, `Date` and `Time` take over their names (breaking, with upgrade instructions). The TypeScript `type.*` helpers take one object and are typed per row. Hover text and completion list each type's choices. ADR 254, 257 and 275 get notes pointing to ADR 279.

### Slice 5 — The tools write convenience types

`contract infer` and `contract print` write convenience types, with arguments only where they differ from the defaults, and the explicit type only where no convenience type fits. The Prisma 7 reader maps `DateTime` to `DateTime(storage: timestamp)` and `@db.*` date and time columns to the matching convenience form. `prisma orm init` writes `DateTime`. The contributed `temporal.CreatedAt` and `temporal.UpdatedAt` aliases are rebuilt on `DateTime` (`DateTime @onCreate(now())`, and `@onUpdate(now())` for the second), and their `String` and `JsDate` variants are removed, per ADR 279; contracts that use them change codec, so the upgrade instruction says to re-emit and `db sign`. Upgrade instructions: re-emit and `db sign` for adopted projects. Update slice 2's upgrade instruction (`upgrade-instructions/pending/prisma7-now-default-on-create/`), which names the type the reader picks today (`TimestampString(3)`).

## Cross-slice notes

- Slices 1 and 4 both touch what string date and time values look like. The convenience-types journey (`convenience-date-time-types-without-temporal.e2e.test.ts`) asserts today's display text for `textAt` (`2024-02-29 10:00:00.123456+00`) and `localAt` (`09:30:00+02`). Whichever of the two slices merges second changes them to `2024-02-29T10:00:00.123456Z` and `09:30:00+02:00`.

## Cross-slice notes

- Slices 1 and 4 both touch what string date and time values look like. The convenience-types journey (`convenience-date-time-types-without-temporal.e2e.test.ts`) asserts today's display text for `textAt` (`2024-02-29 10:00:00.123456+00`) and `localAt` (`09:30:00+02`). Whichever of the two slices merges second changes them to `2024-02-29T10:00:00.123456Z` and `09:30:00+02:00`.

## Dependencies

- **Field-preset removal project.** Its remaining slices remove the presets; slice 5 here rebuilds its contributed `temporal.CreatedAt` and `temporal.UpdatedAt` on `DateTime`.
- **PostgreSQL and SQLite rename project** (not started). Must not remove `DateTime` and must take slice 3's names. Its spec gets a note in this project's shaping PR.
- **Release.** Users get the convenience types with the first `@prisma/orm-postgres` release after slice 4 merges.

## Close-out (required)

- [ ] Verify the project DoD in [`spec.md`](./spec.md).
- [ ] ADR 279 accepted; `docs/reference/scalar-types.md` describes both layers.
- [ ] Strip repo-wide references to `projects/datetime-convenience-types/**`.
- [ ] Delete `projects/datetime-convenience-types/`.

# Slice 1 — String date and time types read ISO 8601, the same on every server

**Linear:** [TML-3418](https://linear.app/prisma-company/issue/TML-3418) · **Parent:** [project spec](../../spec.md), decision 8 · **Design record:** ADR 279, item 9

## At a glance

A `TimestamptzString` column holding the instant `2024-01-01T00:00:00Z`:

| | Today | After |
| --- | --- | --- |
| Read on a UTC server | `2024-01-01 00:00:00+00` | `2024-01-01T00:00:00Z` |
| Read on a server set to `Europe/Berlin` | `2024-01-01 01:00:00+01` | `2024-01-01T00:00:00Z` |
| Year 44 BC | `0044-03-15 12:00:00+00 BC` | `-000043-03-15T12:00:00Z` |
| Inside an `include` (JSON row) | the same display text | the same ISO text |

Every string codec's application value is the stored form ADR 254 defines for its data type ("Date and time types"): `pg/timestamptz-string@1`, `pg/timestamp-string@1`, `pg/date-string@1`, `pg/time-string@1` and `pg/timetz@1`. What the application writes in that form reads back unchanged.

## Chosen design

1. **The codecs read with the stored-form readers.** `fromWire` turns PostgreSQL's ISO-DateStyle text into the stored form with the existing readers in `packages/3-targets/3-targets/postgres/src/core/data-types.ts` (`pgDateStoredText`, `pgTimeStoredText`, `pgTimetzStoredText`, `pgTimestampStoredText`, `pgTimestamptzStoredText`), which already convert any time zone offset to UTC for `timestamptz`, ` BC` years and long years to ISO, and keep `infinity`. `pg/timestamptz-date@1` already reads wire text this way. `toWire` keeps converting the stored ISO year into PostgreSQL's year text (`postgresYearText`). `fromDataTypeValue` is the stored value; `toDataTypeValue` requires the stored form.
2. **`DateStyle=ISO` is a connection requirement the target declares and the driver ensures** (operator ruling, 2026-10-23). The PostgreSQL target states, as data on its descriptor, the session settings its codecs need (`DateStyle=ISO`). The PostgreSQL driver ensures every connection it hands to the runtime satisfies them, whatever its binding: a URL, a `pgPool` or a `pgClient` the user supplies, and the Supabase runtime's connections after its `RESET ALL`. How the driver ensures it (a startup option, a setting applied when a connection is first acquired or after a reset, or both) is the driver's own implementation detail; the codecs never depend on how. The codecs still refuse non-ISO text with `RUNTIME.DATE_STYLE_NOT_ISO`, which now means the driver could not ensure the requirement. No `TimeZone` setting is needed: the `timestamptz` codecs convert any offset to UTC and `timetz` keeps its offset.
3. **The `now()` generators for these codecs write the stored form** (`timestampStringNow`, `timestamptzStringNow`, `dateStringNow`, `timeStringNow`, `timetzNow` in `date-time-now-generators.ts`), so a generated value reads back as written.
4. **Codec ids, the contract and stored defaults do not change.** It is a bug fix; nothing keeps the old format before RC.
5. **Values PostgreSQL holds beyond the stored form's range** (time `24:00:00`, dates after `+275760-09-13`, seven-digit years) are read as ISO-shaped text, not refused: the string types exist to carry values the other codecs cannot. The implementer documents the exact text for each.
6. **`enumRefusal` on these codecs is re-examined.** Where it existed only because a query returned display text, it goes; the enum test that places every codec in exactly one group decides.

## Coherence rationale

One reviewable change: the five string codecs, their generators, the runtime connection option and the docs that describe the old text. The JSON path is covered by the same `fromWire`, because the projections already cast to text.

## Scope

**In:** the five codecs, their `now` generators, the PostgreSQL runtime driver's connection setup, the error for a non-ISO DateStyle (error-reference entry), tests, the codec conformance cases, ADR 254's "Date and time types" and "Codecs" paragraphs that describe the old text, `docs/reference/scalar-types.md`, the codec authoring guide, `gotchas.md`, the `prisma-8` skill references, and an `app` upgrade instruction.

**Out:** renaming any type (slice 3); the Prisma 7 `now()` mapping (slice 2); a database `now()` default on a `timestamp` column, which PostgreSQL evaluates in the session's time zone (slice 2 makes adopted schemas fill the value on the client instead).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Supabase runs `RESET ALL` when it releases a role scope | Startup option survives it; test through the Supabase runtime |
| `@prisma/dev` / PGlite shares one session between clients | A startup option or per-connection setting must not leak a changed setting to other clients; the tests already assume UTC and ISO |
| A user-supplied pool whose server uses `DateStyle=German` | Refused on read with the new error, not mis-parsed |
| Transaction-mode poolers that reject startup options | Out of scope to work around; the requirement is documented |
| `infinity` / `-infinity` | Unchanged |
| Tests that assert display text (`temporal-string-codec-roundtrip.integration.test.ts`, `date-time-text.integration.test.ts`, `now-generators.test.ts`, `prisma7-dates-without-temporal.e2e.test.ts`, conformance `cases.ts`) | Updated to the ISO form; the two tests that assert session leakage become tests that it no longer leaks |

## Slice-specific done conditions

- A `TimestamptzString` value written in ISO form reads back identical on a session with `TimeZone=Asia/Tokyo`, flat and inside an `include`, and a German-DateStyle user connection fails with the new error.

## Dispatch plan

1. **Codecs, generators and connection requirement** — outcome: the at-a-glance table holds on PostgreSQL, including JSON rows, BC years, long years and a non-UTC session; a non-ISO DateStyle is refused. Gates: `pnpm --filter @internal/target-postgres test`, `pnpm --filter @internal/adapter-postgres test`, `pnpm --filter @internal/driver-postgres test`, the testkit's conformance and date-time-text integration files, `pnpm typecheck` for the touched packages, `pnpm lint` for each touched package, `pnpm fixtures:check`.
2. **Docs and upgrade instruction** — outcome: every doc listed in Scope describes ISO values; ADR 254 amended in place; upgrade instruction recorded per `skills-contrib/record-upgrade-instructions`. Gates: `pnpm lint:docs`, `pnpm check:upgrade-coverage --mode pr`.

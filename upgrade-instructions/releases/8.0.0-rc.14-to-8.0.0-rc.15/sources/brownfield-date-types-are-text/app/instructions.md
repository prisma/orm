---
changes:
  - id: prisma7-schema-date-types-are-text
    summary: |
      A contract from `prisma7Schema(...)` now reads a Prisma 7 `DateTime` column and `@db.Timestamp`, `@db.Timestamptz`, `@db.Date` and `@db.Time` columns as the text PostgreSQL prints (`TimestampString(3)`, `TimestampString(p)`, `TimestamptzString(p)`, `DateString`, `TimeString(p)`), not as `Temporal` values. `@updatedAt` still writes UTC. The application needs no `Temporal` for them. Re-emit, change code that treats these fields as `Temporal` values, then run `prisma db sign`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: contract-infer-writes-text-date-types
    summary: |
      `prisma contract infer` now writes `TimestampString(p)`, `TimestamptzString(p)`, `DateString` and `TimeString(p)` for `timestamp`, `timestamptz`, `date` and `time` columns, where it wrote `Timestamp(p)`, `Timestamptz(p)`, `Date` and `Time(p)`. A contract inferred earlier keeps its types until infer runs again.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'Contract inferred from the live database schema'
  - id: text-timestamp-now-is-utc
    summary: |
      A `timestamp` column of type `TimestampString(p)` that the ORM fills with `now` now receives the UTC wall-clock time on a host outside UTC. Before, it received the host's local time. No code changes.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '\btimestampString\s*\([^)\n]*\bnow\b'
---

# Contracts from a Prisma 7 schema or `contract infer` read dates as text

## `prisma7-schema-date-types-are-text`

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`:

1. Run `prisma contract emit`. The date and time fields change type:

   | Prisma 7 field | Before | Now | Example value |
   | --- | --- | --- | --- |
   | `DateTime`, `DateTime @db.Timestamp(p)` | `Temporal.PlainDateTime` | `string` | `"2026-09-14 10:00:00.123"` (UTC, as Prisma 7 writes it) |
   | `DateTime @db.Timestamptz(p)` | `Temporal.Instant` | `string` | `"2026-09-14 10:00:00.123+00"` (on a server whose `TimeZone` is UTC) |
   | `DateTime @db.Date` | `Temporal.PlainDate` | `string` | `"2026-09-14"` |
   | `DateTime @db.Time(p)` | `Temporal.PlainTime` | `string` | `"10:00:00.123"` |

   `@db.Timetz` fields already read as text and do not change.

2. Change the code that reads or writes these fields:

   - `DateTime` and `@db.Timestamp`: the text holds UTC wall-clock time with a space between the date and the time, where `.toString()` on a `Temporal.PlainDateTime` printed a `T`. Where code printed or stored that form, replace `value.toString()` with `value.replace(' ', 'T')`. Where it compares or computes with the value, `` new Date(`${value.replace(' ', 'T')}Z`) `` is the instant.
   - `@db.Timestamptz`: the text carries the offset of the database session's `TimeZone`, `+00` on a server set to UTC. Do not apply `replace(' ', 'T')` to it. `new Date(value)` parses it in Node.js, and `new Date(value).toISOString()` prints the instant in UTC ending in `Z`, the form `.toString()` on a `Temporal.Instant` printed, with milliseconds always present.
   - `@db.Date` and `@db.Time`: the text is the form `.toString()` on a `Temporal.PlainDate` or `Temporal.PlainTime` printed.

   Write a string PostgreSQL reads, such as `"2026-09-14 10:00:00"` for `DateTime` or `"2026-09-14T10:00:00Z"` for `@db.Timestamptz`, instead of a `Temporal` value. `@updatedAt` still writes UTC, as it did before and as Prisma 7 does, so existing rows need no change.

3. If no other code in the application uses `Temporal`, remove the `import 'temporal-polyfill/full/global'` it had for these fields, and remove `temporal-polyfill` from the application's `dependencies`. Keep the dependency in a project that installs with Yarn: `@prisma/orm-postgres` declares it as a peer dependency, and Yarn does not install peers on its own.

4. Run `prisma db sign` against every database the application uses. The storage hash changed with the column types. Until a database is signed, `prisma db verify --db "$DATABASE_URL"` exits with code 4 and reports `CONTRACT.MARKER_MISMATCH`. The running application does not report the mismatch: it keeps answering queries and logs nothing, because the `postgres()` client has no logger for the marker check. The database itself needs no migration.

`prisma7Schema(...)` has no option to keep the `Temporal` types. A project that wants them writes a Prisma 8 contract, for example with `prisma contract print --output prisma/contract.prisma`, and changes the types there.

## `contract-infer-writes-text-date-types`

Nothing changes until `prisma contract infer` runs again. When it does, the rewritten contract uses the text types for `timestamp`, `timestamptz`, `date` and `time` columns. Follow steps 1 to 4 above for the fields that changed, or change the types back to `Timestamp(p)`, `Timestamptz(p)`, `Date` and `Time(p)` in the inferred file to keep `Temporal` values.

A default of `infinity` or `-infinity` on one of these columns now prints as `@default("infinity")` where it printed a `sql` expression.

## `text-timestamp-now-is-utc`

This covers `temporal.timestampString(p, onCreate: now, onUpdate: now)` in PSL and `field.temporal.timestampString(...)` with `'now'` in TypeScript. Rows these fields wrote before this release on a host outside UTC hold that host's local time; rows written from now on hold UTC. A Prisma 7 `DateTime @updatedAt` read through `prisma7Schema(...)` is not affected: it wrote UTC before and still does.

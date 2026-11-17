---
changes:
  - id: prisma7-schema-reads-dates
    summary: |
      A contract from `prisma7Schema(...)` on PostgreSQL now reads a Prisma 7 `DateTime` field as a JavaScript `Date`, as Prisma 7 did, instead of a string: a plain `DateTime` is `TimestampJsDate(3)` and a `@db.Timestamptz(p)` field is `TimestamptzJsDate(p)`. The columns do not change, but the contract's codecs and storage hash do. Re-emit with `prisma contract emit`, run `prisma db sign`, and change application code that read those fields as strings to read a `Date`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: temporal-type-aliases-on-datetime
    summary: |
      On PostgreSQL, `temporal.CreatedAt` and `temporal.UpdatedAt` are now built on `DateTime`, a `timestamptz(3)` column read as a JavaScript `Date`, instead of a `timestamptz` column read as a `Temporal.Instant`, and the `temporal.CreatedAtString`, `temporal.UpdatedAtString`, `temporal.CreatedAtJsDate` and `temporal.UpdatedAtJsDate` aliases are removed, in PSL and as `type.temporal.*()` in a TypeScript contract. Write the type and the generators instead, as the table in the body shows, to keep each field and its contract.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])temporal\.(?:Created|Updated)At(?:String|JsDate)?(?![\w$])'
  - id: date-default-below-a-millisecond
    summary: |
      On PostgreSQL and MySQL, a column read as a JavaScript `Date` (`DateTime` at its default, `TimestamptzJsDate`, `TimestampJsDate`, MySQL's `DateTime`) now refuses a `@default` with digits below a millisecond, which a `Date` cannot hold, and `prisma contract emit` reports it. Keep the default by changing the field to `DateTime(as: string)` or `DateTime(as: temporal)`, or by writing the default as a `sql` expression.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@default\((?:timestamp(?:tz)?|datetime)`[^`]*\.\d{3}\d*[1-9]'
  - id: date-now-takes-column-precision
    summary: |
      On PostgreSQL, the `now` generator of a timestamp column read as a JavaScript `Date` (`DateTime`, `TimestamptzJsDate`, `TimestampJsDate`, `temporal.CreatedAt` and `temporal.UpdatedAt`) or as a `Temporal` value (`DateTime(as: temporal)`, `TimestamptzTemporal`, `TimestampTemporal` and `TimestampInstant`) now takes the column's precision and rounds the time down to it, so the value the client holds is the value PostgreSQL stores. A `timestamp(0)` column no longer gets a time PostgreSQL rounds up to the next second. The generator's precision is in the contract's execution section, so re-emit with `prisma contract emit` and commit `contract.json` and `contract.d.ts`; only the execution hash changes, so there is no migration and no `prisma db sign`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bprisma7Schema\s*\('
        - '@on(?:Create|Update)\(now\(\)\)'
        - '(?<![\w$])temporal\.(?:Created|Updated)At(?![\w$])'
        - '(?<![\w$])temporal\.timestamp(?:tz(?:JsDate)?)?\s*\('
        - '(?<![\w$])gen\.now\(\)'
---

# The tools write the convenience date and time types

## `prisma7-schema-reads-dates`

`prisma7Schema(...)` reads each Prisma 7 date and time field as the type the convenience default gives for its column:

| Prisma 7 field | Prisma 8 type | The application reads |
| --- | --- | --- |
| `DateTime` | `TimestampJsDate(3)`, printed `DateTime(storage: timestamp)` | a JavaScript `Date`, the stored value read as UTC |
| `@db.Timestamptz(p)` | `TimestamptzJsDate(p)`, printed `DateTime(precision: p)` | a JavaScript `Date` |
| `@db.Timestamp(p)` | `TimestampJsDate(p)` | a JavaScript `Date`, the stored value read as UTC |
| `@db.Date` | `DateString` | an ISO 8601 string, such as `2026-09-14`, the same text as before |
| `@db.Time(p)` | `TimeString(p)` | an ISO 8601 string, such as `10:00:00.5`, the same text as before |
| `@db.Timetz(p)` | `Timetz(p)` | an ISO 8601 string with a full offset, such as `10:00:00+02:00`, or `10:00:00Z` for UTC; it was `10:00:00+02` and `10:00:00+00` |

Before this release the first three read strings, such as `2026-09-14 10:00:00.123`. `@updatedAt` and `@default(now())` now write a `Date` for these fields. The three string types read ISO 8601 in this release, whatever the contract source. The `iso-string-date-time-values` change in this release's upgrade guide gives every form that changes, such as a date before year 1, and how to update code that reads them.

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`:

1. Run `prisma contract emit` and commit the new `contract.json` and `contract.d.ts`. The storage hash changes, because the columns' codecs change; the columns themselves do not.
2. Run `prisma db sign` against each database, so its marker records the new contract. Commit the snapshot and the `db` ref it writes under `migrations/`, replacing the previous ones.
3. Change code that read a `DateTime` or `@db.Timestamptz` field as a string. It now gets a `Date`, and a write takes a `Date`:

   ```ts
   // before: user.updatedAt was "2026-09-14 10:00:00.123"
   console.log(user.updatedAt.replace(' ', 'T'));
   // after: user.updatedAt is a Date
   console.log(user.updatedAt.toISOString());
   ```

A `Date` holds milliseconds. A `@db.Timestamptz(6)` or `@db.Timestamp(6)` column with values that use the extra digits reads with them dropped. To keep them, write the Prisma 8 schema yourself with `DateTime(as: string)` or `DateTime(as: temporal)` for that field.

A `Date` cannot hold `infinity` or `-infinity` either. A row that stores one now fails to read with `RUNTIME.DECODE_FAILED`, where it read as the string `infinity` before. For a column that can hold them, write the Prisma 8 schema yourself with `DateTime(as: string, storage: timestamp, precision: 3)` for that field; `DateTime(as: temporal)` cannot hold them either.

## `temporal-type-aliases-on-datetime`

`temporal.CreatedAt` is now `DateTime @onCreate(now())` and `temporal.UpdatedAt` is `DateTime @onCreate(now()) @onUpdate(now())`, a `timestamptz(3)` column read as a JavaScript `Date`. To keep each field exactly as it is, and its contract, write the type and the generators the alias stood for:

| Before | After, in PSL |
| --- | --- |
| `temporal.CreatedAt` | `DateTime(as: temporal) @onCreate(now())` |
| `temporal.UpdatedAt` | `DateTime(as: temporal) @onCreate(now()) @onUpdate(now())` |
| `temporal.CreatedAtString` | `DateTime(as: string) @onCreate(now())` |
| `temporal.UpdatedAtString` | `DateTime(as: string) @onCreate(now()) @onUpdate(now())` |
| `temporal.CreatedAtJsDate` | `TimestamptzJsDate @onCreate(now())` |
| `temporal.UpdatedAtJsDate` | `TimestamptzJsDate @onCreate(now()) @onUpdate(now())` |

`DateTime(as: temporal)` is exactly `TimestamptzTemporal`, and `DateTime(as: string)` exactly `TimestamptzString`; either form gives the same contract. `TimestamptzJsDate` keeps its explicit name, because `DateTime` gives `TimestamptzJsDate(3)`, which stores a precision the alias did not.

In a TypeScript contract, `field.column(type.temporal.CreatedAtString())` becomes `field.column(type.DateTime({ as: 'string' })).onCreate(gen.now())`, adding `.onUpdate(gen.now())` for an `UpdatedAt` alias, with `gen` taken from the `defineContract` callback beside `field` and `type`. Do the same for each alias in the table. Re-emit with `prisma contract emit`: the contract is the same as before.

To move a `temporal.CreatedAt` or `temporal.UpdatedAt` field to the new default instead, keep the alias and update the code that reads it to a `Date`. Its column becomes `timestamptz(3)`, which rounds stored values to milliseconds, so plan it with `prisma migration plan --delete <Model>.<field>` and apply it with `prisma db migrate`, or run `prisma db update --delete <Model>.<field>`.

If you followed the 8.0.0-rc.21 guide's `remove-field-presets` change, a field it rewrote from `temporal.createdAt()` or `temporal.updatedAt()` to `temporal.CreatedAt` or `temporal.UpdatedAt` is such a field: write it from the table above to keep its contract.

The detection also matches `temporal.CreatedAt` and `temporal.UpdatedAt` in SQLite and MongoDB projects. There they keep their meaning and need no change.

## `date-default-below-a-millisecond`

A JavaScript `Date` holds milliseconds. A column read as a `Date` now refuses a default with more digits, instead of storing it and reading it back at the millisecond. For a field such as

```prisma
at DateTime(precision: 6) @default(timestamptz`2024-01-01T01:00:00.123456Z`)
```

write one of:

```prisma
at DateTime(as: string, precision: 6) @default(timestamptz`2024-01-01T01:00:00.123456Z`)
at DateTime(precision: 6) @default(sql`'2024-01-01 01:00:00.123456+00'::timestamptz`)
```

The first reads the field as a string, which keeps every digit. The second keeps the field a `Date` and the database default as written. Run `prisma contract emit` again. A Prisma 7 schema read by `prisma7Schema(...)` needs no change: such a default is kept as the SQL Prisma 7 created.

## `date-now-takes-column-precision`

A JavaScript `Date` holds milliseconds. On a column with fewer fraction digits, such as a Prisma 7 `@db.Timestamp(0) @updatedAt` field, the client used to generate a time such as `10:00:00.700` and PostgreSQL stored `10:00:01`, so the value a create returned before a read differed from the stored one. The `now` generator of a column read as a `Date`, such as `TimestamptzJsDate(0) @onCreate(now())`, now receives the column's precision, as the string and time generators already do, and writes `10:00:00`. The same holds for a timestamp column read as a `Temporal` value, such as `TimestamptzTemporal(0) @onCreate(now())` or `TimestampInstant(0) @onCreate(now())`: its `instantNow` or `plainDateTimeNow` generator now receives the precision too. Before, such a column stored `10:00:01`, a time after the write, and at `23:59:59.700` the next day's date.

The contract records the precision beside the generator, for example `{ "kind": "generator", "id": "timestampNow", "params": { "precision": 3 } }`. For each project with such a field, including every project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit` and commit the new `contract.json` and `contract.d.ts`. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`. SQLite and MongoDB contracts do not change.

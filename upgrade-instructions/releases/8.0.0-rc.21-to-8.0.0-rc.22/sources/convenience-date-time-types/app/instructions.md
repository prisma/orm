---
changes:
  - id: psl-date-time-types-are-convenience-types
    summary: |
      In a Prisma 8 schema on PostgreSQL, `DateTime`, `Date` and `Time` are now convenience types that choose an explicit type from their arguments, and their defaults read different values: `DateTime` is a `timestamptz(3)` column read as a JavaScript `Date`, and `Date` and `Time` are read as strings. To keep what a field reads today, and its contract, rename `DateTime` to `TimestamptzTemporal`, `Date` to `DateTemporal` and `Time` to `TimeTemporal`, keeping the arguments: `Time(3)` becomes `TimeTemporal(3)`. A Prisma 7 schema, which has a `datasource` block, and SQLite and MongoDB schemas are not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?(?:DateTime|Date|Time)(?![\w$])'
  - id: ts-date-time-helpers-are-convenience-types
    summary: |
      In a TypeScript contract on PostgreSQL, `type.DateTime(...)`, `type.Date(...)` and `type.Time(...)` are now the convenience types, whose arguments are one object with the keys `as`, `storage` and `precision`, so `type.Time(3)` no longer compiles. To keep what a field reads today, call `type.TimestamptzTemporal(...)`, `type.DateTemporal()` and `type.TimeTemporal(...)` with the same arguments.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:DateTime|Date|Time)\('
---

# `DateTime`, `Date` and `Time` are convenience types on PostgreSQL

On PostgreSQL, Prisma 8 has two layers of date and time types. The explicit types name the column type and the kind of value the application reads, such as `TimestamptzTemporal` or `DateString`. The convenience types `DateTime`, `Date`, `Time` and the new `Duration` are named for what a field means, and each becomes one explicit type, chosen by its optional `as` and `storage` arguments. Their defaults need no `Temporal` polyfill:

| Written | Becomes | Column | The application reads |
| --- | --- | --- | --- |
| `DateTime` | `TimestamptzJsDate(3)` | `timestamptz(3)` | a JavaScript `Date` |
| `Date` | `DateString` | `date` | a string, such as `"2024-02-29"` |
| `Time` | `TimeString` | `time` | a string, such as `"09:30:00"` |
| `Duration` | `IntervalString` | `interval` | an ISO 8601 duration, such as `"P1M"` |

Until this release, `DateTime`, `Date` and `Time` were explicit types that read `Temporal.Instant`, `Temporal.PlainDate` and `Temporal.PlainTime`. A schema that keeps those names now reads other values, and its contract changes.

## `psl-date-time-types-are-convenience-types`

To keep each field as it is, rename its type, keeping its arguments and attributes:

| Before | After |
| --- | --- |
| `DateTime` | `TimestamptzTemporal` |
| `Date` | `DateTemporal` |
| `Time(p?)` | `TimeTemporal(p?)` |

```prisma
model Event {
  id      Int                 @id
  at      TimestamptzTemporal // was DateTime
  day     DateTemporal        // was Date
  opensAt TimeTemporal(0)     // was Time(0)
}
```

The detection cannot tell which target a schema is for, so it also matches SQLite's and MySQL's `DateTime` and MongoDB's `Date`. A match in a project whose `prisma.config.ts` uses the SQLite, MySQL or MongoDB target needs no change: on those targets the names keep their meaning.

A type alias written with one of the names, such as `types { Stamp = DateTime @onCreate(now()) }`, is renamed the same way. Rename only field types and alias types in Prisma 8 schemas whose config uses the PostgreSQL target, including the `contract.prisma` copies in migration folders; leave a model or field named `Date`, comments, and Prisma 7 schemas as they are. Re-emit the contract with `prisma contract emit`: it is byte for byte the same as before.

To move a field to the new defaults instead, keep the name, update the application code that reads the field, and run `prisma contract emit`. What the database needs then depends on the type:

- **`Date` and `Time`** keep their `date` and `time(p)` columns, when a precision is written by name (`Time(precision: 0)` for `Time(0)`), and change only the codec, so the database does not change, but the contract hash does.
  - With migrations: `prisma migration plan` writes a migration with no operations, then `prisma db migrate` applies it and moves the marker.
  - With `prisma db update`: run it. It applies no operations and records the new contract on the database.
- **`DateTime`** makes the column `timestamptz(3)`, and a schema that wrote `DateTime` before had a `timestamptz` column, which holds microseconds. Lowering the precision rounds stored values to milliseconds, so both commands ask before they change it. Run `prisma migration plan --delete <Model>.<field>` and then `prisma db migrate`, or `prisma db update --delete <Model>.<field>`, which accepts the rounding. A JavaScript `Date` holds milliseconds only, so to keep microseconds, keep the `Temporal.Instant` field: write `DateTime(as: temporal)`, which is exactly `TimestamptzTemporal`.

## `ts-date-time-helpers-are-convenience-types`

Rename only in contracts on PostgreSQL; `type.DateTime(...)` in a SQLite or MySQL contract keeps its meaning.

```ts
field.column(type.TimestamptzTemporal()); // was type.DateTime()
field.column(type.DateTemporal()); // was type.Date()
field.column(type.TimeTemporal(3)); // was type.Time(3)
```

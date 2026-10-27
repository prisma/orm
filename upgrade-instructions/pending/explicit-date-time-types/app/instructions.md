---
changes:
  - id: psl-temporal-type-renames
    summary: |
      On PostgreSQL, the PSL types `Timestamptz`, `Timestamp` and `Interval` are renamed to `TimestamptzTemporal`, `TimestampTemporal` and `IntervalParts`, and the old names are errors. Rename each use in your `.prisma` files, keeping its arguments: `Timestamptz(3)` becomes `TimestamptzTemporal(3)`. Each new name reads the same value with the same codec, so the contract and its hashes do not change. `@db.Timestamp` and `@db.Timestamptz` in a Prisma 7 schema are not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w$.@"\x27`])(?:Timestamptz|Timestamp|Interval)(?![\w$])'
  - id: ts-temporal-type-helpers-renamed
    summary: |
      In a TypeScript contract, `type.Timestamptz(...)`, `type.Timestamp(...)` and `type.Interval(...)` are renamed to `type.TimestamptzTemporal(...)`, `type.TimestampTemporal(...)` and `type.IntervalParts(...)`, and the column helper `intervalColumn(...)` from `@prisma/orm-postgres/adapter/column-types` is renamed to `intervalPartsColumn(...)`. Rename each call; the arguments do not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:Timestamptz|Timestamp|Interval)\('
        - '(?<![\w$])intervalColumn(?![\w$])'
  - id: interval-with-precision-typed-as-parts
    summary: |
      An `IntervalParts(p)` column, an interval with a precision, is now typed as the `{ months, days, micros }` object its codec reads, as an interval without a precision already was, instead of a string. Type such a value as `PgInterval` from `@prisma/orm-postgres/target/codec-types`. Code that treated the value as a string was wrong at run time and now fails to type-check.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])Interval(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: branded-time-types-removed
    summary: |
      The string types `Timestamp`, `Timestamptz`, `Time` and `Interval` are no longer exported from `@prisma/orm-postgres/target/codec-types` (and `Interval` no longer from `@prisma/orm-postgres/contract-builder`). No column was typed by the first three. Remove each of these names from the import that names it, and delete the import if it names nothing else. A `contract.d.ts` written by an earlier release, such as one in a migration snapshot, imports them without using them, so removing them from its import is the only change it needs.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])(?:Timestamptz|Timestamp|Time|Interval)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: temporal-types-from-temporal-spec
    summary: |
      Temporal fields are now typed with the `Temporal` types of the `temporal-spec` package rather than a global `Temporal` declaration, so they are typed even in a project without the polyfill's global types. The values are the same and assign to and from the global types. A type test that requires a field to be exactly `Temporal.Instant` (or another `Temporal` type) from the global declarations now fails: add `temporal-spec` (`1.0.1`) to your development dependencies and import the type with `import type { Temporal } from 'temporal-spec'` in that test.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*import\s+(?:type\s+)?\{[^}]*(?<![\w$])Temporal(?![\w$])(?!\s+as(?![\w$]))[^}]*\}\s*from\s*[\x27"]temporal-spec[\x27"])[\s\S]*toEqualTypeOf<\s*Temporal\.'
  - id: contract-types-list-new-aggregates
    summary: |
      Optional. An emitted `contract.d.ts` lists the aggregates of every codec in the stack, so `prisma contract emit` now adds rows for the three new codecs to it, and the contract itself does not change. Re-emit when you next change the contract; until then the existing `contract.d.ts` keeps working. A migration snapshot's `contract.d.ts` does not need the new rows; it needs only the import change `branded-time-types-removed` describes.
---

# Explicit date and time types carry the kind of value they read

On PostgreSQL, a column type that several codecs read now names the kind of value in its name. The `Temporal` types gain the suffix `Temporal`, and the interval type that reads `{ months, days, micros }` gains the suffix `Parts`:

| Before | After | Reads |
| --- | --- | --- |
| `Timestamptz(p?)` | `TimestamptzTemporal(p?)` | `Temporal.Instant` |
| `Timestamp(p?)` | `TimestampTemporal(p?)` | `Temporal.PlainDateTime` |
| `Interval(p?)` | `IntervalParts(p?)` | `{ months, days, micros }` |

This change leaves `DateTime`, `Date` and `Time` as they are, and adds `DateTemporal` and `TimeTemporal` as the explicit names of what `Date` and `Time` read today. A separate change, the convenience date and time types, gives `DateTime`, `Date` and `Time` new meanings and has its own instructions. To keep what a field reads today, write the explicit name: `TimestamptzTemporal` for `DateTime`, `DateTemporal` for `Date` and `TimeTemporal` for `Time`.

Three explicit types are new, and need no change to existing schemas: `TimestampJsDate(p?)`, a `timestamp` column read as a JavaScript `Date`; `TimestampInstant(p?)`, a `timestamp` column read as a `Temporal.Instant`; and `IntervalString(p?)`, an `interval` column read as an ISO 8601 duration such as `P1Y2M`. Both timestamp types read and write the stored date and time as UTC.

## `psl-temporal-type-renames`

Rename each field type in your `.prisma` files using the table above, keeping its arguments and its attributes:

```prisma
model Event {
  id    Int                    @id
  at    TimestamptzTemporal(3) // was Timestamptz(3)
  local TimestampTemporal      // was Timestamp
  span  IntervalParts          // was Interval
}
```

A type alias written with one of the names, such as `types { Stamp = Timestamp(3) }`, is renamed the same way. The detection can match one of the words in a comment or a model name; rename only a field type or an alias's type.

## `ts-temporal-type-helpers-renamed`

```ts
field.column(type.TimestamptzTemporal(3)); // was type.Timestamptz(3)
field.column(intervalPartsColumn(6)); // was intervalColumn(6)
```

## `interval-with-precision-typed-as-parts`

```ts
import type { PgInterval } from '@prisma/orm-postgres/target/codec-types';

const span: PgInterval = row.span; // an IntervalParts(6) column
```

## `branded-time-types-removed`

Remove the four names from the import, and leave the rest of the file as it is:

```ts
import type {
  CodecTypes as PgTypes,
  JsonValue,
} from '@prisma/orm-postgres/target/codec-types'; // was also importing Interval, Time, Timestamp and Timestamptz
```

## `temporal-types-from-temporal-spec`

```ts
import type { Temporal } from 'temporal-spec';

expectTypeOf<Row['createdAt']>().toEqualTypeOf<Temporal.Instant>();
```

If the test file also creates `Temporal` values, import the type under another name, such as `import type { Temporal as TemporalTypes } from 'temporal-spec'`, so the runtime `Temporal` stays in scope.

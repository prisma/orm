# Postgres temporal representations

A PostgreSQL timestamp's storage type does not determine its JavaScript representation. Choose the representation in the contract: Temporal for precise time calculations, PostgreSQL text for its textual value space, or JavaScript `Date` for applications that use the built-in millisecond clock.

```prisma
model Event {
  id        Int @id
  occurred  TimestamptzDate(3)
  received  DateTimeDate
  createdAt temporal.createdAtDate()
  updatedAt temporal.updatedAtDate()
}
```

All four timestamp fields use `pg/timestamptz-date@1` and read/write JavaScript `Date` values. `occurred` declares `timestamptz(3)`; `received` leaves precision unspecified. `createdAt` has a database `now()` default. `updatedAt` uses a client-side Date-valued clock on both creation and update.

## Choose a representation

| PSL spelling | Codec | Application value | Storage |
| --- | --- | --- | --- |
| `DateTime`, `Timestamptz(p)` | `pg/timestamptz-temporal@1` | `Temporal.Instant` | `timestamptz(p)` |
| `TimestamptzString(p)` | `pg/timestamptz-string@1` | PostgreSQL text (`string`) | `timestamptz(p)` |
| `DateTimeDate`, `TimestamptzDate(p)` | `pg/timestamptz-date@1` | JavaScript `Date` | `timestamptz(p)` |

`p` is optional on the precision-bearing constructors. It controls database precision, not the resolution of JavaScript `Date`: a Date cannot represent sub-millisecond fractions, infinity, or the entire PostgreSQL timestamp range. Choose Temporal when microseconds matter, or the string representation for PostgreSQL values outside the application's date/time value space. Declaring precision 6 does not make a Date microsecond-precise: decoding drops fractional digits after the first three rather than rounding them. For example, a fractional second of `.123456` reads as `.123` on both flat and nested reads. Invalid Dates, infinities, and out-of-range timestamp values are rejected; use the string representation for unsupported PostgreSQL values.

The Date codec uses a string wire format and emits the built-in `Date` type without an import or precision brand. Date-valued columns and their Date-valued default generator do not require a Temporal polyfill. Other Temporal-backed columns in the same contract still do.

## TypeScript field presets

Use the composed helpers supplied by the Postgres `defineContract` callback:

```typescript
import { defineContract } from '@internal/postgres/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.id.uuidv4String(),
        occurred: field.temporal.timestamptzDate(3),
        received: field.dateTimeDate(),
        createdAt: field.temporal.createdAtDate(),
        updatedAt: field.temporal.updatedAtDate(),
      },
    }),
  },
}));
```

`field.temporal.timestamptzDate(precision?, onCreate?, onUpdate?)` accepts `'now'` for either phase. For example, `field.temporal.timestamptzDate(3, 'now', 'now')` uses the `timestampNow` generator on both phases; that generator returns a JS Date. The equivalent PSL form is `temporal.timestamptzDate(3, onCreate: now, onUpdate: now)`.

`createdAtDate()` uses a **storage default**, not an execution generator. `updatedAtDate()` selects the same codec and execution phases as `timestamptzDate(undefined, 'now', 'now')`.

For lower-level column authoring, use `pgTimestamptzDateColumn({ precision: 3 })` from `@internal/target-postgres/codecs`, or the static `timestamptzDateColumn` descriptor from `@internal/adapter-postgres/column-types`. Contract-free queries can opt in with `timestamptzDate()` from `@internal/target-postgres/contract-free`.

## Defaults and inference stay explicit

The Date descriptor declares `targetTypes: []`. It is registered for explicit codec lookup, runtime conversion, and emitted types, but does not compete for reverse inference of a database `timestamptz` column. Bare `DateTime`, `Timestamptz`, `field.dateTime()`, and the unsuffixed temporal presets remain Temporal-backed. The contract-free `timestamptz()` helper and internal control-table timestamps remain string-backed.

To switch an existing field, select a Date spelling and re-emit its contract and types. This changes the application's input/output representation; it does not inherently change the PostgreSQL storage type. Review any precision change separately.

## Aggregates

`min` and `max` preserve `pg/timestamptz-date@1` and its precision parameters, returning Date values or `null` for an empty input set. PostgreSQL timestamp columns do not support `sum` or `avg`, so this representation contributes neither operation. Count operations keep their ordinary numeric result codecs.

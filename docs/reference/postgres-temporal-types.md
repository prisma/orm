# PostgreSQL temporal types

PostgreSQL temporal columns choose between two application representations. The canonical one hands your code a `Temporal` value — `Temporal.Instant` for `timestamptz`, `Temporal.PlainDateTime` for `timestamp`, `Temporal.PlainDate` for `date`, `Temporal.PlainTime` for `time` — parsed from the text PostgreSQL itself emitted, at full microsecond precision. The alternative hands you that text unchanged, so a value Temporal cannot express still round-trips.

Neither representation is a JavaScript `Date`. `Date` has millisecond resolution and no way to say "a date with no time" or "a time with no date", so a `timestamp(6)` read through it silently loses microseconds and a `date` read through it acquires a spurious midnight in some timezone. That is the loss this pair of representations exists to remove.

## Choose a representation

| PostgreSQL type | Temporal spelling | Application value | String spelling | Application value |
| --- | --- | --- | --- | --- |
| `date` | `Date` | `Temporal.PlainDate` | `DateString` | `string` |
| `timestamp(p)` | `Timestamp(p)` | `Temporal.PlainDateTime` | `TimestampString(p)` | `string` |
| `timestamptz(p)` | `Timestamptz(p)` | `Temporal.Instant` | `TimestamptzString(p)` | `string` |
| `time(p)` | `Time(p)` | `Temporal.PlainTime` | `TimeString(p)` | `string` |

The codec ids behind them are `pg/date-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/time-temporal@1` and `pg/date-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/time-string@1`. What a pair shares is the column: the same storage, the same declared precision, and the same equality and ordering capabilities. Everything about how values cross the boundary differs. A Temporal codec accepts only its own `Temporal.*` type on writes and refuses anything else, parses and range-checks reads through `Temporal.*.from()`, serializes through `toString()`, and needs a `Temporal` implementation to be present at all. A string codec accepts and returns PostgreSQL's text unchanged in both directions, validates nothing, and needs no Temporal. So the choice decides what you write as much as what you read — and which values are representable in the first place.

**Reach for the string representation when** the column holds values Temporal has no way to denote (see [Values Temporal cannot represent](#values-temporal-cannot-represent)), when the application wants PostgreSQL to own all parsing and formatting, or when you do not want to install a Temporal implementation at all.

`timetz` and `interval` are unaffected by this choice and keep their existing behaviour. They have no Temporal or string variants.

## Introspection picks the Temporal spelling

`prisma contract infer` maps a native `date`, `timestamp`, `timestamptz`, or `time` column to the bare spelling — `Date`, `Timestamp(p)`, `Timestamptz(p)`, `Time(p)` — preserving the column's declared precision. The `*String` names are authoring-only: they claim no introspection mapping, so a bare `timestamptz` column never introspects to `TimestamptzString`. Choosing the string representation is always something you write down.

## Temporal is yours to provide

Prisma does not bundle, import, or select a Temporal implementation. Where the runtime has one natively, that is what gets used; otherwise install a global polyfill in your application's entry point, before any query runs:

```typescript
import 'temporal-polyfill/full/global';
```

`temporal-polyfill` ships two global builds. Take `full/global`: the default `global` build omits non-ISO calendars, and its published types resolve to `export {}`, so TypeScript will not see the `Temporal` namespace even once the runtime has it. Every setup file in this repository uses `full/global` for both reasons.

**Every read of a Temporal-backed column needs it.** The check is the first thing a Temporal codec does on decode, so it is not limited to explicitly constructed values — selecting the column is enough. Without a global implementation the read fails with `RUNTIME.TEMPORAL_UNAVAILABLE`, naming the codec and the operation, and pointing at the corresponding `*String` type.

**So does every write, including the ones you did not write.** Encoding a value you constructed obviously needs Temporal. Less obviously, so does `temporal.updatedAt()`: the column's clock produces a `Temporal.Instant`, so inserting a row into a table carrying that preset requires an implementation even if your code never mentions a temporal value. The same error code covers it, naming the generator and recommending `temporal.updatedAtString()`. `temporal.createdAt()` is unaffected — its value comes from a PostgreSQL storage default, not from a client-side clock.

The check is lazy in every other respect. Registering the target, validating a contract, building a runtime, resolving a codec descriptor and even constructing a codec instance all succeed with no `Temporal` in scope; only invoking one fails. A contract whose temporal columns all use `*String` codecs constructs and executes with no Temporal implementation anywhere.

### The CLI needs it too, for a literal default

A literal `@default(...)` on a Temporal-backed column is encoded **through the codec while the contract is being emitted**, inside the CLI's own process. Stock Node ships no `Temporal`, so:

```prisma
model Event {
  id         Int         @id
  occurredAt Timestamptz @default("2024-01-01T00:00:00Z")
}
```

fails at `prisma contract emit` with `CONTRACT.SOURCE_LOAD_FAILED` and "this runtime has no global Temporal implementation". A literal default therefore needs the string spelling today:

```prisma
model Event {
  id         Int               @id
  occurredAt TimestamptzString @default("2024-01-01T00:00:00Z")
}
```

This is a real limitation, not a style preference: there is currently no way to pair `Temporal.Instant` with a literal default. Function defaults are unaffected — `@default(now())` lowers to a PostgreSQL `now()` storage default that never passes through a codec, and works on either representation.

## The driver returns text, not `Date`

The PostgreSQL driver installs per-query type-parser overrides for the temporal OIDs and their array OIDs, in buffered and cursor execution alike, so PostgreSQL's own text reaches the codec untouched. It never mutates the global `pg.types` registry and never changes a user-supplied `Pool` or `Client` configuration.

Nested reads agree with flat ones. Temporal expressions are cast to `text` before PostgreSQL builds JSON, so a column read through `include(...)` returns the same server text — and therefore decodes to the same value — as the same column read at the top level, microseconds included.

One consequence is worth stating plainly: because the nested path renders through PostgreSQL, a nested `timestamptz` read reflects the **session** `TimeZone`, exactly as a flat one does. Both representations see the same text.

## Values Temporal cannot represent

A Temporal codec uses the matching `Temporal.*.from()` as its parser and range validator; Prisma maintains no ISO grammar of its own. Values that PostgreSQL can hold but Temporal cannot denote are rejected with a structured error that names the codec, the value, and the `*String` type that reads it losslessly:

| Value | Temporal codec | String codec |
| --- | --- | --- |
| `infinity`, `-infinity` | rejected — a sentinel with no position on the timeline | returned as `"infinity"` / `"-infinity"` |
| Years beyond Temporal's supported range (roughly ±271821) | rejected | returned as PostgreSQL renders them |
| Output under a non-ISO `DateStyle` (`German`, `SQL`, `Postgres`) | rejected — unparseable by `Temporal.*.from()` | returned unchanged |
| BC dates such as `0044-03-15 BC` | read, via a narrow era adaptation to Temporal's proleptic numbering | returned unchanged |

On the write side, a `Temporal.PlainDate` or `Temporal.PlainDateTime` carrying a non-ISO calendar is refused rather than silently reinterpreted. Temporal values are sent using their own `toString()` spelling, so PostgreSQL remains the authority on which spellings it accepts; its range and input errors surface as ordinary database errors.

## Precision

Writes send every fractional digit the value carries and let PostgreSQL round to the column's declared precision. Prisma neither truncates nor rejects sub-microsecond input, and a rounding that carries into the next second is PostgreSQL's answer, not an error:

```typescript
// into timestamptz(6)
Temporal.Instant.from('2026-01-02T23:59:59.999999999Z');  // stored as 2026-01-03T00:00:00Z
```

Reads preserve whatever the column holds. A `timestamp(6)` column round-trips its microseconds through both representations — flat, cursored, in an array, and through JSON-built nested results.

## Authoring

PSL uses the type names from the table above, with optional precision:

```prisma
model Event {
  id         Int               @id
  occurredAt Timestamptz(6)
  sourceTime TimestampString(6)
  day        Date
  startsAt   TimeString(0)
}
```

TypeScript contracts reach the same codecs through `field.temporal`:

| Preset | Codec | Application value |
| --- | --- | --- |
| `field.temporal.timestamp(p?)` | `pg/timestamp-temporal@1` | `Temporal.PlainDateTime` |
| `field.temporal.timestamptz(p?)` | `pg/timestamptz-temporal@1` | `Temporal.Instant` |
| `field.temporal.timestampString(p?)` | `pg/timestamp-string@1` | `string` |
| `field.temporal.timestamptzString(p?)` | `pg/timestamptz-string@1` | `string` |

Generated declarations reference the **global** `Temporal` namespace. They import no polyfill types and no polyfill runtime, so a contract compiles against whichever implementation your application provides.

### Storage defaults and last-modified columns

Four presets cover the common timestamp columns, in matched pairs:

| Preset | What it lowers to |
| --- | --- |
| `field.temporal.createdAt()` | `timestamptz` with a `now()` storage default, Temporal-backed |
| `field.temporal.updatedAt()` | `timestamptz` written on create and on update, Temporal-backed |
| `field.temporal.createdAtString()` | the same storage default, string-backed |
| `field.temporal.updatedAtString()` | the same write-on-create-and-update behaviour, string-backed |

The `*String` pair delegates to the same factory as the bare pair, so the two lower to the same shape and differ in the codec they name and the clock that answers them: a Temporal-backed column's `updatedAt` produces a `Temporal.Instant`, a string-backed one produces text. Both forms produce one timestamp per ORM operation — a `createAll([...])` of a hundred rows writes one value across every row and every timestamp-defaulted column, not a hundred — and both advance on update.

## What `prisma init` scaffolds

The starter contract uses the **string** spellings:

```prisma
createdAt TimestamptzString @default(now())
updatedAt temporal.updatedAtString()
```

with `field.temporal.createdAtString()` / `updatedAtString()` on the TypeScript side. This is deliberate. A scaffolded app runs on stock Node with no setup, which a Temporal-backed column could not do — the first read would raise `RUNTIME.TEMPORAL_UNAVAILABLE`. It also puts the representation choice in front of you on day one rather than hiding it: changing `TimestamptzString` to `Timestamptz` is a one-word edit, and if you have no Temporal implementation the error tells you so by name.

## Migrating from the retired codecs

Five codecs were removed with no compatibility aliases. A contract emitted before the change names a codec the registry no longer resolves and fails contract validation rather than degrading silently.

| Retired | Was | Replace with |
| --- | --- | --- |
| `sql/timestamp@1` (`field.timestamp()`) | generic cross-target timestamp, `Date` | `Timestamptz(p)` / `TimestamptzString(p)`, or the `field.temporal` presets |
| `pg/date@1` | `Date` | `Date` (now `Temporal.PlainDate`) or `DateString` |
| `pg/timestamp@1` | `Date` | `Timestamp(p)` or `TimestampString(p)` |
| `pg/timestamptz@1` | `Date` | `Timestamptz(p)` or `TimestamptzString(p)` |
| `pg/time@1` | `string` | `Time(p)` (now `Temporal.PlainTime`) or `TimeString(p)` |

The migration is a re-emit plus, where you want the old string-shaped behaviour, a rename in the schema. Two cases deserve attention:

- **`Time` changed representation twice over.** `pg/time@1` already handed back a `string`; the bare `Time` spelling now hands back a `Temporal.PlainTime`. If your code treated a time column as text, `TimeString(p)` is the spelling that keeps that, not `Time(p)`.
- **Everything else that was a `Date` is now a `Temporal.*` or a `string`.** Application code that called `Date` methods needs the Temporal equivalent (`Temporal.Instant.compare(a, b)` in place of `a.getTime() - b.getTime()`), or the `*String` spelling if you would rather keep text.

Regenerate every checked-in contract artifact after the rename: `prisma contract emit` rewrites `contract.json` and `contract.d.ts` together, and the generated declarations are where the new application types become visible.

## Related

- [Codec authoring guide](./codec-authoring-guide.md) — contributor-facing guidance for implementing codecs
- [Integer representation types](./integer-representation-types.md) — the same representation-choice pattern for integer columns
- [Error reference](./error-reference.md) — the envelopes `RUNTIME.TEMPORAL_UNAVAILABLE` and the boundary errors surface as

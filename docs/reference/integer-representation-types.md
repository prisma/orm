# Integer representation types

Prisma 8 SQL contracts can choose how integer columns appear in application code. Use the default `BigInt` type when the database's integer range is sufficient and the application can work with `bigint`; opt into a JavaScript `number` guarded by the safe-integer range, written `BigInt(as: number)` on PostgreSQL and `BigIntNumber` on SQLite; on PostgreSQL, write `BigInt(storage: numeric)` when values must remain exact beyond 64-bit storage. On PostgreSQL, `BigInt` is a convenience type ([ADR 316](../architecture%20docs/adrs/ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md)) whose calls choose the explicit types `Int8BigInt`, `Int8Number` and `NumericBigInt`.

## Choose a representation

| PostgreSQL / SQLite | Codec | Storage | Application value | Stored and projected as | Choose when |
| --- | --- | --- | --- | --- | --- |
| `BigInt` (`Int8BigInt`) / `BigInt` | `pg/int8@1` / `sqlite/bigint@1` | `int8` / INTEGER | `bigint` | decimal text | The database's integer range is sufficient and application code can use `bigint`. |
| `BigInt(as: number)` (`Int8Number`) / `BigIntNumber` | `pg/int8number@1` / `sqlite/bigintnumber@1` | `int8` / INTEGER | `number` | decimal text | Application code requires `number` and all values stay within ±(2^53 − 1). |
| `BigInt(storage: numeric)` (`NumericBigInt`) / — | `pg/unboundedint@1` | unconstrained `numeric` | `bigint` | decimal text | Integer values must remain exact beyond the signed 64-bit range. |

SQLite declares no unbounded integer type because it has no lossless unbounded integer storage. Type availability follows the active target's declaration.

## Runtime guards and canonical JSON

**`Int8Number` and SQLite's `BigIntNumber` guard instead of rounding.** The codec accepts integers within ±(2^53 − 1), the range a JavaScript `number` holds exactly, and throws a structured error on anything else in both directions: `RUNTIME.ENCODE_FAILED` on write and `RUNTIME.DECODE_FAILED` on a read, from a row, an include or a stored value, each carrying `meta.codecId`. Non-integral values are refused the same way. A `bigint` or decimal-text wire value is range-checked exactly before any conversion to `number`, so an out-of-range value throws rather than rounds. See the [error reference](./error-reference.md#runtimedecode_failed) for how the envelopes surface, including the SQLite flat-read caveat.

**Every 64-bit integer travels as decimal text.** `pg/int8number@1` and `sqlite/bigintnumber@1` store their value as the digit text of `pg/int8` and `sqlite/integer`, and project their column as decimal text, as `pg/int8@1` and `sqlite/bigint@1` do. `fromWire` checks the range on that text before it converts to a `number`, so an out-of-range value throws rather than rounds.

**`NumericBigInt` stays on decimal text.** Its projection is `decimalTextJsonProjection`, like `numeric` and `int8`; `toWire` writes the `bigint`'s decimal digits, and `fromWire` rejects non-integral values, including `NaN` and the infinities, which are `numeric` values but not integers. The round-trip is exact at any magnitude, proven past 2^63 by the conformance suite.

## Authoring

These are ordinary target-scoped types, so ordinary scalar modifiers apply subject to the target's capabilities. On PostgreSQL:

```prisma
model Meter {
  id       Int                      @id
  peak     BigInt(as: number)
  lifetime BigInt(storage: numeric)
}
```

TypeScript contracts pass the composed type to `field.column(...)`, and can keep it in a constant that several fields share:

```typescript
const SafeCount = field.column(type.BigInt({ as: 'number' }));

return {
  models: {
    Meter: model('Meter', {
      fields: {
        peak: SafeCount,
        lifetime: field.column(type.BigInt({ storage: 'numeric' })),
      },
    }),
  },
};
```

For direct per-column declarations, use `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` on PostgreSQL, and `field.column(sqliteBigintNumberColumn())` on SQLite. Both forms select the same codecs and application types.

Introspection chooses a codec for a reported type from the target's own table of codecs, which names only the original codecs, so PostgreSQL `int8` and `numeric` and SQLite `integer` in type position keep their existing codecs and introspection remains unambiguous. Authoring availability does not make a reverse-introspection claim.

## Aggregate results

Aggregates over these columns resolve through the targets' descriptor matrices, under the [defaults policy](./aggregate-descriptor-guide.md#the-defaults-policy): the bare operations read as JS-native values and throw where a value cannot be one, and the suffixed variants read losslessly.

| Column type | `sum` | `sumBigInt` | `avg` | `avgDecimal` | `min` / `max` |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL `BigInt(as: number)` (`pg/int8number@1`) | `number`, throwing outside ±(2^53 − 1) | `bigint`, exact at any magnitude (`pg/unboundedint@1`) | `number` | decimal string | the column's own type |
| PostgreSQL `BigInt(storage: numeric)` (`pg/unboundedint@1`) | `bigint`, exact | `bigint`, exact | `number` | decimal string | the column's own type |
| SQLite `BigIntNumber` (`sqlite/bigintnumber@1`) | `number`, throwing outside ±(2^53 − 1) | `bigint` (`sqlite/bigint@1`) | `number` | not contributed | the column's own type |

`sum` over `unboundedint` keeps its own codec because a sum of integers is integral, so the codec's integrality-checked `bigint` `fromWire` is the right reader for the total. `min` and `max` return the column's own type on both targets through the numeric-trait fallback. SQLite contributes no `avgDecimal`, having no exact decimal result codec to answer one with.

## Run it

`examples/prisma-8-demo` puts all three representations on one model and reads them back: `pnpm start -- integer-representations` prints each counter with the JavaScript type it arrived as, and `pnpm start -- aggregate-precision` puts the bare operations beside the lossless variants, including a `sum` whose total passes the safe-integer boundary and raises instead of rounding. `examples/prisma-8-demo-sqlite` runs the same two commands over the pair of representations SQLite offers.

Contributor guidance for implementing codecs lives in the [codec authoring guide](./codec-authoring-guide.md).

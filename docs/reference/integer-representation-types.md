# Integer representation types

Prisma 8 SQL contracts can choose how integer columns appear in application code. Use the default `BigInt` type when the database's integer range is sufficient and the application can work with `bigint`; opt into `BigIntNumber` for JavaScript `number` values guarded by the safe-integer range; use PostgreSQL-only `UnboundedInt` when values must remain exact beyond 64-bit storage.

## Choose a representation

| Type | Targets | Codec | Storage | Application value | Canonical JSON | Choose when |
| --- | --- | --- | --- | --- | --- | --- |
| `BigInt` | PostgreSQL, SQLite | `pg/int8@1` / `sqlite/bigint@1` | `int8` / INTEGER | `bigint` | decimal text | The database's integer range is sufficient and application code can use `bigint`. |
| `BigIntNumber` | PostgreSQL, SQLite | `pg/int8number@1` / `sqlite/bigintnumber@1` | `int8` / INTEGER | `number` | JSON number | Application code requires `number` and all values stay within ±(2^53 − 1). |
| `UnboundedInt` | PostgreSQL | `pg/unboundedint@1` | unconstrained `numeric` | `bigint` | decimal text | Integer values must remain exact beyond the signed 64-bit range. |

SQLite declares no `UnboundedInt` because it has no lossless unbounded integer storage. Type availability follows the active target's declaration.

## Runtime guards and canonical JSON

**`BigIntNumber` guards instead of rounding.** The codec accepts integers within ±(2^53 − 1), the range a JavaScript `number` holds exactly, and throws a structured error on anything else in both directions: `RUNTIME.ENCODE_FAILED` on write and `RUNTIME.DECODE_FAILED` on read from wire or JSON, each carrying `meta.codecId`. Non-integral values are refused the same way. A `bigint` or decimal-text wire value is range-checked exactly before any conversion to `number`, so an out-of-range value throws rather than rounds. See the [error reference](./error-reference.md#runtimedecode_failed) for how the envelopes surface, including the SQLite flat-read caveat.

**The JSON-number canonical form is sound.** `pg/int8number@1` and `sqlite/bigintnumber@1` project their column as a plain JSON number, the one deliberate exception to 64-bit integers traveling as decimal text. ECMAScript mandates IEEE 754 binary64, `Number.MAX_SAFE_INTEGER` is exactly 2^53 − 1, and double rounding is monotone with 2^53 exactly representable, so no true value outside ±(2^53 − 1) can parse into the safe range. `decodeJson` checks the range after `JSON.parse`, and that post-parse guard cannot false-pass.

**`UnboundedInt` stays on decimal text.** Its projection is `decimalTextJsonProjection`, like `numeric` and `int8`; encode writes the `bigint`'s decimal digits, and decode rejects non-integral values, including `NaN` and the infinities, which are `numeric` values but not integers. The round-trip is exact at any magnitude, proven past 2^63 by the conformance suite.

## Authoring

These are ordinary target-scoped types rather than field presets, so ordinary scalar modifiers apply subject to the target's capabilities. PSL uses the bare type names:

```prisma
model Meter {
  id       Int          @id
  peak     BigIntNumber
  lifetime UnboundedInt
}
```

TypeScript contracts can register composed type instances and reuse those exact instances with `field.namedType(...)`:

```typescript
const types = {
  BigIntNumber: type.BigIntNumber(),
  UnboundedInt: type.UnboundedInt(),
} as const;

return {
  types,
  models: {
    Meter: model('Meter', {
      fields: {
        peak: field.namedType(types.BigIntNumber),
        lifetime: field.namedType(types.UnboundedInt),
      },
    }),
  },
};
```

For direct per-column declarations, use `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` on PostgreSQL, and `field.column(sqliteBigintNumberColumn())` on SQLite. The named and direct forms select the same codecs and application types.

All three alternative-representation descriptors declare `targetTypes: []`, so PostgreSQL `int8` and `numeric` and SQLite `integer` in type position keep their existing codecs and introspection remains unambiguous. Authoring availability does not make a reverse-introspection claim.

## Aggregate results

Aggregates over these columns resolve through the targets' descriptor matrices, under the [defaults policy](./aggregate-descriptor-guide.md#the-defaults-policy): the bare operations read as JS-native values and throw where a value cannot be one, and the suffixed variants read losslessly.

| Column type | `sum` | `sumBigInt` | `avg` | `avgDecimal` | `min` / `max` |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL `BigIntNumber` (`pg/int8number@1`) | `number`, throwing outside ±(2^53 − 1) | `bigint`, exact at any magnitude (`pg/unboundedint@1`) | `number` | decimal string | the column's own type |
| PostgreSQL `UnboundedInt` (`pg/unboundedint@1`) | `bigint`, exact | `bigint`, exact | `number` | decimal string | the column's own type |
| SQLite `BigIntNumber` (`sqlite/bigintnumber@1`) | `number`, throwing outside ±(2^53 − 1) | `bigint` (`sqlite/bigint@1`) | `number` | not contributed | the column's own type |

`sum` over `unboundedint` keeps its own codec because a sum of integers is integral, so the codec's integrality-checked `bigint` decode is the right reader for the total. `min` and `max` return the column's own type on both targets through the numeric-trait fallback. SQLite contributes no `avgDecimal`, having no exact decimal result codec to answer one with.

## Run it

`examples/prisma-8-demo` puts all three representations on one model and reads them back: `pnpm start -- integer-representations` prints each counter with the JavaScript type it arrived as, and `pnpm start -- aggregate-precision` puts the bare operations beside the lossless variants, including a `sum` whose total passes the safe-integer boundary and raises instead of rounding. `examples/prisma-8-demo-sqlite` runs the same two commands over the pair of representations SQLite offers.

Contributor guidance for implementing codecs lives in the [codec authoring guide](./codec-authoring-guide.md).

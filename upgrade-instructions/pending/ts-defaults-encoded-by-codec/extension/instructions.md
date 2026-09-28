---
changes:
  - id: ts-defaults-encoded-by-codec
    summary: |
      `defineContract` from the Postgres and SQLite packages now encodes every literal `.default(value)` through the column's codec. The literal is the codec's input type. TypeScript checks it for fields built inside the `defineContract` factory, and the build fails with `CONTRACT.DEFAULT_INVALID` for a value the codec refuses. Pass a value of the codec's input type, or choose the field preset whose codec takes the value you have.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.default\(\s*(?!now\(\)|autoincrement\(\)|sql`)'
---

## `ts-defaults-encoded-by-codec`

A TypeScript contract used to store the value passed to `.default(value)` as it stood. The column's codec now encodes it, so the value must be the codec's input type. For a field built inside the `defineContract` factory, `.default()` is typed with that input type, so a wrong value is a type error in `contract.ts`. PSL contracts, `.default(now())`, `.default(autoincrement())` and `` .default(sql`...`) `` are not affected.

What now fails, on Postgres:

```typescript
// before: emitted, although the codec of field.dateTime() holds a Temporal.Instant
createdAt: field.dateTime().default('2024-01-01T00:00:00Z'),
```

```text
CONTRACT.DEFAULT_INVALID: Field "Event.createdAt" has a default that its codec refuses: Codec 'pg/timestamptz-temporal@1' encodes a Temporal.Instant, but received a string.
```

1. Search your contract files for `.default(` with a literal argument.
2. Type-check the contract file, then run `prisma contract emit`. TypeScript reports a default of the wrong type; the emit reports each default the codec refuses, with its model and field.
3. For each one, either pass the codec's type or change the preset:

| You have | Write |
| --- | --- |
| an ISO 8601 string | `field.temporal.timestamptzString().default('2024-01-01T00:00:00Z')` |
| a JavaScript `Date` | `field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z'))` |
| a `Temporal.Instant` | `field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z'))` |

Changing the preset changes the column's codec, and so the type your queries read and write for that field. On Postgres, `field.bigint()` takes a `bigint` and `field.bytes()` takes a `Uint8Array`. On SQLite, `field.temporal.datetime()` takes a `Date`, `field.column(bigintColumn)` takes a `bigint` and `field.column(blobColumn)` takes a `Uint8Array`.

On Node 24 there is no global `Temporal`. A contract file that creates a `Temporal` value must load an implementation itself, for example with `import 'temporal-polyfill/full/global'` as its first import. The type check on a `Temporal` field needs the `Temporal` type declarations in the project, for example from `temporal-polyfill/global`; without them the parameter is unchecked. The error shown above is the one you get with an implementation loaded; without one, the codec reports that the runtime has no global `Temporal` implementation.

`.default(null)` used to store `null`. It is now a type error on a field whose codec input type does not include `null`, which is every built-in codec except the JSON codecs: `field.json().optional().default(null)` still compiles and stores `null`. When the contract is built, the codec receives the `null`: a codec that checks its input, such as `pg/int8@1`, refuses it with `CONTRACT.DEFAULT_INVALID`, and a codec that passes any value through, such as `pg/text@1`, still stores `null`. A column without a default already defaults to `NULL` in the database, so remove the call.

A JavaScript `number` on a `bigint` field (codec `pg/int8@1`), such as `field.bigint().default(1)` inside the `defineContract` factory, is now a type error. Write a `bigint` literal: `field.bigint().default(1n)`. The default is stored as `"1"`, as the table below shows.

A default that gets past the type check, for example from an untyped caller, is stored in a different form than before:

| Default | Stored before | Stored now |
| --- | --- | --- |
| `field.bigint().default(1)` (also SQLite `bigintColumn`) | `1` | `"1"` |
| `field.bytes().default('x')` | `"x"` | `"eA=="` (base64) |
| SQLite `blobColumn` with `.default('x')` | `"x"` | `"78"` (hex) |

A contract with such a default emits a different `contract.json` and a different storage hash. Re-emit the contract and review the diff of `contract.json`.

A literal default on a column whose codec no pack in the contract declares now fails with `CONTRACT.DEFAULT_INVALID`, because nothing can check it. List the pack that owns the codec in the `extensions` of `defineContract`.

### For extension authors

- A pack passed in `extensions` contributes its codecs to this lookup through `types.codecTypes.codecDescriptors`. A default on a column of your codec is now passed to your codec's `encodeJson`, built with the column's `typeParams`. Make `encodeJson` throw for a value it cannot encode; the build reports your message.
- A codec descriptor that the target's codec registry refuses (for Postgres, one that does not extend `PostgresCodecDescriptor` and is not wrapped with `postgresCodec()`), or that reuses a built-in codec id, now fails `defineContract` as it already failed when the control stack was assembled.
- A caller who passes `codecLookup` to `defineContract` keeps that lookup; the facade does not add to it.
- A column helper that is a function, such as `varcharColumn(n)`, `timeTemporalColumn()` or pgvector's `vector(n)`, now declares its literal codec id in its return type. One variable can no longer be reassigned between the results of different helpers; annotate such a variable as `ColumnTypeDescriptor`.

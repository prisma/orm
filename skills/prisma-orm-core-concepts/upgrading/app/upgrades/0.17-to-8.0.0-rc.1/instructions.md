---
from: "0.17"
to: "8.0.0-rc.1"
changes:
  - id: aggregate-results-carry-their-target-s-codec
    summary: |
      Aggregates read back through the codec their target declares for the result, so their
      application types change. `count()` is a `bigint` on both targets — a count is a cardinality
      and is not capped at 2^53. On PostgreSQL, `sum` over `int2`/`int4` widens to `int8` and reads
      as a `bigint`, while `sum(int8)` and `avg` over any integer are `numeric` and read as decimal
      **strings**; `min`/`max` keep the column's own type, except over `varchar`, where PostgreSQL
      returns `text`. On SQLite, `sum` over an integer column is a `bigint` and `avg` is always a
      `number` (real). The two targets genuinely diverge on `avg` — a portable query must handle
      both, and there is no shim that flattens them. Include reducers
      (`.include('posts', (p) => p.count())`) decode the same way, so an included count is a
      `bigint` too, and an empty relation reads `0n` rather than `0`. Comparisons are where this
      bites quietly: `count === 2` is false where `count` is `2n`, and `JSON.stringify` throws on a
      bigint. Sweep for `toBe(<number>)` / `=== <number>` / arithmetic against an aggregate result
      and switch to `2n` or the decimal string, and render bigints explicitly (`String(value)`)
      wherever you serialise. `having(...)` operands are the exception and stay numbers — they are
      compared inside SQL and never cross a codec. Regenerate your contracts
      (`prisma-next contract emit`): the emitted `contract.d.ts` gains an `AggregateTypes` block
      that types every aggregate per operation and input codec, and the ORM and SQL builder both
      resolve their result types from it — against a contract emitted before 8.0.0-rc.1 an aggregate
      resolves to `never` in the ORM and to `unknown` in the SQL builder.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "aggregate("
        - ".count()"
        - "groupBy("
      anyMatch: true
---

# 0.17 → 8.0.0-rc.1 — User upgrade instructions

## `aggregate-results-carry-their-target-s-codec`

An aggregate's result is a value the database computes, and 8.0.0-rc.1 reads it back through the codec its target declares for that result rather than through whatever the driver happened to hand over. What each aggregate returns is now the target's answer, stated in the contract and honoured by the runtime:

| Target | Aggregate | Reads as |
| --- | --- | --- |
| PostgreSQL | `count()` (with or without an argument) | `bigint` |
| PostgreSQL | `sum` over `int2` / `int4` | `bigint` (the sum widens to `int8`) |
| PostgreSQL | `sum` over `int8`, `avg` over any integer | decimal `string` (the result is `numeric`) |
| PostgreSQL | `sum` / `avg` over `float4` / `float8` | `number` |
| PostgreSQL | `min` / `max` | the column's own type — except over `varchar`, which returns `text` |
| SQLite | `count()` | `bigint` |
| SQLite | `sum` over an integer column | `bigint` |
| SQLite | `avg` over anything | `number` (SQLite's `avg` is always real) |
| SQLite | `min` / `max` | the column's own type |

The targets diverge on `avg`, and deliberately: PostgreSQL computes it as `numeric`, SQLite as a float. A query written against both handles both.

Include reducers follow the same rules — `.include('posts', (posts) => posts.count())` yields a `bigint`, and a parent with no related rows reads `0n` where it read `0`.

Two failure modes are worth sweeping for, because neither announces itself:

- **Equality against a number.** `row.count === 2` is `false` when `row.count` is `2n`, and `expect(count).toBe(2)` fails the same way. Change the literal (`2n`), or compare through `Number(...)` where the magnitude is known to be small.
- **Serialisation.** `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`. Render explicitly — `String(count)`, or a replacer that maps bigints to strings.

Arithmetic mixing a bigint with a number also throws (`2n + 1` is a `TypeError`); convert one side deliberately.

`having(...)` is the one place that does not move. A HAVING operand is compared inside SQL against the aggregate the database is computing, so it never crosses a codec: `having.count().gte(2)` keeps the plain number it always took. Only the aggregate's *result* — the value that reaches your code — carries its target's type.

Finally, regenerate your contracts:

```bash
prisma-next contract emit
```

The emitted `contract.d.ts` gains an `AggregateTypes` block — the settled result identity per operation and per input codec — and both the ORM client and the SQL builder resolve their aggregate result types from it. Against a contract emitted before 8.0.0-rc.1 the block is absent, so an aggregate resolves to `never` in the ORM and to `unknown` in the SQL builder: a type error at the call site in the first case, an untyped value in the second, rather than a wrong runtime value in either.

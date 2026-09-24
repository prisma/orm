# Aggregate descriptor guide

A codec says how one value converts. An aggregate is a *new* value the database computes from many, and what it returns is a property of the operation, the target, and sometimes the input — `sum` over PostgreSQL's `int4` is an `int8`, over its `int8` a `numeric`, and over SQLite's integers an integer that only the bigint codec carries. None of that is derivable from the input codec, so it is declared separately, as `SqlAggregateDescriptor` contributions on `types.aggregateDescriptors`, a sibling of `codecTypes`.

This guide covers that descriptor surface: what a descriptor claims, what it declares, what a contribution gives the caller, and what a consumer reads off a resolution. Codec authoring itself — codec classes, descriptors, and column helpers — is the [codec authoring guide](./codec-authoring-guide.md).

```ts
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';

const sumOfSmallIntegers: SqlAggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: true,
};
```

## The operation name

`operation` is a name of the contributor's choosing, not a member of a fixed list. The names the built-in targets contribute exist because those targets declare them: PostgreSQL contributes eight — `count`, `countBigInt`, `sum`, `sumBigInt`, `avg`, `avgDecimal`, `min`, `max` — and SQLite the same seven bar `avgDecimal`. A component that declares `bitOr` or `median` gets that operation on the same surfaces: the SQL DSL's aggregate functions, the ORM's `aggregate()` and `groupBy().aggregate()`, and the include reducers on a collection. Every one of those surfaces derives its method set from the contributed vocabulary — the composed registry at runtime, the contract's emitted `aggregateTypes` at the type level — so a new operation needs no change to the lane or the client.

The AST's aggregate alphabet is a different, closed set. `AggregateFn` (`count | sum | avg | min | max`) is the set of function names an `AggregateExpr` node can carry, and so the set the renderers are exhaustive over. An operation named in the alphabet reaches SQL as a plain aggregate call; every other operation reaches it only through a lowering hook, which [Lowering](#lowering-what-builds-the-expression) covers.

## The four input matches

A descriptor claims one `(operation, input)` pair, and exactly one component may claim it across a composed stack. The input match is one of four kinds:

| Kind | Claims | Example |
| --- | --- | --- |
| `none` | a call with no input at all | a count over rows |
| `codec` | one exact codec id | `sumBigInt` over `pg/int8@1`, which goes to `pg/unboundedint@1` where the small integers go to `pg/int8@1` |
| `trait` | every codec advertising the trait | `min` over anything `textual` |
| `any` | any input, and no input — a result that does not depend on what it aggregates | `count`, which is an integer whether it counts rows or values |

Resolution consults them in that order of specificity: an exact codec match, then a trait match, then the input-agnostic entry. That is what lets a target state a general rule and one exception — PostgreSQL's `min`/`max` preserve every `textual` codec's own type *except* `varchar`, whose extremum the database returns as `text`, so `varchar` claims itself exactly and shadows the trait.

Two codecs may not both claim one input by trait: a codec carrying two claimed traits leaves the result undetermined, and composition fails with `RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR` rather than picking one. Contribute an exact descriptor for the contested codec, or narrow the traits.

## Declaring the result

`output` is either `self` — the matched input's codec, for an aggregate that returns one of the values it read, like `min` — or a named codec id. A named output may resolve its own type parameters from the input reference, but it cannot change which codec id the result carries. An aggregate that produces a *new* value names its codec without the input's type parameters: a `numeric(10,3)` column sums to an unconstrained `numeric`, and carrying the column's precision into the result would understate its range.

`nullable` is declared, never inferred from the input: SQL answers an empty input set with `NULL` for `sum`, `avg`, `min`, and `max`, and with zero for `count`.

### The empty-result value

A descriptor that declares `nullable: false` must also declare `emptyResultJson` — the value the operation answers with when no result row reaches the caller at all. The two travel together in the type, so a non-nullable descriptor without it does not compile:

```ts
const count: SqlAggregateDescriptor = {
  operation: 'count',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'pg/int8number@1' },
  nullable: false,
  emptyResultJson: '0',
};
```

State the value in the **result codec's canonical JSON**; the client decodes it through that codec, so the application sees the same shape a real row would produce. `count`'s zero is the decimal string `'0'` under both `pg/int8number@1` and `pg/int8@1`, the canonical form of the `pg/int8` data type both represent; the two differ in what they decode it into, a `number` and a `bigint`.

The value lives on the descriptor rather than on the codec because the empty-input answer is a property of the operation, not of the type its result carries. `count`'s identity element is zero; an `every()` operation's would be `true`; a `product()`'s would be one. A codec has no way to know which.

SQL answers an empty input set itself, so the declared value is read only in the degenerate cases where no row carries the aggregate: an absent aggregate alias, or an include whose envelope never arrived.

## The relationship to canonical JSON

An aggregate's result enters a JSON envelope wherever it is an include reducer, and it goes in under the codec resolved here — which is why [the canonical JSON guarantee](./codec-authoring-guide.md#the-canonical-json-guarantee) applies to aggregates too. A `numeric` result read as a JSON number would be the same defect as a `numeric` column read as one.

The number-flavoured integer codecs are the deliberate exception, and they are safe because the range check reads the exact decimal text. `pg/int8number@1` and `sqlite/bigintnumber@1` decode the decimal text their type stores into a `number`, and the range check runs on the exact text before the conversion, so a true value outside ±(2^53 − 1) is refused rather than rounded into range. A `sum` past the boundary therefore raises `RUNTIME.DECODE_FAILED` on the include path exactly as it does on the wire path.

## Lowering: what builds the expression

A descriptor may carry a `lower` hook, which builds the expression the target wants:

```ts
const castResultToText =
  (operation: AggregateFn): SqlAggregateLowering =>
  ({ expr }) =>
    CastExpr.as(new AggregateExpr(operation, expr), 'text');
```

The hook returns an expression and nothing else — it has no channel for a codec, so the descriptor's declared `output` remains the only source of result identity, whatever the hook builds. Both built-in matrices use it, for three distinct jobs:

| Target | Rows with a hook | What the hook builds |
| --- | --- | --- |
| SQLite | every row that names `sqlite/bigint@1` or `sqlite/bigintnumber@1` as its result codec — `count`, `countBigInt`, `sum`, `sumBigInt` — plus `min`/`max` over `sqlite/bigint@1` | `CAST(<agg>(…) AS text)` — the database computes those into an INTEGER, and `node:sqlite` raises rather than returning one a JS number cannot hold, so the cast keeps the value readable and lets the codec's own range error be the one users see. For `countBigInt` and `sumBigInt` the cast wraps the aggregate their bare namesake uses |
| PostgreSQL | `avg` over every integer input | `CAST(avg(…) AS float8)` — a **result** cast, so the exact `numeric` mean is computed first and rounded once; casting the input instead would round every value before accumulation |
| PostgreSQL | `countBigInt`, `sumBigInt`, `avgDecimal` | the SQL aggregate the bare namesake uses (`count`, `sum`, `avg`) — the database has no function under the variant's name |

One SQLite pair reaches a wide-integer result without a hook: `min` and `max` over a `sqlite/bigintnumber@1` column. `sqlite/bigint@1` claims its own extrema exactly and so carries the cast; `sqlite/bigintnumber@1` has no such row, matches the `numeric`-trait row instead, and outputs `self`. The extremum is therefore read exactly the way the column itself is read — a plain value from the driver — and the [SQLite flat-read caveat](./error-reference.md#runtimedecode_failed) applies to both alike: `node:sqlite` refuses an INTEGER outside the safe range before any codec runs, so the structured envelope is guaranteed on the include/JSON path rather than the flat one.

For an operation whose name is in the AST's aggregate alphabet, the hook is optional and changes only the wire form. For any other name it is required, because there is no plain form to fall back to: the whole expression is the hook's to build, from the nodes that already exist — a function call, a cast, an aggregate call wrapped in either.

```ts
const bitOr: SqlAggregateDescriptor = {
  operation: 'bitOr',
  input: { kind: 'codec', codecId: 'pg/int8@1' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: true,
  lower: ({ expr }) => FunctionCallExpr.of('bit_or', expr === undefined ? [] : [expr]),
};
```

Composition rejects a descriptor that declares a name outside the alphabet and no hook, with `RUNTIME.AGGREGATE_LOWERING_MISSING`. The check runs while the execution context assembles the registry, so the failure lands at composition rather than at the first query that reaches for the operation.

An operation outside the alphabet is also **projection-only**. Its lowered form is a rendering for the driver boundary, where the value leaves SQL; HAVING, ORDER BY, and comparison operands compare inside the database, where the rendering would change what the comparison means — a value rendered as text compares and sorts lexicographically. So a contributed operation is available in a projection and refused in those positions, in the SQL DSL and the ORM alike, with `ORM.AGGREGATE_PROJECTION_ONLY` at authoring time. The ORM's typed HAVING surface says the same thing statically: it carries a method only for operations in the alphabet.

## The defaults policy

The built-in targets split the aggregate vocabulary in two, and a contributed operation should follow the same split.

**Bare operations answer in the type a JS developer expects.** `count`, `sum`, and `avg` over integer inputs read as `number`. Where a value cannot be a `number`, the codec's guard throws `RUNTIME.DECODE_FAILED` rather than handing back a rounded one.

**Suffixed operations answer losslessly.** `countBigInt`, `sumBigInt`, and `avgDecimal` are the escape hatches, named so a caller reaching for exactness reaches for one name rather than a rule about column widths.

**Bare operations over Float and Decimal columns stay in the column's own family.** Those users already chose their representation; `sum` over `numeric` is a `numeric`, and `sum` over `float8` a `float8`.

**`min` and `max` answer in the input's own type.** They output `self`, so an extremum is one of the values that were read.

Here is what PostgreSQL declares, by input class:

| Operation | Input | Result codec | Application value |
| --- | --- | --- | --- |
| `count` | none or any | `pg/int8number@1` | `number`, throwing outside ±(2^53 − 1) |
| `countBigInt` | none or any | `pg/int8@1` | `bigint` |
| `sum` | `int2`, `int4`, `int`, `int8`, `int8number` | `pg/int8number@1` | `number`, throwing outside ±(2^53 − 1) |
| `sum` | `float4` / `numeric` / `unboundedint` / `interval` | the input's own codec | unchanged |
| `sum` | `float8` / `float` | `pg/float8@1` | a `number` |
| `sum` | `time` | `pg/interval@1` | a duration |
| `sumBigInt` | `int2`, `int4`, `int` | `pg/int8@1` | `bigint`, raising `bigint out of range` past 2^63 |
| `sumBigInt` | `int8`, `int8number`, `unboundedint` | `pg/unboundedint@1` | `bigint`, exact at any magnitude |
| `avg` | every integer, `unboundedint` included | `pg/float8@1` | `number` |
| `avg` | `float4` / `float8` / `float` | `pg/float8@1` — `float4` widens, as PostgreSQL's own `avg` does | `number` |
| `avg` | `numeric` / `interval` | the input's own codec | unchanged |
| `avg` | `time` | `pg/interval@1` | a duration |
| `avgDecimal` | every integer, plus `numeric` | `pg/numeric@1` | decimal string |

The input column names each codec by its suffix, and two of those names cover a pair of ids: `int` is `pg/int@1` and `sql/int@1`, the portable integer over an `int4` column, and `float` is `pg/float@1` and `sql/float@1`, the portable double precision. Each row claims both ids of the pair.

`sumBigInt` over a 64-bit column reads PostgreSQL's own `numeric` total through `pg/unboundedint@1`. Casting that total back to `int8` would raise `bigint out of range` past 2^63 — an overflow this row deliberately does not have.

SQLite states the same policy in its own terms. `count` and `sum` over integers read through `sqlite/bigintnumber@1` (`number`, throwing); `countBigInt` and `sumBigInt` read through `sqlite/bigint@1`, bounded by SQLite's own `integer overflow` raise on a 64-bit `SUM`. `avg` is natively REAL and so is already a `number`. There is **no `avgDecimal`**: an exact mean needs a decimal result codec, and SQLite has none — the operation is simply absent from SQLite contracts, so the call is a type error rather than a runtime failure.

## What a declaration gives the caller

The rows a contribution settles into decide the call shapes the operation surfaces with:

| Rows | Call shape |
| --- | --- |
| `withoutInput` (from a `none` or `any` input match) | a zero-argument call |
| `byCodec` / `anyInput` | a call taking a field, admitting exactly the fields whose codec a row claims |
| both | both |

`count` has both shapes because PostgreSQL declares it over `{ kind: 'any' }` — an input match that answers a call with a value and a call without one — and not because anything special-cases it.

One naming constraint applies. Include reducers install into the ORM collection's own namespace, beside `select`, `where`, `include`, and the rest of the query builder, so an operation may not take a name a built-in collection member already owns; `orm(...)` rejects one that does with `ORM.AGGREGATE_OPERATION_RESERVED`.

A custom collection class registered through `orm({ collections })` sits outside that check, and its own members take precedence: a member whose name an operation also carries keeps the name, and the collection installs no reducer for that operation. Where the contract's emitted map declares the operation, TypeScript holds the member to the reducer's signature — the collection surface is the class intersected with the reducer set — so what passes silently is a member the types never promised.

## What a consumer stamps

A planner that builds an aggregate reads two different things off the resolution and must not confuse them:

- **`codec`** is the decode identity — the `CodecRef` that says how the result is read back, and the only thing that says it. Naming the input's codec there would claim the result decodes like its input, which SQLite makes false: it computes `sum` over a text column from whatever leading numbers the rows held.
- **`codecId`** is the expression's shape, which operator gating reads. It is the declared output's, that being what the expression evaluates to.

A pair the composed stack declares no overload for resolves to nothing, and both consumers refuse it before any SQL is built, with `ORM.AGGREGATE_UNSUPPORTED`. There is no untyped fallback: a result the target never declared is a result nothing can decode.

## When the types offer an operation the runtime doesn't have

The aggregate map is emitted into `contract.d.ts` only; `contract.json` carries no copy of it. So a contract emitted with an extension composed, and then used against a runtime configured without that extension, types `aggregate.bitOr('weight')` and fails on the call:

```text
TypeError: aggregate.bitOr is not a function
```

An include reducer fails the same way — `posts.bitOr('weight')` — because the collection installs one reducer per operation the registry contributes. Nothing structured is raised, and nothing can be: the runtime has no record of what the types were told.

The fix is to make the two agree. Either compose the extension into the runtime that builds `db`, or re-emit the contract from a configuration that omits it, which withdraws the operation from the types as well.

## Where to look

- **PostgreSQL's matrix**: [packages/3-targets/3-targets/postgres/src/core/aggregates.ts](../../packages/3-targets/3-targets/postgres/src/core/aggregates.ts) — every row read off a live database rather than inferred.
- **SQLite's matrix, including the lowering**: [packages/3-targets/3-targets/sqlite/src/core/aggregates.ts](../../packages/3-targets/3-targets/sqlite/src/core/aggregates.ts).
- **The vocabulary**: `AggregateDescriptor` in `packages/1-framework/1-core/framework-components/src/shared/aggregate-descriptor.ts`; the precedence rule beside it in `aggregate-overloads.ts`; the SQL specialization and registry, including the lowering rule, in `packages/2-sql/4-lanes/relational-core/src/aggregate-descriptor{,-registry}.ts`.
- **A contribution end to end**: [test/integration/test/sql-orm-client/contributed-aggregates.test.ts](../../test/integration/test/sql-orm-client/contributed-aggregates.test.ts) contributes two operations from a test-only extension and reads their results back from PostgreSQL.
- **A contribution you can run**: [examples/prisma-8-demo/src/extensions/engagement-stats.ts](../../examples/prisma-8-demo/src/extensions/engagement-stats.ts) contributes `stddev` from a local extension composed on both planes, and `pnpm start -- aggregate-stddev` calls it as a statically typed method.
- **The rules the surfaces follow**: [ADR 020 § Contributed aggregate operations](../architecture%20docs/adrs/ADR%20020%20-%20Result%20Typing%20Rules.md#contributed-aggregate-operations).

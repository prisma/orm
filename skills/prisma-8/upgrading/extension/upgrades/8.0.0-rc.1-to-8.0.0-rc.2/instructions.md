---
from: "8.0.0-rc.1"
to: "8.0.0-rc.2"
changes:
  - id: check-constraint-ir-carries-an-opaque-expression
    summary: |
      `CheckConstraint` (contract IR) and `SqlCheckConstraintIR` (schema IR) changed from
      `{ name, column, valueSet }` / `{ name, column, permittedValues }` to
      `{ name, prefix?, expression }`. Both are constructed from an `SqlObjectNaming` rather
      than a bare name, exactly like `Index` / `SqlIndexIR`: pass
      `{ naming: { kind: 'wire', prefix, hash }, expression }` for a managed check, or
      `{ naming: { kind: 'exact', name }, expression }` for one adopted verbatim. Compute the
      hash with `computeCheckContentHash(expression)` from `@internal/sql-schema-ir/naming`.
      Reading a check off a built node is unchanged (`check.name`), and `check.prefix` tells
      you whether it is wire-named. Contract JSON hydrates through
      `checkConstraintInputFromSerialized`, which rejects a `prefix` that does not parse out of
      the `name`. `resolveValueSetValues` is gone — a check no longer references a value set,
      so there is nothing to resolve; the members are already baked into the predicate text.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - 'CheckConstraint'
        - 'permittedValues'
        - 'resolveValueSetValues'
      anyMatch: true
  - id: add-check-constraint-call-takes-an-expression
    summary: |
      `AddCheckConstraintCall` is now constructed as
      `(schemaName, tableName, constraintName, expression)` — the `column` and `values`
      parameters are gone, and the rendered DDL is
      `ALTER TABLE … ADD CONSTRAINT "x" CHECK (<expression>)` with the predicate emitted
      verbatim. The matching migration-class method takes
      `{ schema, table, constraint, expression }`. `DropCheckConstraintCall` is unchanged.
      There is no compatibility overload — update every construction site.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - 'AddCheckConstraintCall'
        - 'addCheckConstraint'
      anyMatch: true
  - id: specifier-default-control-policy-requires-create-namespace
    summary: |
      The options bag on `typescriptContract` / `typescriptContractFromPath` now requires
      `createNamespace` alongside `defaultControlPolicy`. Stamping a specifier default carries
      a consequence — derived CHECK constraints are stripped from tables the stamped policy
      leaves non-managed — and the strip rebuilds storage namespaces through the target's
      factory, so the two options travel together. Pass the same factory the PSL specifier
      already takes:
      `typescriptContract(contract, output, { defaultControlPolicy: 'external' })` becomes
      `typescriptContract(contract, output, { defaultControlPolicy: 'external',
      createNamespace: postgresCreateNamespace })`, with `postgresCreateNamespace` imported
      from the Postgres target's types entrypoint (`@internal/target-postgres/types`).
      Calls without an options bag are unchanged, and `emptyContract` already took
      `createNamespace`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - 'typescriptContract'
        - 'defaultControlPolicy'
      anyMatch: false
  - id: re-emit-extension-contract-spaces
    summary: |
      Run your extension's `contract emit` (the `build:contract-space` script, if you have one)
      to regenerate its committed `contract.json` / `contract.d.ts`. Two things change: any
      enum CHECK is re-serialized into the new shape with a wire name, and every list (`many`)
      column gains a declared element-non-null CHECK that the Postgres planner used to
      synthesize without ever declaring. Prefixes derived from long table and column names are
      truncated to 54 UTF-8 bytes so the wire name fits Postgres's 63-byte identifier limit;
      identity lives in the hash, so truncated prefixes still yield distinct names.
      Postgres introspection also stopped parsing predicates and now captures every CHECK
      constraint verbatim, so any hand-written or platform-installed check on a table your
      extension manages is visible for the first time: it verifies as an undeclared extra under
      `--strict` and becomes a `dropCheckConstraint` under a policy that allows `destructive`.
      If your extension installs checks out of band — through a raw-SQL migration step rather
      than through the contract — declare them instead: `@@check(expression: "…", map: "<physical
      name>")` adopts a constraint under the name it already carries. Until they are declared,
      keep the tables carrying them under an additive-only policy — the checks survive, and only
      `--strict` verify reports them — or expect the first destructive plan against an upgraded
      database to offer to drop them. Declaring them is the durable fix; see
      `authored-check-constraints` in this transition.
    detection:
      glob: "**/contract.json"
      contains:
        - '"many": true'
        - '"valueSet"'
      anyMatch: true
  - id: stub-execution-contexts-must-carry-an-aggregate-registry
    summary: |
      A pack that hand-rolls an `ExecutionContext` in its tests must give it an
      `aggregateDescriptors` registry whose `values()` yields the descriptors the test exercises.
      `orm(...)` and every `Collection` construction enumerate that registry to build their method
      sets, so a stub context without the field raises
      `TypeError: Cannot read properties of undefined (reading 'values')` at construction, and a
      registry whose `values()` yields nothing produces a collection and a `sql()` function bag
      with no aggregate methods at all — `TypeError: aggregate.count is not a function` at the
      first call. A `resolve()` that answers `count` is no longer sufficient on its own: `resolve`
      settles one `(operation, input)` pair, `values` declares the vocabulary. Prefer
      `buildSqlAggregateDescriptorRegistry(descriptors, codecDescriptors)` from
      `@internal/sql-relational-core/aggregate-descriptor-registry` over a hand-written object —
      it settles the same registry the runtime does.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "aggregateDescriptors"
        - "ExecutionContext"
        - "SqlAggregateDescriptorRegistry"
      anyMatch: true
  - id: aggregate-surfaces-derive-from-the-contract-s-operation-map
    summary: |
      The ORM's `aggregate()` / `groupBy().aggregate()` / `groupBy().having()` builders, the
      include reducers on a collection, and the SQL builder's aggregate functions no longer
      declare `count` / `sum` / `avg` / `min` / `max` outright. Each surface is a mapped type over
      the operation names in the contract's emitted `AggregateTypes` block. Deriving the surface
      neither adds nor removes a method by itself, but the block a re-emit produces is not the
      list it was: PostgreSQL now declares eight operations and SQLite seven, and the bare results
      over integer columns moved — `count`, `sum`, and `avg`. What stayed: `min` / `max`, `sum`
      and `avg` over a float, `numeric`, `interval`, or `time` column, and `sum` over an
      `UnboundedInt` column, each still in its own family — see
      `count-over-a-field-counts-that-field` and `aggregate-defaults-are-js-native-numbers`.
      A contract whose block is unknown — an in-code `defineContract(...)` value, or a
      contract emitted before `AggregateTypes` existed — resolves every one of those surfaces to
      `AggregateOperationsUnavailable`, an empty type, so the call fails with
      `Property 'count' does not exist` rather than offering selector types the declaration
      cannot supply. This is a compile-time change only: the runtime builds its methods from the
      composed registry and dispatches exactly as before. Either emit the contract and type the
      client from the emitted `Contract`, or cast the builder to a dynamic record — see the body
      for the shape.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "defineContract"
        - ".aggregate("
        - "AggregateBuilder"
        - "HavingBuilder"
      anyMatch: true
  - id: count-over-a-field-counts-that-field
    summary: |
      `count(field)` renders `COUNT(<column>)` in the ORM. It used to drop the argument and render
      `COUNT(*)`. PostgreSQL declares `count` with `input: { kind: 'any' }`, which settles into
      both a `withoutInput` row and an `anyInput` row, so the derived method carries both arities
      honestly: `count()` counts rows, `count(field)` counts that field's non-null values. Typed
      call sites are unaffected, because `count` took no argument before and no such call
      compiled. Reachable through a call that bypassed the types — a `@ts-expect-error`, an
      `as never` argument, or dynamic invocation. Those call sites change result whenever the
      column holds NULLs. Sweep them and drop the argument wherever `COUNT(*)` was what you meant.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "count("
        - ".aggregate("
      anyMatch: true
  - id: contributed-aggregate-operations-carry-a-lowering-hook
    summary: |
      An aggregate descriptor whose `operation` is not one of `count`, `sum`, `avg`, `min`, `max`
      must declare a `lower` hook. `operation` has been a `string` for a release, but a name
      outside that alphabet was inert — no consumer surface offered it. It is live now: a
      contributed operation surfaces as a method on the ORM and SQL-builder aggregate surfaces
      under its own name, so it must be able to build an expression, and the closed AST alphabet
      gives it none. Registry assembly rejects a hook-less descriptor with
      `RUNTIME.AGGREGATE_LOWERING_MISSING` while the execution context composes. Two further
      rules follow. An out-of-alphabet operation is projection-only: HAVING, ORDER BY, and
      comparison operands refuse it with `ORM.AGGREGATE_PROJECTION_ONLY`, and its typed HAVING
      method does not exist. And its name may not shadow an ORM collection member (`select`,
      `where`, `include`, `combine`, `state`, …), because reducers install into that same
      namespace; `orm(...)` rejects a collision with `ORM.AGGREGATE_OPERATION_RESERVED`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "aggregateDescriptors"
        - "SqlAggregateDescriptor"
      anyMatch: true
  - id: aggregate-defaults-are-js-native-numbers
    summary: |
      Both built-in targets split their aggregate vocabulary. `count()`, `sum()` over an integer
      input, and `avg()` over an integer input read as `number` — where they read as a `bigint`,
      a `bigint`-or-decimal-string, and a decimal string. Three new operations carry the lossless
      results: `countBigInt` → `bigint`, `sumBigInt` → `bigint` (over `pg/int8@1`,
      `pg/int8number@1`, and `pg/unboundedint@1` it resolves to `pg/unboundedint@1`, exact past
      2^63), and `avgDecimal` → `pg/numeric@1`, PostgreSQL only. `count`'s empty-input answer is
      `0`, not `0n`. `count`, and `sum` over an integer input, raise `RUNTIME.DECODE_FAILED` past
      ±(2^53 − 1) rather than rounding, on the JSON/include path as well as the wire path; no
      other result carries that guard, `avg` included. Unchanged: `min`/`max`,
      `sum`/`avg` over float codecs, `sum` over `pg/numeric@1` and `pg/unboundedint@1`, and the
      ORM's `having(...)` operands, which its typed surface fixes at `number`. The SQL builder's
      comparison operands do move: `fns.gt` types both sides from one codec, so
      `fns.gt(fns.count(), 1n)` becomes `fns.gt(fns.count(), 1)`.
      Two things to do. Re-run your contract space's `contract emit` —
      the `AggregateTypes` block gains the three operations and the changed result codecs. Then
      fix pack tests that assert aggregate values or rendered SQL: `2n` and decimal-string
      expectations become plain numbers, and PostgreSQL's integer `avg` renders
      `CAST(avg(…) AS float8)` where it rendered a plain `avg(…)`. SQLite's transport cast to
      text is unchanged, but `sqlite/bigintnumber@1` now carries a JSON projection
      (`CAST(… AS INTEGER)`), so a SQLite include aggregate arrives inside `json_object` as a
      JSON number rather than a JSON string.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - ".aggregate("
        - "aggregateDescriptors"
        - "AggregateTypes"
      anyMatch: true
  - id: non-nullable-aggregate-descriptors-declare-an-empty-result
    summary: |
      A descriptor with `nullable: false` must also declare `emptyResultJson` — the value the
      operation answers with when no result row reaches the client at all. `AggregateResultNullability`
      (exported from `@internal/framework-components/components`) is a discriminated union, so
      `{ nullable: false }` on its own does not compile, and registry assembly rejects it at
      runtime with `RUNTIME.AGGREGATE_DESCRIPTOR_INVALID` (or `CONTRACT.AGGREGATE_DESCRIPTOR_INVALID`
      during emit). State the value in the **result codec's canonical JSON**, not as an
      application value: `emptyResultJson: 0` under `pg/int8number@1`, `emptyResultJson: '0'`
      under `pg/int8@1`. The empty-input answer belongs to the operation rather than to the codec
      — `count`'s identity element is zero, an `every()`'s would be `true` — which is why it sits
      on the descriptor. `ResolvedSqlAggregate` (`@internal/sql-relational-core/query-lane-context`)
      follows the same union, so a consumer that constructs one spreads the nullability rather
      than assigning `nullable: boolean`; reading `resolved.nullable` still narrows as before.
      Nullable descriptors are unchanged.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "nullable: false"
        - "aggregateDescriptors"
        - "ResolvedSqlAggregate"
      anyMatch: true
  - id: integer-codecs-check-the-js-type-they-are-given
    summary: |
      `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` refuse a JS `number` on `encode`,
      and `pg/int8number@1` and `sqlite/bigintnumber@1` refuse a `bigint`, with
      `RUNTIME.ENCODE_FAILED` and a message naming the type that arrived
      (`pg/int8@1 value must be a bigint, got number 9`) plus `meta.received`. The bigint codecs
      used to accept a number and stringify it, which let a fractional value through to an
      integer column. `encodeJson` is deliberately wider on the exact codecs: it accepts a
      safe-integer `number`, because a schema language writes no `bigint` literal and
      `BigInt @default(0)` arrives as the JSON number `0`; a non-integral or unsafe number raises
      `<codec> number literal must be an integer within the safe integer range`. Two consequences
      for a pack. Any place you hand a codec a value read out of a contract, JSON, or PSL must
      pick the matching method — `encode` takes the application value, `encodeJson` takes and
      returns canonical JSON. And if your pack renders DDL literal defaults itself, read the
      stored value back first: `await codec.encode(codec.decodeJson(stored), {})`, which is the
      two declared conversions in their declared order, rather than passing canonical JSON
      straight to `encode`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "encodeJson"
        - "decodeJson"
        - "codec.encode"
      anyMatch: true
  - id: authored-check-constraints
    summary: |
      Two things change for packs. `sql.checkConstraint` is a new adapter-reported capability: an
      adapter whose target implements CHECK constraint DDL reports it, and the `@@check` authoring
      surface is gated on it. And a check is no longer "derived" merely by being wire-named —
      user-authored checks are wire-named too. Derivation is now decided by whether the wire prefix
      is one derivation would produce for a column of that table. A pack that read
      `check.prefix !== undefined` to mean "Prisma Next generated this" must use the same
      prefix-shape test, `derivedCheckPrefixes` from `@internal/sql-schema-ir/naming`. An authored
      name that collides with a derived prefix shape is rejected at authoring with
      `CONTRACT.CHECK_NAME_RESERVED`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - 'checkConstraint'
        - 'derivedCheckPrefixes'
      anyMatch: true
  - id: runtime-query-execute-hard-cut
    summary: |
      Runtime and scope implementations expose `query()` for rows, while rc.1 prepared rows use `target.queryPrepared(prepared, params, options?)` and rc.2 uses `prepared.query(target, params, options?)`; statistics-returning `execute()` remains for non-returning statements. Classify callers and helpers by the result they consume; do not globally rename `execute`. Route row plans to `query`, prepared row plans to `prepared.query(target, params, options?)`, and non-returning writes to `execute`, reading `stats.affectedRows` when a count is needed. Preserve the bound connection, row-result laziness, and eager statistics result. Middleware uses `beforeQuery` → `interceptQuery` → driver query → `onRow` → `afterQuery` for rows and `beforeExecute` → `interceptExecute` → driver execute → `afterExecute` for statistics. Query interception returns `{ rows }`; execute interception returns `{ stats }`. There is no operation discriminator, compatibility alias, or generic fallback hook. The Mongo facade keeps static `db.query` and removes row-execution `db.execute`; execute a built row plan through `(await db.runtime()).query(plan)`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "beforeQuery"
        - "interceptExecute"
        - ".queryPrepared("
        - ".execute("
      anyMatch: true
  - id: config-file-is-prisma-config-with-an-orm-section
    summary: |
      The CLI config file is `prisma.config.ts` — the `prisma-next.config.ts` name is
      deprecated — and the config value is engine-shaped: `defineConfig` from
      `@prisma/cli-engine` wraps the whole ORM config as its `orm` section. Rename the file,
      then wrap the existing export: alias the current `defineConfig` import (from the target
      facade or CLI config-types) as `ormConfig` and write
      `export default defineConfig({ orm: ormConfig({ ...existing config... }) })`, adding
      `@prisma/cli-engine` to devDependencies. Both the deprecated filename and the flat shape
      still load, each printing a deprecation warning on stderr, so the two steps can land
      separately; anything asserting clean stderr around CLI invocations sees the warning
      until both are done.
    detection:
      glob: "**/prisma*.config.*"
      contains:
        - "defineConfig"
      anyMatch: true
  - id: published-prisma-next-bin-retired
    summary: |
      Nothing published ships a `prisma-next` bin anymore: `@prisma/orm-toolchain` publishes
      the `orm` command family at `@prisma/orm-toolchain/cli` and no bin, and the database
      facades forward no launcher. The only user-facing binary is the unified `prisma` CLI
      (the prisma-cli distribution), which mounts the same commands. Replace
      `prisma-next <command>` invocations in package scripts and CI with the unified CLI's
      equivalent, and drop any dependency that was taken only to put the bin on PATH.
    detection:
      glob: "**/package.json"
      contains:
        - "prisma-next"
      anyMatch: true
  - id: prepared-statements-split-by-declared-result
    summary: |
      `runtime.prepare()` now returns one of two handles, chosen from the plan the callback
      builds: a rows plan gives the `PreparedStatement<Params, Row>` you already have,
      consumed with `.query(target, params)`; a plan whose declared result is an affected-row
      count gives a `PreparedExecution<Params>`, consumed with `.execute(target, params)` and
      resolving `SqlStatementStats`. Two things follow for an extension. A facade that
      redeclares `prepare()` changes its return type from
      `Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>` to
      `Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>>`, importing `PreparedFor` from
      `@internal/sql-runtime` — no logic changes. A scope of your own that installs the
      prepared-query bridge (`preparedStatementQuery`) must also install the execute bridge
      (`preparedStatementExecute`, from `@internal/sql-runtime/internal/prepared-query`),
      routing it to your bound queryable exactly as the query bridge does; without it,
      `prepared.execute(yourScope, ...)` throws on the bridge invariant.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "preparedStatementQuery"
        - "PreparedStatement<ParamsFromDeclaration"
      anyMatch: true
  - id: prepare-defaults-to-the-contract-codec-map
    summary: |
      A facade that redeclares `prepare()` should default its codec-map parameter to
      `ExtractCodecTypes<TContract>` alone. Intersecting it with `CodecTypesBase` — the shape
      the in-tree facades used — collapses `keyof CT` to `string` through that type's index
      signature, which costs a caller every codec-id completion in the declaration and lets an
      id no registry carries typecheck. Drop the intersection; the `CT extends CodecTypesBase`
      constraint stays and nothing else in the signature changes. If your facade exposes a
      contract-bound raw tag, its `.returns()` now narrows to the contract's ids the same way,
      with no change on your side; a contract-free tag keeps accepting any string.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "ExtractCodecTypes<TContract> & CodecTypesBase"
        - "CodecTypesBase ="
      anyMatch: true
---

# 8.0.0-rc.1 → 8.0.0-rc.2 — Extension-author upgrade instructions

## `stub-execution-contexts-must-carry-an-aggregate-registry`

The aggregate method sets are built by enumerating the composed registry, once per `Collection` construction and once at `orm(...)`. A test that fabricates an `ExecutionContext` therefore has to supply one:

```ts
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';

const context = {
  contract,
  codecDescriptors,
  aggregateDescriptors: buildSqlAggregateDescriptorRegistry(descriptors, codecDescriptors),
  // …
};
```

Two distinct failures tell you which half is missing:

- **`TypeError: Cannot read properties of undefined (reading 'values')`**, thrown from `new Collection(...)` or `orm(...)` — the stub has no `aggregateDescriptors` field at all.
- **`TypeError: aggregate.count is not a function`** (or `posts.count is not a function`, or `fns.sum is not a function`) — the stub has a registry, but its `values()` yields nothing, so no method was installed. `resolve()` alone no longer describes the surface: `resolve` settles one `(operation, input)` pair on demand, `values` declares which operations exist.

A minimal hand-written stub that keeps `count` available:

```ts
const aggregateDescriptors = {
  resolve: (operation: string) =>
    operation === 'count'
      ? {
          operation,
          output: { codecId: 'pg/int8@1' },
          nullable: false as const,
          emptyResultJson: '0',
          lower: undefined,
        }
      : undefined,
  values: function* () {
    yield {
      operation: 'count',
      input: { kind: 'any' as const },
      output: { kind: 'codec' as const, codecId: 'pg/int8@1' },
      nullable: false as const,
      emptyResultJson: '0',
    };
  },
};
```

`emptyResultJson` is required on any non-nullable row — see [`non-nullable-aggregate-descriptors-declare-an-empty-result`](#non-nullable-aggregate-descriptors-declare-an-empty-result) for what the value means and which form to state it in.

Prefer the real builder where the test can afford it — it applies the same validation the runtime does, including the lowering rule below.

## `aggregate-surfaces-derive-from-the-contract-s-operation-map`

Every aggregate surface is now a mapped type keyed by the operation names in the contract's emitted `AggregateTypes` block:

| Surface | Type |
| --- | --- |
| `collection.aggregate(fn)` | `AggregateBuilder<TContract, ModelName, NsId>` |
| `groupBy(...).aggregate(fn)` | the same |
| `groupBy(...).having(fn)` | `HavingBuilder<…>` — keyed by the map *intersected with* the SQL alphabet |
| `include('rel', (rel) => …)` | `AggregateIncludeReducers<…>` on the collection |
| `sql().select((f, fns) => …)` | `AggregateOnlyFunctions<QC>` |

For a contract emitted by `prisma-next contract emit` on 8.0.0-rc.1 or later, the derivation itself takes nothing away — the block names whatever the composed stack declares. It does not name the same list it did, though: PostgreSQL now declares eight operations and SQLite seven, and the bare results over integer columns moved — `count`, `sum`, and `avg`. `min` / `max` did not, nor did `sum` and `avg` over a float, `numeric`, `interval`, or `time` column, nor `sum` over an `UnboundedInt` column; each of those stays in its own family. Re-emit, then work the two entries that carry those changes — [`count-over-a-field-counts-that-field`](#count-over-a-field-counts-that-field) and [`aggregate-defaults-are-js-native-numbers`](#aggregate-defaults-are-js-native-numbers).

For a contract whose block is unknown, all five surfaces resolve to `AggregateOperationsUnavailable` — an empty interface carrying one optional symbol-keyed brand that names the reason on hover. Two populations reach it:

- a contract built in code with `defineContract(...)` and used without emission (fixtures, integration tests, the no-emit authoring flow);
- a contract emitted before `AggregateTypes` existed, i.e. before 8.0.0-rc.1.

The symptom is a compile error at the call site:

```text
Property 'count' does not exist on type 'AggregateOperationsUnavailable'.
```

Runtime behaviour is unchanged — the methods are installed from the composed registry either way — so a cast is a legitimate fix where the contract is deliberately un-emitted:

```ts
import type { AggregateSpec } from '@internal/sql-orm-client';

type DynamicAggregates = Record<string, (field?: string) => AggregateSpec[string]>;

const stats = await readings.aggregate((aggregate) => {
  const dynamic = aggregate as DynamicAggregates;
  return { total: dynamic['sum']!('counter'), peak: dynamic['max']!('counter') };
});
```

The same shape works for an include reducer, whose callback receives the refinement collection:

```ts
const reduceToTotal = (related: unknown): unknown =>
  (related as DynamicAggregates)['sum']!('counter');

await readings.select('id').include('samples', (samples) => reduceToTotal(samples) as never).all();
```

Where an argument was previously widened past the types — `aggregate.sum('counter' as never)` compiled because `AggregateFieldNames` was already `never` for such a contract — the cast moves from the argument to the builder, and the field name goes back to being a plain string.

The better fix, wherever the pack can emit, is to emit: run `prisma-next contract emit` and type the client from the emitted `Contract`. That restores full typing — arities, admitted field names, and per-codec result types — instead of erasing it.

## `count-over-a-field-counts-that-field`

`count(field)` counts that field:

```ts
await db.orm.User.aggregate((aggregate) => ({ all: aggregate.count() }));
// SELECT COUNT(*) …

await db.orm.User.aggregate((aggregate) => ({ named: aggregate.count('email') }));
// SELECT COUNT("email") … — rows whose email is NULL are not counted
```

The second call used to render `COUNT(*)`: the argument was accepted and discarded. It is honoured now, because both arities are read off `count`'s rows rather than special-cased — PostgreSQL declares `count` with `input: { kind: 'any' }`, which settles into a `withoutInput` row (the zero-argument call) and an `anyInput` row (the field-taking call).

No typed call site changes meaning, because the field-taking overload did not exist before. What to sweep for is a call that got past the types:

- `// @ts-expect-error` immediately above a `count(...)` call. Where the argument is a field the contract admits, the suppression is now unused and TypeScript reports the unused directive. Where it is not — a relation name, say — the directive still holds and the call still fails.
- `count(x as never)` or `count(x as any)`.
- dynamic dispatch through a `Record<string, …>` cast.

For each, decide which count you meant. `COUNT(*)` is `count()`; `COUNT(col)` skips NULLs.

## `contributed-aggregate-operations-carry-a-lowering-hook`

Aggregate operation names are an open vocabulary, and they now reach the consumer surfaces. The SQL alphabet holds exactly five names (`count`, `sum`, `avg`, `min`, `max`), and a pack that contributes a descriptor named outside it — `bitOr`, say — gets a method under that name on the ORM's `aggregate()`, on `groupBy().aggregate()`, and on the include reducers, plus a matching function on the SQL builder. Three rules come with that.

**Declare a `lower` hook.** The AST's `AggregateExpr` carries only alphabet names, so a novel operation has no default form; the hook builds its whole expression from existing nodes:

```ts
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { FunctionCallExpr } from '@internal/sql-relational-core/ast';

const bitOr: SqlAggregateDescriptor = {
  operation: 'bitOr',
  input: { kind: 'codec', codecId: 'pg/int8@1' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: true,
  lower: ({ expr }) => FunctionCallExpr.of('bit_or', expr === undefined ? [] : [expr]),
};
```

Without it, the execution context refuses to compose:

```text
RUNTIME.AGGREGATE_LOWERING_MISSING: Aggregate descriptor 'bitOr:codec:pg/int8@1' declares
operation 'bitOr', which is outside the SQL aggregate alphabet (count, sum, avg, min, max)
and carries no lowering hook.
```

**Use it in projections only.** The lowered form is a rendering for the driver boundary. HAVING, ORDER BY, and comparison operands compare inside the database, where that rendering would change what the comparison means, so both consumers refuse those positions at authoring time with `ORM.AGGREGATE_PROJECTION_ONLY`. The typed surface agrees: `HavingBuilder` is keyed by the map intersected with the alphabet, so a contributed operation has no HAVING method to call. Project it in a select and filter or order on the projected value.

**Pick a name no collection member owns.** Include reducers install into the ORM collection's own namespace, beside `select`, `where`, `include`, `combine`, `aggregate`, and the collection's instance fields. `orm(...)` rejects a collision with `ORM.AGGREGATE_OPERATION_RESERVED` and names the operation in `meta.operation`; rename the operation.

Reference: [the aggregate descriptor guide](https://github.com/prisma/prisma/blob/main/docs/reference/aggregate-descriptor-guide.md).

## `aggregate-defaults-are-js-native-numbers`

Both built-in targets now split their aggregate vocabulary: the bare operations answer in the JS-native type, three new suffixed operations answer losslessly.

| Operation | Input | Result codec | Was |
| --- | --- | --- | --- |
| `count` | none or any | `pg/int8number@1` / `sqlite/bigintnumber@1` | `pg/int8@1` / `sqlite/bigint@1` |
| `countBigInt` | none or any | `pg/int8@1` / `sqlite/bigint@1` | — (new) |
| `sum` | `pg/int2@1`, `pg/int4@1`, `pg/int@1`, `sql/int@1` | `pg/int8number@1` | `pg/int8@1` |
| `sum` | `pg/int8@1`, `pg/int8number@1` | `pg/int8number@1` | `pg/numeric@1` |
| `sum` | SQLite's integer codecs | `sqlite/bigintnumber@1` | `sqlite/bigint@1` |
| `sumBigInt` | `pg/int2@1`, `pg/int4@1`, `pg/int@1`, `sql/int@1` | `pg/int8@1` | — (new) |
| `sumBigInt` | `pg/int8@1`, `pg/int8number@1`, `pg/unboundedint@1` | `pg/unboundedint@1` | — (new) |
| `sumBigInt` | SQLite's integer codecs | `sqlite/bigint@1` | — (new) |
| `avg` | every PostgreSQL integer codec | `pg/float8@1`, through a result cast | `pg/numeric@1` |
| `avgDecimal` | every PostgreSQL integer codec, plus `pg/numeric@1` | `pg/numeric@1` | — (new) |

Everything else keeps its row: `min` / `max`, `sum` and `avg` over the float codecs, `sum` over `pg/numeric@1` and `pg/unboundedint@1`, `avg` over `pg/numeric@1` and `pg/interval@1`, and SQLite's `avg`, which was already `sqlite/real@1`.

`sumBigInt` over a 64-bit input resolves to `pg/unboundedint@1` rather than `pg/int8@1`, deliberately: PostgreSQL computes that total as a `numeric`, and casting it back to `int8` would raise `bigint out of range` past 2^63. On SQLite, `sumBigInt` is offered inside SQLite's own bound — a 64-bit `SUM` overflow raises `integer overflow` in the database rather than promoting to a float.

### What to do

1. **Re-run your contract space's `contract emit`.** The `AggregateTypes` block in the committed `contract.d.ts` gains `countBigInt`, `sumBigInt`, and `avgDecimal`, and the changed result codecs on `count` / `sum` / `avg`.
2. **Fix value assertions in pack tests.** `expect(stats.total).toBe(2n)` becomes `toBe(2)`; a decimal-string average expectation becomes a number. Where the test was proving exactness, change the *method* to the suffixed variant rather than the expectation.
3. **Fix rendered-SQL assertions on PostgreSQL `avg`.** An integer `avg` renders `CAST(avg("t"."c") AS float8)` where it rendered a plain `avg("t"."c")`. The cast is on the **result**, so the exact `numeric` mean is computed first and rounded once.
4. **Expect a JSON number from a SQLite include aggregate.** `sqlite/bigintnumber@1` carries a JSON projection (`CAST(… AS INTEGER)`), so an included `count` or `sum` arrives inside `json_object` as a JSON number rather than a JSON string. The transport cast to text on the flat path is unchanged.
5. **Retype SQL-builder comparison literals against an aggregate.** `fns.gt(a, b)` types both operands from one codec, so a literal compared against `fns.count()` or an integer `fns.sum(...)` follows the aggregate's new result codec: `fns.gt(fns.count(), 1n)` becomes `fns.gt(fns.count(), 1)`. The ORM's `having(...)` is not this case — its comparand is typed `number` outright.

`count`, and `sum` over an integer input, raise `RUNTIME.DECODE_FAILED` past ±(2^53 − 1) rather than rounding, on the JSON path as well as the wire path — the guard runs after `JSON.parse`, and rounding is monotone, so a value outside the range cannot parse back inside it. They are the two results a guarded integer codec produces; `sum` over a float, `numeric`, or unbounded-integer input keeps that input's own family, and `avg` resolves to a float codec that rounds as any double does.

## `non-nullable-aggregate-descriptors-declare-an-empty-result`

A descriptor that declares `nullable: false` must declare `emptyResultJson` beside it:

```ts
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';

const count: SqlAggregateDescriptor = {
  operation: 'count',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'pg/int8number@1' },
  nullable: false,
  emptyResultJson: 0,
};
```

`AggregateResultNullability` — exported from `@internal/framework-components/components` — is a discriminated union (`{ nullable: true } | { nullable: false; emptyResultJson: JsonValue }`), so `{ nullable: false }` alone is a type error. The runtime check agrees: registry assembly raises `RUNTIME.AGGREGATE_DESCRIPTOR_INVALID`, and `contract emit` raises `CONTRACT.AGGREGATE_DESCRIPTOR_INVALID`.

**State the value in the result codec's canonical JSON, not as an application value.** The client decodes it through the codec the same row declares, so the two must agree — and the wrong form only fails at the one moment a populated table never reaches. `count`'s zero is `0` under `pg/int8number@1` and `'0'` under `pg/int8@1`.

**Why it lives on the descriptor.** The empty-input answer is a property of the operation, not of the type its result carries: `count`'s identity element is zero, an `every()`'s would be `true`, a `product()`'s would be one. A codec has no way to know which.

The value is read only where no result row reaches the client at all — an absent aggregate alias, or an include whose envelope never arrived. SQL answers an ordinary empty input set itself.

If your pack consumes a resolution rather than contributing one, `ResolvedSqlAggregate` (`@internal/sql-relational-core/query-lane-context`) follows the same union. Reading `resolved.nullable` narrows as it always did; constructing one spreads the nullability instead of assigning a boolean:

```ts
const nullability = descriptor.nullable
  ? ({ nullable: true } as const)
  : ({ nullable: false, emptyResultJson: descriptor.emptyResultJson } as const);

return { operation, output, ...nullability, lower };
```

## `integer-codecs-check-the-js-type-they-are-given`

The integer codecs answer for the JS type before the range, so a wrong type reads as a wrong type:

```text
RUNTIME.ENCODE_FAILED: pg/int8@1 value must be a bigint, got number 9
RUNTIME.ENCODE_FAILED: pg/int8number@1 value must be a number, got bigint 9
```

`meta.received` names the type that arrived. `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` read a `bigint`; `pg/int8number@1` and `sqlite/bigintnumber@1` read a `number`. The bigint codecs used to accept a number and stringify it, which meant `1.5` reached an integer column as valid decimal text.

**`encodeJson` is wider on the exact codecs, and only there.** It also accepts a safe-integer `number`, because a schema language writes no `bigint` literal — `BigInt @default(0)` arrives as the JSON number `0`. A non-integral or unsafe number is refused:

```text
RUNTIME.ENCODE_FAILED: pg/int8@1 number literal must be an integer within
the safe integer range, got 9007199254740992
```

Past that range the literal was already rounded before the codec saw it, so its digits no longer name the value that was written.

Two consequences for a pack:

- **Pick the method that matches the value you hold.** `encode` takes the application value and produces a wire value; `encodeJson` takes and returns canonical JSON. Handing canonical JSON to `encode` used to work for codecs whose two forms coincide and now fails loudly for the ones whose forms differ.
- **If your pack renders DDL literal defaults itself, read the stored value back first.** A contract stores a default in the codec's canonical JSON, so the pair is `decodeJson` then `encode`, in that order:

  ```ts
  const value = stored instanceof Date ? stored : codec.decodeJson(stored);
  const wire = await codec.encode(value, {});
  ```

  A `Date` is the one authored value JSON has no notation for, so it is the one that arrives as itself.

<!--
PR #30049: `changes: []`. The 8.0.0-rc.2 release cut. The extension-package diff is the lockstep version bump, the `@prisma/cli-engine` peer moving to 0.1.1, and the supabase contract fixtures re-emitted so their embedded extension version matches. The engine peer is a devDependency in every extension package here, so it reaches no downstream extension author; the consumer-facing changes this release ships are the entries above, recorded by the PRs that made them.

PR #29920: `changes: []`. Adds prepared-statement test coverage to the Supabase runtime suite (test-fixture codec registration only) and fixes a postgres direct-driver transaction defect; neither requires downstream extension source translation. The SPI split itself is recorded as `driver-spi-splits-query-and-execute` in the 0.17-to-8.0.0-rc.1 transition.

PR #29902: `changes: []`. Generated contracts gain additive aggregate rows for new opt-in integer representation codecs, but existing extension schemas and source require no migration; extension authors re-emit only when adopting the new target-scoped types.
PR #29940: `changes: []`. Dependabot's weekly dev-dependency bumps, which move `@biomejs/biome` to 2.5.6 and realign every `biome.jsonc` `$schema` URL to match. The extension-package diff is that URL and nothing else, so it requires no downstream extension source translation.
PR #29965: `changes: []`. The same shape again: `@biomejs/biome` moves to 2.5.7 and every `biome.jsonc` `$schema` URL is realigned to match. The extension-package diff is that URL and nothing else, so it requires no downstream extension source translation.
-->

## Why checks stopped being structured

A check is now one opaque SQL string that nothing parses. Postgres reprints predicates in its
own normalized form — a `varchar` membership test comes back as
`((col)::text = ANY ((ARRAY[…])::text[]))` — so any structured reading of a live predicate
drifts against the authored text. Equality for a wire-named check is name equality, because the
hash already commits to the predicate; only an exact-named check compares its body, and then
byte-for-byte.
## If your target pack authors checks

Check emission is driven by a duck-typed `renderCheckExpressions` hook on the pack's
`authoring` contributions, resolved the same way `qualifyColumnType` is. It receives one
column's shape (`tableName`, `columnName`, `many`, and `memberValues` — the last present only
for a value set the toolchain owns) and returns `{ kind, columnName, expression }` candidates,
where `kind` is `'membership'` or `'elementNotNull'`. A pack without the hook emits no checks
at all, which is how SQLite keeps its no-CHECK stance. Nothing in the return value is a name:
the contract builder composes the prefix from the table, the column, and the kind, truncates it
to 54 UTF-8 bytes, and appends the content hash.
## Hand-written checks are visible now

Postgres introspection reads `pg_get_expr(c.conbin, c.conrelid)` and stores the predicate
verbatim; it no longer recognises only the two shapes the old parser could parse. Every CHECK
constraint on a managed table therefore reaches the differ, and one the contract does not
declare is an ordinary undeclared extra: reported by `db verify --strict`, and dropped by a plan
whose control policy allows `destructive`.

For an extension this matters in one specific case — a check your extension installs through a
raw-SQL migration step rather than deriving in its contract space. That constraint used to be
invisible and is now drop-eligible against any database the extension manages. Declare it:
`@@check(expression: "…", map: "<its physical name>")` in the contract space adopts the
constraint under the name it already carries, after which it is owned rather than extra and no
plan drops it — see `authored-check-constraints` in this transition. Until you do, keep the
tables carrying it under an additive-only policy: the check survives, plain `db verify`
tolerates it, and only `--strict` reports it.

## `runtime-query-execute-hard-cut`

The runtime SPI separates row streams from statement statistics. Inspect what each caller consumes rather than applying a global `execute` → `query` replacement: selects, returning writes, Mongo command-result plans, and other iterated or decoded results use `query`; non-returning DML uses eager `execute` and returns `{ affectedRows: number }`. Prepared row callers move from `target.queryPrepared(prepared, params, options?)` to `prepared.query(target, params, options?)`.

Connection, transaction, and role-bound scopes preserve their existing bound resource for both operations. Keep row results lazy and fully consume them inside a scope when required; statistics execution is eager. A count terminal must use `stats.affectedRows` from the write and never derive it from a row array.

Middleware hooks are operation-specific: query uses `beforeQuery`, `interceptQuery`, `onRow`, and `afterQuery`; statistics uses `beforeExecute`, `interceptExecute`, and `afterExecute`; `beforeCompile` remains shared. `interceptQuery` returns `{ rows }`, `interceptExecute` returns `{ stats }`, and hook selection carries the operation distinction, so contexts and results have no operation discriminator. Do not add compatibility aliases or generic fallback hooks. Split row and statistics fakes and spies so tests detect an incorrect route. Behavior intended for both operations assigns one private implementation to both corresponding hook names.

The Mongo facade keeps static `db.query`; it has no row-execution method named `query` and no compatibility `db.execute`. Build with `db.query`, obtain the connected runtime, and call `(await db.runtime()).query(plan)`. Leave genuine statistics calls, migration runners, and unrelated APIs named `execute` unchanged.

## `config-file-is-prisma-config-with-an-orm-section`

Two mechanical steps, in either order:

1. `git mv prisma-next.config.ts prisma.config.ts` (same for `.mts` / `.mjs` variants).
2. Wrap the flat export in the engine shape:

```ts
// before
import { defineConfig } from '@prisma/orm-postgres/config';
export default defineConfig({ ... });

// after
import { defineConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
export default defineConfig({ orm: ormConfig({ ... }) });
```

Add `@prisma/cli-engine` to `devDependencies`. The inner config is unchanged — only the file
name and the outer wrapper move. The loader still discovers the deprecated filename and still
accepts the flat shape, each with a stderr deprecation warning, so nothing breaks mid-rename;
finish both steps to silence the warnings.

## `published-prisma-next-bin-retired`

`prisma-next ...` in a package script resolved through a bin the database facades forwarded
from the toolchain. That chain is gone: the published toolchain is bin-less and exports the
`orm` command family at `@prisma/orm-toolchain/cli` for the unified `prisma` CLI (the
prisma-cli distribution) to mount. Point scripts and CI at the unified CLI, which serves the
same command paths.

## `prepared-statements-split-by-declared-result`

The prepared surface answers what the plan declared. A rows plan still prepares into a
`PreparedStatement` you consume by querying it; a plan built from a statement that reports an
affected-row count prepares into a `PreparedExecution` you consume by executing it, which
resolves `SqlStatementStats` rather than streaming rows. The two handles share no consumption
method, so neither can be read the wrong way round.

Extensions meet this in two places.

**A facade that redeclares `prepare()`** — as the in-tree database facades do — swaps the
declared return type and nothing else:

```ts
// Before
): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
// After
): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>> {
```

`PreparedFor` comes from `@internal/sql-runtime` and resolves to whichever handle the plan
earns.

**A scope of your own** — a session, a role context, any object you hand to
`prepared.query(...)` — carries the prepared bridges. If it installs `preparedStatementQuery`,
it must now also install `preparedStatementExecute` beside it, routing to the same queryable:

```ts
[preparedStatementExecute]<Params>(
  prepared: PreparedExecution<Params>,
  params: Params,
  options?: RuntimeExecuteOptions,
): Promise<SqlStatementStats> {
  return runPreparedExecuteAgainstYourQueryable(prepared, params, yourQueryable, options);
}
```

Both symbols come from `@internal/sql-runtime/internal/prepared-query`. A scope missing the
execute bridge typechecks but throws on the bridge invariant the first time someone executes a
prepared statement against it.

## `prepare-defaults-to-the-contract-codec-map`

```ts
// Before — the index signature on CodecTypesBase widens keyof CT to string
CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,

// After
CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
```

Only the default changes. The constraint, `Declaration<CT>`, `ParamsFromDeclaration`, and the
returned prepared handle are all as they were, and what infers at existing call sites is
unchanged — this is about what the caller is offered and what the compiler refuses. With the
intersection in place, `prepare({ id: 'pg/int4' }, ...)` typechecks and then fails at
execution with `RUNTIME.PARAM_REF_MISSING_CODEC`; without it, the wrong id is a compile
error and the right ones complete.

The same narrowing reaches `.returns()` on a contract-bound raw tag through
`@internal/sql-builder`, so a facade that re-exposes that tag inherits it without doing
anything. Tags built for a contract-free lane are deliberately left open.

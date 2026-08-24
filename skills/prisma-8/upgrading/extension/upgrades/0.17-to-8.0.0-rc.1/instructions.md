---
from: "0.17"
to: "8.0.0-rc.1"
changes:
  - id: codec-conformance-harness-moves-to-testkit-packages
    summary: |
      The database-backed codec conformance harness moves into two dedicated dev-only packages,
      `@internal/postgres-codec-testkit` and `@internal/sqlite-codec-testkit`. Like every
      `@internal/*` package they are workspace-private — a published home under the `@prisma/*`
      scope is a follow-up — so today's consumers are packs developed in this repository. A pack
      that reached the in-repo harness through a relative cross-package import
      (`../../../3-targets/6-adapters/postgres/test/codec-conformance/harness`) adds the matching
      testkit as a workspace devDependency and imports `runPostgresCodecProjection` /
      `runSqliteCodecProjection` from the package instead; a `tsconfig` whose `rootDir` was widened
      to reach across that boundary can be narrowed back to the pack. The harness API is unchanged —
      caller-supplied connection, one case per codec and value — so the cases themselves move
      verbatim. Production adapters take no dependency on either testkit.
    detection:
      glob: "**/*.{ts,tsx,json}"
      contains:
        - "codec-conformance"
        - "runPostgresCodecProjection"
        - "runSqliteCodecProjection"
      anyMatch: true
  - id: aggregate-result-codecs-are-target-declared
    summary: |
      Targets declare what each aggregate returns, through `SqlAggregateDescriptor` contributions on
      `types.aggregateDescriptors`. A descriptor maps an operation and an input match —
      no input, an exact codec id, a codec trait, or input-agnostic — to a result codec and a
      declared nullability, and resolution consults exact matches, then traits, then the
      input-agnostic entry. Emission and the runtime read the same contributions, so an extension
      that contributes an aggregate cannot type one result and decode another. Two consequences for
      existing packs. First, aggregate results now carry their declared codec into decoding, so a
      pack asserting an aggregate reads back as a `number` updates that expectation — on PostgreSQL
      `count` and widened sums are bigints and integer averages are decimal strings; on SQLite `avg`
      is a number and integer sums are bigints. Second, a pack that asserts rendered SQL for SQLite
      aggregates sees `CAST(… AS text)` around any aggregate whose result is `sqlite/bigint@1`:
      SQLite computes those into an INTEGER that `node:sqlite` refuses to hand over past 2^53, so
      the target's descriptor renders the cast that keeps the value readable. Regenerate contracts —
      the emitted `contract.d.ts` gains an `AggregateTypes` block that the ORM and SQL builder
      resolve their result types from.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "aggregateDescriptors"
        - "AggregateExpr"
        - "codecTypes"
      anyMatch: true
  - id: rendered-ts-literals-are-double-quoted
    summary: |
      `renderTsLiteral` (`@internal/framework-components/codec`) now returns a double-quoted
      TypeScript literal — `"low"` where it used to return `'low'`. It delegates to a single
      shared renderer (`JSON.stringify` plus an explicit U+2028/U+2029 escape), which also
      closes escaping gaps the old implementation had: `\t`, `\v`, `\b`, `\f` and the remaining
      C0 control characters were previously emitted raw. Calling code needs no change, and the
      emitted `contract.d.ts` is byte-identical either way because `contract emit` formats with
      prettier at `singleQuote: true`. What does change is any assertion your pack makes on the
      *unformatted* return value — a codec unit test pinning `renderValueLiteral` output, or a
      test that calls `generateContractDts` directly and greps the result. Update those
      expectations to the double-quoted form. If your pack hand-rolls a `renderValueLiteral`
      that builds its own quoted literal, it keeps working, but switch it to `renderTsLiteral`
      so your pack's escaping matches the framework's.
    detection:
      glob: "**/*.{test,test-d}.ts"
      contains:
        - 'renderValueLiteral'
        - 'generateContractDts'
      anyMatch: true
  - id: driver-spi-splits-query-and-execute
    summary: |
      The relational driver contract (`SqlQueryable` in `@internal/sql-relational-core`) splits
      into one streaming path and one statistics path: `query<Row>(request)` returns
      `AsyncIterable<Row>`, and `execute(request)` runs a statement without row output and
      resolves to `SqlStatementStats` (`{ affectedRows }`). The prepared-specific
      `executePrepared` driver method and the buffered `query(sql, params)` convenience (with its
      `SqlQueryResult` type) are gone — preparedness travels as the optional
      `preparedStatementHandle` on `SqlExecuteRequest`, and `query()` serves ad-hoc and prepared
      requests alike. A pack that implements a driver, wraps one, or ships a driver fake for
      tests implements the two-method surface, reports its engine's native affected-row count
      unnormalized, and surfaces a failed prepared-statement retry as the structural
      `DRIVER.PREPARE_FAILED` error envelope.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "SqlQueryable"
        - "PreparedExecuteRequest"
        - "SqlQueryResult"
      anyMatch: true
---

# 0.17 → 8.0.0-rc.1 — Extension-author upgrade instructions

## `codec-conformance-harness-moves-to-testkit-packages`

The conformance harness that measures a codec's JSON projection against a real database lives in dedicated packages, `@internal/postgres-codec-testkit` and `@internal/sqlite-codec-testkit`. They are workspace-private like every `@internal/*` package (a published `@prisma/*` home is a follow-up), so packs developed in this repository that reached the harness by relative path across the adapter's `test/` directory declare the workspace dependency instead:

```jsonc
// package.json
"devDependencies": {
  "@internal/postgres-codec-testkit": "workspace:*"
}
```

```ts
import { runPostgresCodecProjection } from '@internal/postgres-codec-testkit';
```

The harness API is the same one the in-repo version had — you supply the connection and the cases; it encodes, stores, projects through your descriptor, executes, and compares the database's JSON against `encodeJson` and back through `decodeJson`. Cases move verbatim. If your `tsconfig.json` widened `rootDir` to make the cross-package relative import resolve, narrow it back to the pack.

## `aggregate-result-codecs-are-target-declared`

Aggregate result typing is now declared rather than inferred. A target (or an extension) contributes `SqlAggregateDescriptor`s on `types.aggregateDescriptors`, a sibling of `codecTypes`:

```ts
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';

const sumOverMoney: SqlAggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'codec', codecId: 'ext/money@1' },
  output: { kind: 'codec', codecId: 'ext/money@1' },
  nullable: true,
};
```

Each descriptor claims one `(operation, input)` pair, and exactly one component may claim it. The input match is one of four kinds — `none` (an operation over rows), `codec` (an exact codec id), `trait` (any codec carrying that trait), or `any` (a result that does not depend on its input) — and resolution consults them in that order of specificity: exact, then trait, then input-agnostic. The result is either `self` (the matched input's codec, for an aggregate that returns one of its inputs) or a named codec id. Emission reads the same contributions the runtime resolves against, so an emitted result type and a decoded value cannot disagree.

Two things to check in an existing pack:

- **Expectations that an aggregate reads back as a `number`.** On PostgreSQL, `count` and sums that widen to `int8` are bigints, and integer averages are decimal strings; on SQLite, integer sums are bigints while `avg` is a number.
- **Assertions over rendered SQL for SQLite aggregates.** An aggregate whose declared result is `sqlite/bigint@1` renders as `CAST(… AS text)`. SQLite computes such an aggregate into an INTEGER, and `node:sqlite` raises rather than returning one past 2^53; the descriptor's lowering hook renders the cast that keeps the value readable, and the bigint codec reads the text back. If your pack contributes an aggregate whose result outruns a double, declare the same lowering.

Then regenerate contracts (`prisma-next contract emit`): `contract.d.ts` gains an `AggregateTypes` block, and both the ORM client and the SQL builder resolve aggregate result types from it.

## `rendered-ts-literals-are-double-quoted`

The framework had three separate implementations of "escape this string for a TypeScript
literal", each with a different idea of what needed escaping. They are now one function, and the
one that survived is the `JSON.stringify`-based renderer.

For an extension pack, the practical surface is `renderTsLiteral`, which most custom codecs use
to implement `renderValueLiteral`:

```ts
// Before — renderTsLiteral returned a single-quoted literal
expect(codec.renderValueLiteral?.('low', 'output')).toBe("'low'");

// After
expect(codec.renderValueLiteral?.('low', 'output')).toBe('"low"');
```

Two things worth knowing when you update these:

- **The escaping inverted, it did not merely re-quote.** Under `JSON.stringify` a single quote is
  no longer escaped and a double quote is. So `renderTsLiteral("it's")` is `"it's"`, not
  `'it\'s'`. A mechanical quote swap over your test expectations will get the simple cases right
  and the escaping cases wrong — check any assertion whose input contains a quote by hand.

- **Values are unaffected; only the rendering is.** No contract hash changes, no re-emit is
  needed, and the artefacts your pack ships (`contract.json`, `contract.d.ts`, migrations) are
  unchanged. If your pack's committed contract artefacts do show a diff after upgrading, that is
  a different change in this transition, not this one.

## `driver-spi-splits-query-and-execute`

The driver contract used one streaming method for every statement, a prepared-specific variant beside it, and a buffered convenience query. It is now two methods with distinct jobs:

```ts
// Before (0.17)
export interface SqlQueryable {
  execute<Row>(request: SqlExecuteRequest): AsyncIterable<Row>;
  executePrepared<Row>(request: PreparedExecuteRequest): AsyncIterable<Row>;
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
  query<Row>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

// After (0.18)
export interface SqlQueryable {
  query<Row>(request: SqlExecuteRequest): AsyncIterable<Row>;
  execute(request: SqlExecuteRequest): Promise<SqlStatementStats>; // { affectedRows }
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
}
```

For a pack that implements a driver, wraps one, or ships a driver fake:

- Move the streaming implementation from `execute(request)` to `query(request)`. The buffered `query(sql, params)` overload and its `SqlQueryResult` type are gone; callers stream and collect instead.
- Implement `execute(request): Promise<SqlStatementStats>` for statements executed without row output. Report your engine's native affected-row count — the in-tree PostgreSQL driver reports `rowCount`, SQLite reports `stmt.run().changes` — and do not normalize semantics across engines.
- Delete `executePrepared`. Preparedness is a property of the request: a prepared plan arrives at `query()` carrying `preparedStatementHandle` on the `SqlExecuteRequest`.
- If your engine cannot return rows from `execute()`, reject `RETURNING`-style statements up front rather than silently dropping their rows (the in-tree SQLite driver does this).
- If your driver retries stale prepared statements, surface a failed retry as the structural `DRIVER.PREPARE_FAILED` error envelope (ADR 239) with the normalized driver error as its `cause`.

<!--
TML-3171 (nested SQL ORM self-relation predicate scopes): `changes: []`. The `packages/3-extensions/sql-orm-client` diff fixes internal query planning and adds regression coverage; it changes no public API, contract shape, emitted artefact, extension-authoring surface, adapter API, or downstream source translation. Incidental substrate diff only.
-->

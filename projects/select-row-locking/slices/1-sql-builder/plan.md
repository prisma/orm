# Slice 1 plan: typed SQL builder (TML-3402)

Spec: [spec.md](spec.md). Branch: `tml-3402-row-locking-sql-builder`, based on `design/select-row-locking`.

## Dispatches

### D1: the syntax tree node

Outcome: `LockingClause` and `SelectAst.locking` exist, survive every `with...` call and `rewrite()`, and the constructor refuses a lock with `distinct`, `distinctOn`, `groupBy` or `having`.

Builds on: nothing. Hands to: `LockingClause`, `LockStrength`, `LockWait` and `SelectAst.withLocking` exported from `@internal/sql-relational-core/ast`, package built so downstream packages see the types.

Focus: `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` and `test/ast/builders.test.ts`. Follow the frozen-class pattern of the neighbouring nodes.

Gate: `pnpm --filter @internal/sql-relational-core test`, `pnpm --filter @internal/sql-relational-core typecheck`, `pnpm --filter @internal/sql-relational-core build`.

### D2: flags and renderers

Outcome: the Postgres adapter reports the seven flags, its renderer prints every clause form after `OFFSET` and refuses an unreported strength or option, the SQLite renderer refuses any lock, and `docs/reference/capabilities.md` documents the flags.

Builds on: D1. Hands to: rendered SQL for every clause form, verified by adapter tests.

Focus: `packages/3-targets/6-adapters/postgres/src/core/{adapter,descriptor-meta,sql-renderer}.ts` and tests; `packages/3-targets/6-adapters/sqlite/src/core/adapter.ts` and tests; `docs/reference/capabilities.md`.

Gate: `pnpm --filter @internal/adapter-postgres test`, `pnpm --filter @internal/adapter-sqlite test`, typecheck of both, `pnpm build` for both.

### D3: the builder methods

Outcome: `forUpdate`, `forNoKeyUpdate`, `forShare` and `forKeyShare` exist on `SelectQuery` under their flags with `LockOptions` keyed by the option flags, append clauses to the built tree, and `build()` refuses a lock with an aggregate projection or on a subquery. `STATUS.md` and `README.md` updated.

Builds on: D1 and D2. Hands to: the builder surface the integration test in D4 exercises.

Focus: `packages/2-sql/4-lanes/sql-builder/src/{types/select-query.ts,runtime/query-impl.ts,runtime/builder-base.ts}`, `test/runtime/builders.test.ts`, new `test/types/lock.types.test-d.ts`, `STATUS.md`, `README.md`.

Gate: `pnpm --filter @internal/sql-builder test`, `pnpm --filter @internal/sql-builder typecheck`.

### D4: integration test, docs, full validation

Outcome: `test/integration/test/sql-builder/lock.test.ts` runs every clause form inside a transaction against PGlite and returns the expected rows; `docs/reference/query-patterns.md` has a locking section; the whole slice gate is green.

Builds on: D3. Hands to: slice done.

Focus: the new integration test file, `docs/reference/query-patterns.md`.

Gate: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:throws`, `pnpm test:packages`, and `pnpm test test/sql-builder/lock.test.ts` inside `test/integration`. Never the full integration suite.

## Open items

None.

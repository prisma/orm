# Slice 2 plan: ORM client (TML-3415)

Spec: [spec.md](spec.md). Branch: `tml-3415-row-locking-orm-client`, based on `tml-3402-row-locking-sql-builder` until prisma/orm#30549 merges, then rebased onto `main` by merging main in, never by rewriting history.

## Dispatches

### D1: the methods and the state

Outcome: the four methods exist on `Collection` only under their flags, throw `ORM.CAPABILITY_MISSING` without them, and put a `LockingClause` with the model's table in `CollectionState.locking`; `bindSelectAst` is tested to carry `locking`.

Builds on: slice 1. Hands to: a `CollectionState` that carries the clauses, ready for lowering.

Focus: `packages/3-extensions/sql-orm-client/src/{collection.ts,collection-contract.ts,types.ts}`, new `test/lock-capability.test.ts` and `test/lock-capability.test-d.ts`, a test in the `where-binding` test file.

Gate: `pnpm --filter @internal/sql-orm-client test`, `... typecheck`, `... lint`.

### D2: lowering and refusals

Outcome: `all()` and `first()` render the clause `OF` the identifier the outermost `FROM` uses, after `LIMIT`/`OFFSET`; every refusal in the spec throws `ORM.LOCK_INCOMPATIBLE` with `meta.conflict`.

Builds on: D1. Hands to: rendered SQL for every ORM lock form, verified by plan tests.

Focus: `packages/3-extensions/sql-orm-client/src/query-plan-select.ts`, the read and mutation terminals in `collection.ts`, `test/query-plan-select.test.ts` (or a new `select-locking-plan.test.ts` if near 500 lines), `docs/reference/error-reference.md` for the new `conflict` values.

Gate: as D1 plus `pnpm check:error-reference`.

### D3: integration test, docs, full validation

Outcome: the work-queue query runs in a transaction against PGlite with the rendered SQL asserted and the lock shown held; the docs and the `prisma-8` skill references cover both builders; the upgrade note names the ORM methods; the full gate is green.

Builds on: D2. Hands to: slice done.

Focus: new `test/integration/test/sql-orm-client/lock.test.ts`, `docs/reference/query-patterns.md`, `skills/prisma-8/references/queries-postgres.md`, `upgrade-instructions/pending/select-row-locking-capabilities/app/instructions.md`.

Gate: the full list in the spec's done conditions. Never the full integration suite.

## Open items

None.

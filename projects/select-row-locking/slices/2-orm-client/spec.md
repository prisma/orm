# Slice 2: ORM client (TML-3415)

Parent: [../../spec.md](../../spec.md). Design: [../../design.md](../../design.md), section "What you write: the ORM client" and the ORM rows of "What is refused, and where". Builds on slice 1 (TML-3402, prisma/orm#30549).

## At a glance

```ts
const product = await tx.orm.public.Product.where({ id: 42 }).forUpdate().first();

const job = await tx.orm.public.Job
  .where({ state: 'queued' })
  .orderBy((j) => j.createdAt.asc())
  .limit(1)
  .forUpdate({ skipLocked: true })
  .first();
// ... ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE OF "job" SKIP LOCKED
```

## Chosen design

1. `Collection` gains `forUpdate`, `forNoKeyUpdate`, `forShare` and `forKeyShare`. Each parameter is typed `never` unless the contract carries the method's flag, as `distinctOn` is, and each asserts the flag at run time with `assertLockCapability` beside `assertDistinctOnCapability`, throwing `ORM.CAPABILITY_MISSING` with `meta.capability`. The options offer `nowait` and `skipLocked` under `sql.lockNowait` and `sql.lockSkipLocked`, as a union; they do not offer `of`.
2. `CollectionState.locking: ReadonlyArray<LockingClause> | undefined`, `undefined` in `emptyState()`. Each method appends a `LockingClause` whose `of` is the model's table name or alias as the lowering writes it in `FROM`, so only the model's rows are locked.
3. `buildSelectAst` in `query-plan-select.ts` applies the state's clauses with `withLocking` on the outermost select. Only `all` and `first` use them.
4. Refused at compile time with `ORM.LOCK_INCOMPATIBLE` and `meta.conflict`: a lock together with `include`, `groupBy`, `aggregate`, `distinct` or `distinctOn`; and every mutation terminal (`update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`, `create`, `createAll`, `createAndCount`, `upsert`) on a locked collection.
5. A lock outside a transaction is not refused.
6. `bindSelectAst` in `where-binding.ts` gets the test slice 1 owed it.
7. Docs: ORM examples in `docs/reference/query-patterns.md`; `skills/prisma-8/references/queries-postgres.md` "Workflow — Transactions" shows both builders and says a lock lasts until the transaction ends, "Common Pitfalls (Postgres)" gives the `forNoKeyUpdate` advice; the pending upgrade note names the ORM methods.

## Coherence rationale

One state field, four methods sharing one helper, one lowering change, one refusal helper. The `include` case is refused, not lowered, so the lowering change is a single `withLocking` call.

## Scope

In: the seven points above and the tests below. Out: `include` with a lock, `of` on the ORM, mapping SQLSTATE `55P03`, anything under "Out of scope" in the design.

## Pre-investigated edge cases

- The ORM's `FROM` may alias the model's table in some lowerings (polymorphism variants, cursor pagination, `distinctOn` inner scoping). `of` must name whatever identifier the outermost select's `FROM` uses, or Postgres refuses the statement. Find the alias the lowering picks before writing the clause.
- `first()` adds `LIMIT 1`; the lock clause must still render after it.

## Done conditions

- New `packages/3-extensions/sql-orm-client/test/lock-capability.test.ts` and `lock-capability.test-d.ts`, modelled on the `distinct-on-capability` pair; `query-plan-select.test.ts` cases for each method rendering `OF` the model's table and for every refusal; a `where-binding` test that `bindSelectAst` carries `locking`; an integration test under `test/integration/test/sql-orm-client/` asserting the rendered SQL and running the work-queue query in a transaction against PGlite, with the `xmax` lock-held check from slice 1.
- `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:throws`, `pnpm lint:casts`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage`, `pnpm fixtures:check`, `pnpm test:packages` and the new integration file pass.

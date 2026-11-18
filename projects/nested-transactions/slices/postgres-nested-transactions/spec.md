# Slice: postgres-nested-transactions

**Project:** `projects/nested-transactions/` (slice 4). **Linear:** skipped by the operator.

## Outcome

Postgres users can call `tx.transaction(cb)` inside `db.transaction(cb)`, to any depth, with every behaviour in the project spec. The SQL runtime exports `withSavepoint(txCtx, fn, buildMembers)`, which the Postgres facade uses and slice 5's facades will reuse.

## At a glance

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.create(a)                      // A

  await tx
    .transaction(async (inner) => {                // SAVEPOINT sp_1
      await inner.orm.Post.create(b)               // B
      throw new Error('nope')                      // ROLLBACK TO SAVEPOINT sp_1, rethrow
    })
    .catch(() => {})                               // tx is usable again

  await tx.orm.Audit.create(c)                     // C
})                                                 // COMMIT: A and C land, B does not
```

In the facade:

```ts
function buildTransactionContext(txCtx: TransactionContext): PostgresTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...buildPostgresQueryMembers(options, txCtx),
    enums,
    nativeEnums,
    transaction: (fn) => withSavepoint(txCtx, fn, buildTransactionContext),
  })
}

// db.transaction(fn, options):
withTransaction(workRuntime, (txCtx) => fn(buildTransactionContext(txCtx)), { isolationLevel, timeout })
```

## Chosen design

### `withSavepoint` (`packages/2-sql-family/5-runtime/src/sql-runtime.ts`)

```ts
export function withSavepoint<TCtx, R>(
  txCtx: TransactionContext,
  fn: (tx: TCtx) => PromiseLike<R>,
  buildMembers: (txCtx: TransactionContext) => TCtx,
): Promise<R>
```

1. **It takes the context `withTransaction` or an enclosing `withSavepoint` passed to its callback.** That context carries an internal symbol-keyed member through which `withSavepoint` opens a savepoint on the context's transaction (`RuntimeTransaction.transaction()`, slice 3). The member is not on the `TransactionContext` type and not exported from the package, as the transaction's settlement member is not. A context the runtime did not make has no such member, and `withSavepoint` rejects with an error that says so. The member's name and exact shape are the implementer's choice.
2. **No options** (project spec decision 2). `withSavepoint` has no options parameter, and the facade's `tx.transaction` type has exactly one parameter.
3. **One guarded context for every level.** The code in `runTransactionOn` that builds the guarded context (`guardedStream`, `guardedQueryable`, `guardedSource`, `guardedHandle`, the context object) becomes a function that builds the context for any `RuntimeTransaction`, given a way to ask whether the level is closed. `runTransactionOn` and `withSavepoint` both call it. Keep the functions nested as they are, so the diff shows the new wrapper and not ninety moved lines.
   - A nested context is closed once its callback has settled, or once any enclosing context is closed (the enclosing callback settled, or the outer transaction's signal aborted). Closed means what it means for `tx` today: `invalidated` is `true`, and `query`, `execute`, the prepared-statement members, `startActivity` and `transaction` reject with `RUNTIME.TRANSACTION_CLOSED` before anything reaches the driver.
   - While a nested callback runs, work on the enclosing context rejects with `RUNTIME.TRANSACTION_SUSPENDED`. The runtime already does this (slice 3, rule 5); `withSavepoint` adds no check of its own.
   - A handle opened on a nested context has no `transaction` member, as a handle on `tx` has none (slice 6 changes both).
4. **One settle sequence for every level.** The part of `runTransactionOn` from the call to `fn` to the end is shared by the outer transaction and the savepoint. What only the outer transaction has stays with it: the connection's clean or unclean state. For a savepoint the sequence gives project spec decision 9:

   | What happens | What `tx.transaction(cb)` does |
   |---|---|
   | `cb` resolves | `commit()` (`RELEASE SAVEPOINT`), then resolves with `cb`'s result. |
   | `cb` throws | `rollback()` (`ROLLBACK TO SAVEPOINT`), then rejects with `cb`'s error unchanged. The enclosing context is usable again. |
   | `RELEASE` fails | `rollback()`. Whether it succeeds or fails, rejects with `RUNTIME.TRANSACTION_COMMIT_FAILED`, with the `RELEASE` error as `cause`. If the rollback succeeded, the enclosing context is usable again. |
   | `ROLLBACK TO` fails after `cb` threw | Rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, with `cb`'s error as `cause`, as `withTransaction` does. |
   | `ROLLBACK TO` fails (either row above) | The runtime has invalidated the stack (slice 3, rule 7), so every enclosing context rejects work with `RUNTIME.TRANSACTION_CLOSED`. `withTransaction`'s existing settle code then destroys the connection: the outer `commit()` or `rollback()` rejects without sending anything. No new code in this slice. |
   | `RELEASE` resolved, then an `activityEnded` hook throws | Rejects with the hook's error unchanged and sends no `ROLLBACK TO`, as `withTransaction` does after a resolved `COMMIT`. |
   | `ROLLBACK TO` resolved, then an `activityEnded` hook throws | Rejects with `cb`'s error; the hook's error goes to the log as `middleware.activityEnded.error`, as `withTransaction` does after a resolved `ROLLBACK`. |
   | `transaction()` rejects: an `activityStarted` hook refused the savepoint, `SAVEPOINT` failed, the context is suspended (a sibling is open) or closed | Rejects with that error unchanged. `cb` is not called and nothing is settled. The enclosing context is usable when it was usable before. |
   | The outer transaction's signal aborts while `cb` runs (timeout) | Rejects with the signal's reason without waiting for `cb`, as `withTransaction` does. It calls the savepoint's `rollback()` so the savepoint's activity ends (slice 3, rule 5: it sends nothing and rejects `RUNTIME.TRANSACTION_CLOSED`), and ignores that rejection. |

   To tell a failed `RELEASE` or `ROLLBACK TO` from a hook error after the database had settled the savepoint, the settle code reads the settlement the same way it does for the outer transaction (`settlementOf`). `Savepoint` in `runtime-transaction.ts` gains that member.
5. **Exported** from `packages/2-sql-family/5-runtime/src/exports/index.ts`, next to `withTransaction` and `withTransactionMembers`.

### Postgres facade (`packages/3-targets/postgres/9-facade/src/runtime/postgres-members.ts`)

6. **`PostgresTransactionContext` gains `transaction`:**

   ```ts
   transaction<R>(
     fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
   ): Promise<R>;
   ```

   The nested context has the same type and the same members as `tx`, including `transaction`.
7. **Wiring** as in § At a glance: one function builds the context for a `TransactionContext` and passes itself to `withSavepoint` as `buildMembers`. `db.transaction` on the pooled client and on a serverless connection both go through `buildPostgresRuntimeBoundMembers`, so both get it.
8. **Supabase stays without `tx.transaction` until slice 5.** `SupabaseTransactionContext` is an alias of `PostgresTransactionContext` today (`supabase.ts:103`). It becomes `Omit<PostgresTransactionContext<…>, 'transaction'>`, so the Supabase type and run-time object keep matching: neither has the member. This is the only change to the Supabase extension, apart from a type test if one compares the two types. Slice 5 removes the `Omit` when it wires Supabase.

## Coherence rationale

`withSavepoint` has no caller without a facade, and the facade member cannot ship partly working (project spec, transitional-shape constraints). The helper, its first facade and the tests that show the user-visible behaviour on a real database are one reviewable change. The other facades are left out so that the helper's shape can be reviewed on one facade first (project spec decision 10).

## Scope

**In:**

- `packages/2-sql-family/5-runtime/src`: `sql-runtime.ts`, `runtime-transaction.ts` (the savepoint's settlement member), `exports/index.ts`, and the package README where it lists `withTransaction`.
- `packages/2-sql-family/5-runtime/test`: a new `with-savepoint.test.ts` with the stub driver from `transaction-activity-fixtures.ts`.
- `packages/3-targets/postgres/9-facade`: `src/runtime/postgres-members.ts`; a new PGlite integration test file; `test/transaction.types.test-d.ts` (its test that the context has no `transaction` is replaced); `README.md` (the Transactions section says `tx` has no `transaction`).
- `packages/3-extensions/supabase/src/runtime/supabase.ts`: item 8 only.
- Docs: the `withTransaction` section of `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` (about lines 690–721, and the member list at 704), and the user-facing skill reference `skills/prisma-8/references/queries-postgres.md`, with a short paragraph on `tx.transaction(cb)` on Postgres.
- Upgrade instructions under `upgrade-instructions/pending/`, only if the `record-upgrade-instructions` skill's rules require them for a new required member on `PostgresTransactionContext`.

**Out:**

- `packages/1-framework/**`.
- The MySQL and SQLite facades, and Supabase beyond item 8 (slice 5).
- `transaction()` on activity handles opened under a transaction, and `sql-orm-client` (slice 6). ORM calls on a nested context run flattened in the savepoint, as they do on `tx` today.
- `withTransaction`'s behaviour: options, timeout, abort handling, error codes, and when it releases or destroys the connection. Its existing tests pass unchanged.
- The savepoint rules of slice 3 (`TransactionStack`, the guard, `Savepoint.commit()` and `rollback()`), apart from the settlement member.

## Slice done conditions

Beyond CI, review and the project DoD. Each path is tested once, at the level named.

**Runtime tests with the stub driver** (`with-savepoint.test.ts`):

- [ ] `cb` resolves: `SAVEPOINT sp_1`, the statement, `RELEASE SAVEPOINT sp_1`, and the call resolves with `cb`'s result. A nested call inside a nested call uses `sp_2`, and `buildMembers` builds the context at each level.
- [ ] `cb` throws: `ROLLBACK TO SAVEPOINT sp_1`, the same error is rethrown, the savepoint is finalized `rolled-back`, and the outer transaction then runs a statement and commits.
- [ ] `RELEASE` fails and `ROLLBACK TO` succeeds: `RUNTIME.TRANSACTION_COMMIT_FAILED` with the `RELEASE` error as `cause`; the outer transaction then commits.
- [ ] `ROLLBACK TO` fails after `cb` threw: `RUNTIME.TRANSACTION_ROLLBACK_FAILED` with `cb`'s error as `cause`; the next statement on the outer context rejects `RUNTIME.TRANSACTION_CLOSED`; `withTransaction` sends no `COMMIT` or `ROLLBACK` and destroys the connection.
- [ ] An `activityStarted` hook refuses the savepoint: the call rejects with the hook's error, no `SAVEPOINT` is sent, `cb` is not called, and the outer transaction commits.
- [ ] `RELEASE` resolved and an `activityEnded` hook throws: the hook's error unchanged, no `ROLLBACK TO`.
- [ ] After the nested call settles, work on the nested context, including `withSavepoint` on it, rejects `RUNTIME.TRANSACTION_CLOSED` with nothing sent.
- [ ] The outer timeout fires while a nested `cb` runs: the nested call rejects with `RUNTIME.TRANSACTION_TIMEOUT`, and the savepoint's activity is ended and finalized.
- [ ] A context the runtime did not make is rejected.

**PGlite integration tests** (Postgres facade):

- [ ] The At a glance example: A and C committed, B not. On the pooled client and on a serverless connection.
- [ ] Recovery from the aborted state: a statement fails inside a nested transaction, the nested call rejects with the database error, and the outer transaction then commits work done after it.
- [ ] A statement fails inside a nested callback that catches the error and returns: `RELEASE` fails on Postgres, the nested call rejects `RUNTIME.TRANSACTION_COMMIT_FAILED`, and the outer transaction then commits work done after it.
- [ ] `Promise.all([tx.transaction(a), tx.transaction(b)])`: one rejects `RUNTIME.TRANSACTION_SUSPENDED`. A statement on `tx` while a nested callback is running rejects `RUNTIME.TRANSACTION_SUSPENDED`, and `tx` works again after the nested call settles.
- [ ] A nested transaction inside a nested transaction: the inner one rolls back, the middle one and the outer one commit.

**Type tests:**

- [ ] `tx.transaction` exists on `PostgresTransactionContext`, has one parameter, infers the callback's return type, and passes a context of the same type. `SupabaseTransactionContext` has no `transaction`.

## Edge cases investigated

- **Supabase aliases the Postgres context type.** See item 8. Without it, either Supabase's type would promise a member its object lacks, or this slice would wire Supabase without slice 5's tests.
- **A hook error after the database settled a savepoint.** `Savepoint.commit()` rejects with an `activityEnded` hook's error after `RELEASE` resolved, and `rollback()` then rejects `RUNTIME.TRANSACTION_CLOSED` (slice 3b). Without the settlement member, the shared settle code would report `RUNTIME.TRANSACTION_COMMIT_FAILED` for a savepoint that was released.
- **The outer timeout with a savepoint open.** `withTransaction` rejects and destroys the connection without waiting for the callback (unchanged). Slice 3, rule 5 leaves the open savepoint to its owner, which is `withSavepoint`: it must call `rollback()` so the savepoint's activity ends.
- **The `ROLLBACK TO` failure cannot be produced on a real database without raw savepoint statements from user code**, and a refused start needs a middleware, so both are stub-driver tests only.

## Size

About 560 changed lines, measured against the code: about 170 production (`sql-runtime.ts` about 110, `runtime-transaction.ts` about 15, the facade about 35, Supabase and exports about 5), about 350 tests (stub-driver tests about 190, PGlite tests about 130, type tests about 30), about 40 docs. The project plan estimated 540.

## Plan (one dispatch)

**D1: `withSavepoint` and `tx.transaction(cb)` on the Postgres facade.**

- **Outcome:** everything in § Chosen design and § Slice done conditions.
- **Builds on:** slice 3 (`RuntimeTransaction.transaction()`, the guard) and slice 3b (`runTransactionOn`).
- **Hands to:** slice 5 (`withSavepoint` for the MySQL, SQLite and Supabase facades, and the review of its shape).
- **Focus:** tests first. Suggested commits: (1) runtime: the shared guarded context and settle code, `withSavepoint`, the savepoint's settlement member, with the stub-driver tests; (2) the Postgres facade, the Supabase type, the type tests and the PGlite tests; (3) docs. Commits may merge where a split leaves the workspace failing typecheck.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter @internal/sql-runtime test`, `pnpm --filter @internal/postgres test`, `pnpm --filter @internal/extension-supabase test`.
  - `pnpm --filter <pkg> lint` for the three packages, and `pnpm lint:deps`.
  - `pnpm test:integration`: `runTransactionOn` is restructured, and every facade and the ORM run through it.

## References

- Project spec: decisions 1, 2, 3, 9, 10; cross-cutting requirements; transitional-shape constraints. Project plan: slice 4.
- Slice 3: `slices/runtime-savepoints/spec.md` (rules 5, 7, 8), PR #31053. Slice 3b: `slices/handle-transaction-callback/spec.md`, PR #31073.

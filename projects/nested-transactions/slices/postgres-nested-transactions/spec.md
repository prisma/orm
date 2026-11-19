# Slice: postgres-nested-transactions

**Project:** `projects/nested-transactions/` (slice 4). **Linear:** skipped by the operator.

## Outcome

Postgres users can call `tx.transaction(cb)` inside `db.transaction(cb)`, to any depth, with every behaviour in the project spec. The SQL runtime's `TransactionContext` gains `transaction(fn)`, which the Postgres facade wraps and slice 5's facades will wrap the same way.

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
    transaction: (fn) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  })
}

// db.transaction(fn, options):
withTransaction(workRuntime, (txCtx) => fn(buildTransactionContext(txCtx)), { isolationLevel, timeout })
```

## Chosen design

### `transaction(fn)` on the runtime's `TransactionContext` (`packages/2-sql-family/5-runtime/src/sql-runtime.ts`)

```ts
export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
  transaction<R>(fn: (tx: TransactionContext) => PromiseLike<R>): Promise<R>;
}
```

1. **The context opens its own savepoint.** The guarded context is built with its `RuntimeTransaction` in hand. Its `transaction(fn)` method calls that transaction's `transaction()` (slice 3), calls `fn` with the nested guarded context and settles the savepoint. No function takes a context and finds its transaction: there is no symbol-keyed member, no type guard, no invariant and no exported `withSavepoint`. Nothing in this slice is named "level" (slice 3 removed a `TransactionLevel` class).
2. **No options** (project spec decision 2). The method has one parameter, on the runtime context and on the facade's `tx`.
3. **One guarded context for every level.** The code in `runTransactionOn` that builds the guarded context (`guardedStream`, `guardedQueryable`, `guardedSource`, `guardedHandle`, the context object) becomes a function that builds the context for any `RuntimeTransaction`, given a way to ask whether the context is closed. The outer transaction and every savepoint get their context from it. Keep the functions nested as they are, so the diff shows the new wrapper and not ninety moved lines.
   - A context is closed once its callback has settled, the outer transaction's signal has aborted, or its transaction is closed. The first two are the context's own flag, as for `tx` today. The third it reads from its `RuntimeTransaction`, which knows from the stack; a context holds no reference to the enclosing context's flag.
   - **An enclosing callback that returns while a nested call is still running** (a nested call that was not awaited) is handled by the transaction stack, not by the contexts. The enclosing entry's `commit()` and `rollback()` are refused as suspended (slice 3, rule 5), so the callback code could not settle it. Whenever the settle sequence ends with the database having neither committed nor rolled back the entry, it invalidates the stack, through a function on the settlement member (`settlementOf`). Every context on the transaction is then closed: `invalidated` is `true`, work rejects with `RUNTIME.TRANSACTION_CLOSED`, and a stream already open on it rejects with `RUNTIME.TRANSACTION_CLOSED` at its next row. The existing code destroys the connection. `commit()` and `rollback()` themselves do not change: called directly on a `RuntimeTransaction` below the top, they still reject `RUNTIME.TRANSACTION_SUSPENDED` and leave the stack as it was. Every entry's activity is still ended exactly once.
   - Closed means what it means for `tx` today: `invalidated` is `true`, and `query`, `execute`, the prepared-statement members, `startActivity` and `transaction` reject with `RUNTIME.TRANSACTION_CLOSED` before anything reaches the driver.
   - While a nested callback runs, work on the enclosing context rejects with `RUNTIME.TRANSACTION_SUSPENDED`. The runtime already does this (slice 3, rule 5); the method adds no check of its own.
   - A handle opened on a nested context has no `transaction` member, as a handle on `tx` has none (slice 6 changes both).
4. **One settle sequence for every level.** The part of `runTransactionOn` from the call to `fn` to the end is shared by the outer transaction and the savepoint. The shared function takes the transaction and `fn`, nothing else. It takes no callbacks: slice 3 removed callbacks that do nothing for one of the two kinds. Each caller does its own part around the call:

   - `runTransactionOn` decides the connection's clean or unclean state after the call, from the outer transaction's settlement: clean when the database committed or rolled back, unclean otherwise. The reason it passes to `destroy()` is the error the call rejected with. For a failed `COMMIT` or `ROLLBACK` that is the `RUNTIME.TRANSACTION_COMMIT_FAILED` or `RUNTIME.TRANSACTION_ROLLBACK_FAILED` error, which holds the driver's error in its details; before this slice it was the driver's error itself.
   - The context's `transaction(fn)` catches the rejection and, when the signal has aborted, calls the savepoint's `rollback()` and ignores its rejection.

   For a savepoint the sequence gives project spec decision 9:

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
5. **Nothing new is exported.** `TransactionContext` is exported already. `withSavepoint` is removed from `packages/2-sql-family/5-runtime/src/exports/index.ts`.

### Postgres facade (`packages/3-targets/postgres/9-facade/src/runtime/postgres-members.ts`)

6. **`PostgresTransactionContext` gains `transaction`:**

   ```ts
   transaction<R>(
     fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
   ): Promise<R>;
   ```

   The nested context has the same type and the same members as `tx`, including `transaction`.
7. **Wiring** as in § At a glance: one function builds the facade's context for a `TransactionContext`, and its `transaction` member calls `txCtx.transaction` and builds the facade's context again for the nested one. `db.transaction` on the pooled client and on a serverless connection both go through `buildPostgresRuntimeBoundMembers`, so both get it.
8. **Supabase's type has the runtime's member until slice 5.** `SupabaseTransactionContext` is an alias of `PostgresTransactionContext` today (`supabase.ts:103`). The Postgres member promises a nested context with the Postgres facade's members, and the Supabase object does not build one: it has the runtime's member through its prototype. So the type becomes the Postgres context type with its `transaction` replaced by the runtime's `TransactionContext['transaction']`, and the type and the object match. This is the only change to the Supabase extension's source. Slice 5 makes it an alias again when it wires Supabase.
9. **MySQL and SQLite get the runtime's member as it is, until slice 5.** Every facade's context type extends the runtime's `TransactionContext`, and `withTransactionMembers` builds the facade's `tx` with the runtime context as its prototype. So `tx.transaction(cb)` is in the MySQL and SQLite types and works as a savepoint at run time, and `cb` receives the runtime context, without `orm`, `sql` or `enums`. Supabase is the same (item 8). The operator chose to leave this visible instead of hiding it in the types. No source file of those facades changes in this slice; a test there that asserts `tx` has no `transaction` is changed to the least that is true now.

## Coherence rationale

The runtime method has no caller without a facade. The method, its first facade and the tests that show the user-visible behaviour on a real database are one reviewable change. The other facades' own members and tests are slice 5.

## Scope

**In:**

- `packages/2-sql-family/5-runtime/src`: `sql-runtime.ts`, `runtime-transaction.ts` (the savepoint's settlement member), and the package README where it describes the transaction context.
- `packages/2-sql-family/5-runtime/test`: a new `nested-transaction.test.ts` with the stub driver from `transaction-activity-fixtures.ts`; the test files that build a `TransactionContext` by hand gain the member.
- `packages/3-targets/postgres/9-facade`: `src/runtime/postgres-members.ts`; a new PGlite integration test file; `test/transaction.types.test-d.ts` (its test that the context has no `transaction` is replaced); `README.md` (the Transactions section says `tx` has no `transaction`).
- `packages/3-extensions/supabase/src/runtime/supabase.ts`: item 8 only.
- Docs: the `withTransaction` section of `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` (about lines 690–721, and the member list at 704), and the user-facing skill reference `skills/prisma-8/references/queries-postgres.md`, with a short paragraph on `tx.transaction(cb)` on Postgres.
- Upgrade instructions under `upgrade-instructions/pending/`, for the new required member on `TransactionContext` and on `PostgresTransactionContext`.

**Out:**

- `packages/1-framework/**`.
- The MySQL and SQLite facades' own `transaction` member and tests, and Supabase beyond item 8 (slice 5). Item 9 says what they have until then.
- `transaction()` on activity handles opened under a transaction, and `sql-orm-client` (slice 6). ORM calls on a nested context run flattened in the savepoint, as they do on `tx` today.
- `withTransaction`'s behaviour: options, timeout, abort handling, error codes, and when it releases or destroys the connection. Its existing tests pass unchanged.
- The savepoint rules of slice 3 (`TransactionStack`, the guard, `Savepoint.commit()` and `rollback()`), apart from the settlement member.

## Slice done conditions

Beyond CI, review and the project DoD. Each path is tested once, at the level named.

**Runtime tests with the stub driver** (`nested-transaction.test.ts`):

- [ ] `cb` resolves: `SAVEPOINT sp_1`, the statement, `RELEASE SAVEPOINT sp_1`, and the call resolves with `cb`'s result. A nested call inside a nested call uses `sp_2`.
- [ ] `cb` throws: `ROLLBACK TO SAVEPOINT sp_1`, the same error is rethrown, the savepoint is finalized `rolled-back`, and the outer transaction then runs a statement and commits.
- [ ] `RELEASE` fails and `ROLLBACK TO` succeeds: `RUNTIME.TRANSACTION_COMMIT_FAILED` with the `RELEASE` error as `cause`; the outer transaction then commits.
- [ ] `ROLLBACK TO` fails after `cb` threw: `RUNTIME.TRANSACTION_ROLLBACK_FAILED` with `cb`'s error as `cause`; the next statement on the outer context rejects `RUNTIME.TRANSACTION_CLOSED`; `withTransaction` sends no `COMMIT` or `ROLLBACK` and destroys the connection.
- [ ] An `activityStarted` hook refuses the savepoint: the call rejects with the hook's error, no `SAVEPOINT` is sent, `cb` is not called, and the outer transaction commits.
- [ ] `RELEASE` resolved and an `activityEnded` hook throws: the hook's error unchanged, no `ROLLBACK TO`.
- [ ] After the nested call settles, work on the nested context, including `transaction` on it, rejects `RUNTIME.TRANSACTION_CLOSED` with nothing sent.
- [ ] The outer timeout fires while a nested `cb` runs: the nested call rejects with `RUNTIME.TRANSACTION_TIMEOUT`, and the savepoint's activity is ended and finalized.
- [ ] A nested call that is not awaited and still running when the enclosing callback returns, with the outer transaction and with a savepoint as the enclosing entry: the enclosing call rejects `RUNTIME.TRANSACTION_COMMIT_FAILED`; work on every context of the transaction then rejects `RUNTIME.TRANSACTION_CLOSED` with nothing sent; the nested context whose callback is still running has `invalidated === true`, and a stream it had open rejects `RUNTIME.TRANSACTION_CLOSED` at its next row; the connection is destroyed; every transaction activity is ended once.

**PGlite integration tests** (Postgres facade):

- [ ] The At a glance example: A and C committed, B not. On the pooled client and on a serverless connection.
- [ ] Recovery from the aborted state: a statement fails inside a nested transaction, the nested call rejects with the database error, and the outer transaction then commits work done after it.
- [ ] A statement fails inside a nested callback that catches the error and returns: `RELEASE` fails on Postgres, the nested call rejects `RUNTIME.TRANSACTION_COMMIT_FAILED`, and the outer transaction then commits work done after it.
- [ ] `Promise.all([tx.transaction(a), tx.transaction(b)])`: one rejects `RUNTIME.TRANSACTION_SUSPENDED`. A statement on `tx` while a nested callback is running rejects `RUNTIME.TRANSACTION_SUSPENDED`, and `tx` works again after the nested call settles.
- [ ] A nested transaction inside a nested transaction: the inner one rolls back, the middle one and the outer one commit.

**Type tests:**

- [ ] `tx.transaction` exists on `PostgresTransactionContext`, has one parameter, infers the callback's return type, and passes a context of the same type. `SupabaseTransactionContext['transaction']` is the runtime's `TransactionContext['transaction']`. The runtime's `TransactionContext` has `transaction` with one parameter, and its callback receives a `TransactionContext`.

## Edge cases investigated

- **Supabase aliases the Postgres context type.** See item 8. Without it, either Supabase's type would promise a nested context with members its object does not build, or this slice would wire Supabase without slice 5's tests.
- **A hook error after the database settled a savepoint.** `Savepoint.commit()` rejects with an `activityEnded` hook's error after `RELEASE` resolved, and `rollback()` then rejects `RUNTIME.TRANSACTION_CLOSED` (slice 3b). Without the settlement member, the shared settle code would report `RUNTIME.TRANSACTION_COMMIT_FAILED` for a savepoint that was released.
- **The outer timeout with a savepoint open.** `withTransaction` rejects and destroys the connection without waiting for the callback (unchanged). Slice 3, rule 5 leaves the open savepoint to its owner, which is the context's `transaction(fn)`: it must call `rollback()` so the savepoint's activity ends.
- **The `ROLLBACK TO` failure cannot be produced on a real database without raw savepoint statements from user code**, and a refused start needs a middleware, so both are stub-driver tests only.

## Size

About 560 changed lines, measured against the code: about 170 production (`sql-runtime.ts` about 110, `runtime-transaction.ts` about 15, the facade about 35, Supabase and exports about 5), about 350 tests (stub-driver tests about 190, PGlite tests about 130, type tests about 30), about 40 docs. The project plan estimated 540.

## Plan (one dispatch)

**D1: `transaction(fn)` on the runtime context and `tx.transaction(cb)` on the Postgres facade.**

- **Outcome:** everything in § Chosen design and § Slice done conditions.
- **Builds on:** slice 3 (`RuntimeTransaction.transaction()`, the guard) and slice 3b (`runTransactionOn`).
- **Hands to:** slice 5 (the MySQL, SQLite and Supabase facades wrap `txCtx.transaction` as Postgres does).
- **Focus:** tests first. Suggested commits: (1) runtime: the shared guarded context and settle code, the context's `transaction(fn)`, the savepoint's settlement member, with the stub-driver tests; (2) the Postgres facade, the Supabase type, the type tests and the PGlite tests; (3) docs. Commits may merge where a split leaves the workspace failing typecheck.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter @internal/sql-runtime test`, `pnpm --filter @internal/postgres test`, `pnpm --filter @internal/extension-supabase test`.
  - `pnpm --filter <pkg> lint` for the three packages, `pnpm lint:deps` and `pnpm check:error-reference`.
  - `pnpm test:integration`: `runTransactionOn` is restructured, and every facade and the ORM run through it.

## Amendments

- **D1 review R1: an invariant, not a new error code.** The first implementation rejected a context the runtime did not make with a new `RUNTIME.UNKNOWN_TRANSACTION_CONTEXT`. Item 1 now names the invariant, and `pnpm check:error-reference` joined the gate.
- **After the PR opened: no settle callbacks, and no "level".** The first implementation passed the shared settle function two callbacks (`onAborted`, `markUnclean`), one of which did nothing for a savepoint, and named the context's internal member `transactionLevel`, with a second copy of the context's closed state. Both bring back things slice 3's review removed. Items 1 and 4 now say what replaces them. Requested by the operator.

- **After the PR opened: the stack, not the contexts, closes a transaction whose enclosing callback returned early.** The second implementation gave the shared function a third parameter, `isEnclosingClosed`, so that a nested context could read the enclosing context's flag; the outer transaction passed `() => false`. The only case it served is a nested call that was not awaited. The stack already carries the closed state of every entry, so the settle sequence now invalidates the stack when it could not settle an entry, and the parameter is gone. Requested by the operator.
- **After the PR opened: the `destroy()` reason is the error the call rejected with.** Item 4 said the reason stays what it was, and the implementation had a helper, `settleFailureOf`, that read the driver's error back out of the `RUNTIME.*` error to keep it so. The reason is advisory, the driver's error is still in the details of the error passed, and the helper is removed. Decided by the operator. A nested context whose callback is still running after the stack was invalidated keeps `invalidated === false` while its work rejects `RUNTIME.TRANSACTION_CLOSED`; the operator chose to leave that.
- **After the PR opened: the runtime context has `transaction(fn)`; `withSavepoint` is removed.** Project spec decision 10 made `withSavepoint(txCtx, fn, buildMembers)` an exported function. It received only the context, so the context had to hold its `RuntimeTransaction` under an unexported symbol, with a type guard and an invariant for objects without it. The context is built from that transaction, so it now has the method itself and the facade wraps it. Decision 10 said the shape is reviewed after the first facade; the operator reviewed it and chose this. Item 9 records what the other facades have until slice 5, which is an exception to the project spec's transitional-shape constraint, also chosen by the operator.
- **After the PR opened: a context is closed when its transaction is.** An earlier entry here left a nested context reporting `invalidated === false` after the stack was invalidated. A stream already open on that context then kept yielding buffered rows, because the stream guard read only the context's own flag. The context's closed check now also reads its transaction. Decided by the operator; it replaces the last sentence of the `destroy()` entry above.
- **After the PR opened: the subsystem doc says less.** The operator's review asked for the nested-transaction paragraph in the subsystem doc to be removed: the file is at its `main` text with only untrue claims corrected. § Scope's "Docs" line described a rewrite of that section; the corrections are what ships.
- **After the PR opened: Supabase's type shows the runtime's member.** Item 8 first hid `transaction` from `SupabaseTransactionContext` with `Omit`, while the object had the runtime's member at run time. The operator chose to show it, as on MySQL and SQLite.

## References

- Project spec: decisions 1, 2, 3, 9, 10; cross-cutting requirements; transitional-shape constraints. Project plan: slice 4.
- Slice 3: `slices/runtime-savepoints/spec.md` (rules 5, 7, 8), PR #31053. Slice 3b: `slices/handle-transaction-callback/spec.md`, PR #31073.

# Slice: other-facades

**Project:** `projects/nested-transactions/` (slice 5). **Linear:** skipped by the operator.

## Outcome

`tx.transaction(cb)` on the MySQL, MariaDB, SQLite and Supabase facades passes `cb` a context with the facade's members, to any depth, as the Postgres facade does since slice 4. The transitional exception in the project spec (the nested callback receives the runtime's context on these facades) ends.

## At a glance

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.create(a)                      // A

  await tx
    .transaction(async (inner) => {                // SAVEPOINT sp_1
      await inner.orm.Post.create(b)               // B: inner.orm exists after this slice
      throw new Error('nope')                      // ROLLBACK TO SAVEPOINT sp_1, rethrow
    })
    .catch(() => {})                               // tx is usable again

  await tx.orm.Audit.create(c)                     // C
})                                                 // COMMIT: A and C land, B does not
```

Before this slice, on MySQL, MariaDB, SQLite and Supabase, `inner` is the runtime's `TransactionContext`: it has `query`, `execute`, `invalidated` and `transaction`, and no `orm`, `sql`, `raw`, `prepare`, `toSql` or `enums`.

In each facade, the same wiring as `postgres-members.ts`:

```ts
function buildTransactionContext(txCtx: TransactionContext): MysqlTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...buildMysqlTransactionMembers({ ...options }, txCtx),
    transaction: <R>(
      fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  })
}

// db.transaction(fn, options):
withTransaction(workRuntime, (txCtx) => fn(buildTransactionContext(txCtx)), { isolationLevel, timeout })
```

## Chosen design

Project spec decision 10: the runtime's `TransactionContext` has `transaction(fn)` with all the savepoint logic, and each facade wraps it so the nested callback gets the facade's members. This slice adds the wrapping to the three facades that do not have it. No runtime code changes.

### MySQL and MariaDB (`packages/3-targets/mysql/1-mysql/9-facade/src/runtime/mysql.ts`)

1. **`MysqlTransactionContext` declares its own `transaction`:**

   ```ts
   transaction<R>(
     fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
   ): Promise<R>;
   ```

   One parameter and no options (project spec decision 2). The nested context has the same type and members as `tx`, including `transaction`.
2. **Wiring.** Inside `createMysqlClient`, one function builds the facade's context for a `TransactionContext`. Its `transaction` member calls `txCtx.transaction` and builds the facade's context again for the nested one. `db.transaction` calls `withTransaction` with that function. `buildMysqlTransactionMembers` keeps its return type (`Omit<MysqlTransactionContext, keyof TransactionContext>`, which has no `transaction`), so the member is added where the context is built, as in `postgres-members.ts`.
3. **MariaDB needs no source change.** `mariadb()` is `createMysqlClient` applied to MariaDB's components, and `MariadbTransactionContext` is an alias of `MysqlTransactionContext`.

### SQLite (`packages/3-targets/sqlite/9-facade/src/runtime/sqlite.ts`)

4. **`SqliteTransactionContext` declares its own `transaction`**, with the same shape as item 1, and the client is wired as in item 2 around `buildSqliteTransactionMembers`.

### Supabase (`packages/3-extensions/supabase/src/runtime/supabase.ts`)

5. **`SupabaseTransactionContext` is an alias of `PostgresTransactionContext` again.** The `Omit<…, 'transaction'> & Pick<TransactionContext, 'transaction'>` that slice 4 put there is removed. The nested callback therefore receives a `PostgresTransactionContext`, which is the same type as `SupabaseTransactionContext`.
6. **Wiring.** In `buildRoleBoundDb`, one function builds the role-bound transaction context for a `TransactionContext` (the members it builds today, plus `transaction` as in item 2), and `transaction` on the role-bound client calls `withTransaction(role, …)` with it.
7. **Nothing is done for the role around a savepoint.** The role and JWT claims are bound with session-scoped `set_config` before the first savepoint and reset when the connection is given back, so `SAVEPOINT`, `RELEASE` and `ROLLBACK TO` leave them as they are (project spec, adapter impact table). A test shows it.

### On every facade

8. **Behaviour comes from the runtime, unchanged.** Suspension of the enclosing context, closing of the nested context after it settles, settle failures and the timeout are the runtime's and are tested there and on Postgres (slice 4). This slice tests what it adds: that the nested callback gets the facade's members and that the work around a nested call that threw is committed on each database.
9. **ORM calls on a nested context run flattened in the savepoint**, as they do on `tx` today. Running a multi-statement ORM write in its own savepoint is slice 6.

## Coherence rationale

The three facades get the same six-line wrapping and the same test, and together they end one transitional exception. Split by facade, each PR would be about a hundred lines with the same review.

## Scope

**In:**

- `packages/3-targets/mysql/1-mysql/9-facade`: `src/runtime/mysql.ts`; a type test for `tx.transaction` in `test/transaction-options.types.test-d.ts` or a new type-test file; `README.md`.
- `packages/3-targets/mysql/3-live-tests`: a new suite `test/suites/nested-transactions.ts`, run from `test/mysql/` and `test/mariadb/`.
- `packages/3-targets/sqlite/9-facade`: `src/runtime/sqlite.ts`; a new test file for nested transactions on a `node:sqlite` database; `test/transaction.types.test-d.ts` (the test "transaction context has the runtime transaction method" is replaced); `README.md` (line 144 says the callback receives the runtime's context "for now").
- `packages/3-extensions/supabase`: `src/runtime/supabase.ts`; a PGlite integration test; `test/transaction-members.types.test-d.ts` (the test "a transaction has the runtime transaction method…" is replaced, and "a role-bound transaction has the members of a postgres transaction" compares the whole types again); `README.md` (line 87 says the same "for now" sentence and describes the type with the runtime's member).
- `skills/prisma-8/references/runtime.md` § Workflow — Transactions: nested transactions are no longer Postgres-only. The paragraph and example in `queries-postgres.md` stay where they are.
- Upgrade instructions under `upgrade-instructions/pending/`, written with the `record-upgrade-instructions` skill. `pnpm check:upgrade-coverage --mode pr` requires a declaration because `packages/3-extensions/**` changes. `MysqlTransactionContext`, `MariadbTransactionContext` and `SqliteTransactionContext` each have a `transaction` member whose callback receives the facade's context, and `SupabaseTransactionContext` is `PostgresTransactionContext`.

**Out:**

- `packages/2-sql-family/5-runtime/**`, `packages/1-framework/**` and the Postgres facade. If the wrapping cannot be done without changing one of them, stop and report.
- `sql-orm-client` and `transaction()` on an activity handle inside a transaction (slice 6).
- Error-path tests on these facades (suspension, `RELEASE` failure, `ROLLBACK TO` failure, timeout, refused start). They are covered once, by the runtime's stub-driver tests and the Postgres PGlite tests of slice 4.
- ADR 271 and the subsystem doc (project close).
- The Prisma 7 port tracking under `test/integration/test/ports/`.

## Adapter impact

| Target | Change |
|---|---|
| MySQL, MariaDB facade | `tx.transaction(cb)` passes the facade's context. |
| SQLite facade | The same. |
| Supabase extension | The same; `SupabaseTransactionContext` aliases `PostgresTransactionContext`. |
| Postgres facade, drivers, runtime, Mongo | None. |

## Contract impact

None.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| MySQL commits the transaction on DDL, which removes its savepoints. | The live suite creates nothing inside a transaction. | It uses the seeded example database (`withSeededDatabase`, `exampleDatabase`), as `suites/transaction-isolation.ts` does. |
| On MySQL and SQLite a failed statement does not abort the transaction, so a nested callback that catches the error and returns is released, and its earlier statements stay. On Postgres the same callback is rolled back with `RUNTIME.TRANSACTION_COMMIT_FAILED`. | Documented in one sentence in the MySQL and SQLite READMEs. No test in this slice. | Project spec decision 6 records the difference. It is a property of the databases, not of the wrapping. |
| The live MySQL and MariaDB suites skip a server whose URL is not set (`MYSQL_URL`, `MARIADB_URL`), except in CI. | The implementer starts the servers (`docker compose up mysql mariadb`) and reports whether the suite ran. A skipped suite is reported as not verified. | `packages/3-targets/mysql/3-live-tests/README.md`. |
| The Supabase PGlite test needs the Supabase roles in the dev database. | Reuse the setup of `test/rls-role-binding.integration.test.ts`. | The test may be added to that file or to a new one, whichever needs less setup code. |

## Slice-specific done conditions

Each is one test, at the level named.

**Database tests:**

- [ ] **SQLite** (`node:sqlite`): the At a glance example through the facade's members on `inner`: A and C are committed, B is not.
- [ ] **SQLite:** three levels. The innermost context, reached through `tx.transaction` and then `middle.transaction`, has the facade's members; it rolls back, and the middle and outer levels commit.
- [ ] **MySQL and MariaDB** (live, one shared suite): the same two tests.
- [ ] **Supabase** (PGlite, on a role-bound client): the At a glance example through the facade's members on `inner`. Statements inside the nested callback and after the nested rollback run under the bound role.

**Type tests:**

- [ ] On `MysqlTransactionContext`, `SqliteTransactionContext` and `SupabaseTransactionContext`: `tx.transaction` has one parameter, its callback receives a context of the same type as `tx`, and the call infers the callback's result. `MariadbTransactionContext['transaction']` is `MysqlTransactionContext['transaction']`.
- [ ] `SupabaseTransactionContext` equals `PostgresTransactionContext`.

**Greps:**

- [ ] `rg "for now the callback receives the runtime" packages skills` returns nothing.
- [ ] `rg "Pick<TransactionContext, 'transaction'>" packages/3-extensions` returns nothing.

## Size

About 400 changed lines, measured against the code:

- Production, about 70: `mysql.ts` about 20, `sqlite.ts` about 20, `supabase.ts` about 30.
- Tests, about 280: the SQLite test file about 80, the MySQL live suite and its two runners about 80, the Supabase PGlite test about 80, type tests about 40.
- Docs, about 15: three READMEs and `runtime.md`.
- Upgrade instructions, about 35.

The project plan estimated 400. The operator's cap is about 500.

## Plan (one dispatch)

**D1: the facade's `transaction` member on MySQL, SQLite and Supabase transaction contexts.**

- **Outcome:** everything in § Chosen design and § Slice-specific done conditions.
- **Builds on:** slice 4 (`transaction(fn)` on the runtime's `TransactionContext`, and the wrapping in `postgres-members.ts`).
- **Hands to:** every SQL facade exposing `tx.transaction(cb)` with its own members. Slice 6 and project close do not depend on anything else from this slice.
- **Focus:** tests first. Suggested commits: (1) SQLite; (2) MySQL and the live suite; (3) Supabase; (4) docs and upgrade instructions. Commits may merge where a split leaves the workspace failing typecheck.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter <pkg> test` for `@internal/sqlite`, `@internal/mysql`, `@internal/mariadb`, `@internal/mysql-live-tests` (with `MYSQL_URL` and `MARIADB_URL` set) and `@internal/extension-supabase`.
  - `pnpm --filter <pkg> lint` for the same packages, and `pnpm lint:deps`.
  - `pnpm lint:skills` and `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD`.

## Open Questions

None.

## References

- Project spec: decisions 2, 6, 10; adapter impact; transitional-shape constraints. Project plan: slice 5.
- Slice 4: `slices/postgres-nested-transactions/spec.md` (items 6–9), PR #31106 (merged as `cfc6be5d1cd0c`).
- Pattern: `packages/3-targets/postgres/9-facade/src/runtime/postgres-members.ts` (`buildTransactionContext`), `packages/3-targets/postgres/9-facade/test/nested-transactions.integration.test.ts`, `packages/3-targets/postgres/9-facade/test/transaction.types.test-d.ts`.
- Upgrade instructions of slice 4: `upgrade-instructions/pending/postgres-nested-transactions/extension/instructions.md`.

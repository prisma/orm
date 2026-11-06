---
changes:
  - id: client-query-and-to-sql
    summary: |
      Additive for code that only uses these types. Every SQL client gets `query(plan)` and `execute(plan)`, with the types a transaction's have, and `toSql(plan)`, which returns `{ sql, params }` with no database. A serverless connection gets `query` and `execute` too; the serverless client, `postgresStatic()`, `sqliteStatic()` and every transaction get `toSql`. `postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take `mode: 'strict' | 'permissive'`. `supabase()` creates its pool on the first query instead of when it is called. Application code can move from `db.runtime().query(plan)` to `db.query(plan)`; code that builds its own object of one of the changed types, such as a test double, must add the new members. The detection matches a file that names one of the changed types, or calls `runtime().query(` or `runtime().execute(`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$])(?:PostgresClient|PostgresServerlessClient|PostgresServerlessConnection|PostgresStaticContext|PostgresStaticMembers|PostgresQueryMembers|SqliteClient|SqliteStaticContext|SqliteQueryMembers|RoleBoundDb|ServiceRoleDb|SupabaseInternalDb|PostgresTransactionContext|SqliteTransactionContext|SupabaseTransactionContext|SqliteStaticMembers)(?![\w$])'
        - '\.runtime\(\)\s*\.(?:query|execute)\('
---

# A client runs plans and renders SQL

Every SQL client now runs a plan itself and renders the SQL a plan would send:

```ts
const plan = db.sql.public.post.select('id', 'title').limit(10).build();
console.log(db.toSql(plan)); // { sql: 'SELECT … LIMIT 10', params: [] }
for await (const row of db.query(plan)) console.log(row);
await db.execute(db.raw.sql`UPDATE post SET pinned = false`.affectedCount().build());
```

`db.query(plan)` and `db.execute(plan)` behave as `db.runtime().query(plan)` and `db.runtime().execute(plan)` do, and have the types `tx.query` and `tx.execute` have. Replace `db.runtime().query(` with `db.query(` and `db.runtime().execute(` with `db.execute(`. Keep `db.runtime()` where the code needs `connection()`, `close()` or `telemetry()`. On Supabase, call them on a role-bound client, as before.

`toSql(plan)` needs only the adapter and the contract, so it works with no database. `params` are the plan's values before codecs encode them. Middleware rewrites (`beforeCompile`) are not applied. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would.

The message of `RUNTIME.PREPARE_BIND_ON_ADHOC` changed; its code did not. Code that matches the old message text ("Ad-hoc execute received a bind-site slot") must match the code instead. The details of `PLAN.TARGET_MISMATCH` and `PLAN.HASH_MISMATCH` rename `runtimeTarget` to `contractTarget` and `runtimeStorageHash` to `contractStorageHash`, and their messages changed; match the codes.

Code that only reads these types needs no change. Code that creates an object of one of them, for example a test double typed `PostgresClient<Contract>`, must add the new members:

| Type | New members |
| --- | --- |
| `PostgresClient`, `PostgresServerlessConnection` (`@prisma/orm-postgres/runtime`, `/serverless`) | `query`, `execute`, `toSql` |
| `PostgresServerlessClient`, `PostgresStaticContext`, `PostgresStaticMembers` | `toSql` |
| `PostgresQueryMembers` | `query`, `execute`, `toSql` |
| `SqliteClient` (`@prisma/orm-sqlite/runtime`) | `query`, `execute`, `toSql` |
| `SqliteStaticContext` | `toSql` |
| `SqliteQueryMembers` | `query`, `execute`, `toSql` |
| `PostgresTransactionContext`, `SqliteTransactionContext`, `SupabaseTransactionContext` | `toSql` |
| `RoleBoundDb`, `ServiceRoleDb` (`@prisma/orm-extension-supabase/runtime`) | `toSql`; `query` and `execute` now take the plan type every SQL client shares |
| `SupabaseInternalDb` (the service role's `supabase` member) | `toSql`, over the Supabase contract |
| `SqliteStaticMembers` (`@prisma/orm-sqlite/runtime`) | new: the static context plus `stack`, which `SqliteClient` now extends |

`supabase()` no longer creates its `pg.Pool`, driver or runtimes when it is called. It creates them on the first query, so creating a client with a URL opens nothing. It is still `async` and still requires `jwtSecret` or `jwksUrl`. `close()` now ends only a pool the client created from `url`; a `pg.Pool` passed in with the `pg` option stays open, as with `postgres()`, and the caller ends it.

The new `mode` option, typed `RuntimeMode`, is `'strict'` by default, which is how every client ran before. Under `'permissive'`, a `budgets()` violation whose severity is `'warn'` goes to `log.warn` and the query runs.

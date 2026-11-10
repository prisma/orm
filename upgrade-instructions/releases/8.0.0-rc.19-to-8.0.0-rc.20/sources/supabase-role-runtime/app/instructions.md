---
changes:
  - id: supabase-for-role-replaces-with-role-methods
    summary: |
      `SupabaseRuntime` no longer has `queryWithRole`, `executeWithRole`, `preparedQueryWithRole` or `preparedExecuteWithRole`, and `SupabaseRuntimeImpl` no longer has `roleActivitySource`. Call `runtime.forRole(binding)` once and use its members: `runtime.queryWithRole(plan, binding, options)` becomes `runtime.forRole(binding).query(plan, options)`, `executeWithRole` becomes `forRole(binding).execute`, and a prepared statement runs on the role with `statement.query(runtime.forRole(binding), params)` or `statement.execute(runtime.forRole(binding), params)`. The detection matches files that call one of the removed methods.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.(?:queryWithRole|executeWithRole|preparedQueryWithRole|preparedExecuteWithRole|roleActivitySource)\('
  - id: supabase-role-types-gain-members
    summary: |
      Three public Supabase types require new members, so a test double or hand-built object typed with them stops compiling. `RoleBoundDb` and `ServiceRoleDb` gain `enums` and `nativeEnums`. `SupabaseTransactionContext` is now `PostgresTransactionContext`, so it gains `enums` and `nativeEnums` too. `SupabaseRuntime` requires `forRole(binding)`, which returns a `SupabaseRoleScope` (`query`, `execute`, the prepared-statement operations and `connection`), in place of the four removed `*WithRole` methods. Add the members to each double: take `enums` and `nativeEnums` from `postgresStatic({ contract })` of `@prisma/orm-postgres/static`, or from a role-bound client. The detection matches files that name one of these types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:RoleBoundDb|ServiceRoleDb|SupabaseTransactionContext|SupabaseRuntime)(?![\w$])'
  - id: supabase-pg-takes-a-pool
    summary: |
      The `pg` option of `supabase()` takes a `pg.Pool` only. A `pg.Client` is a type error and fails at `supabase()` with `SUPABASE.CONFIG_INVALID`. Replace `pg: new Client(...)` with `pg: new Pool(...)` built from the same settings, or pass `url`. The detection matches every `supabase()` call that passes `pg`; leave a call that already passes a `pg.Pool` as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*\{(?:[^{}]|\{[^{}]*\})*?(?<![\w$.])pg\s*[:,}]'
  - id: supabase-close-waits-for-work
    summary: |
      `db.close()` on a Supabase client now refuses new work at once on every role-bound client and on `.supabase`, with `DRIVER.NOT_CONNECTED` "Runtime is closed", and waits for work already running, open role transactions included, before it ends the pool. With a pool you passed as `pg`, a query after `close()` used to throw at the call; its promise now rejects instead. Await every role transaction before `close()`, or `close()` waits for it.
---

# Supabase runs every role operation through one object

`SupabaseRuntime.forRole(binding)` returns a `SupabaseRoleScope`, the runtime operations under one role: `query`, `execute`, the prepared-statement operations and `connection`. Run a transaction under the role with `withTransaction(runtime.forRole(binding), fn)`.

| Type | New required members |
| --- | --- |
| `RoleBoundDb`, `ServiceRoleDb` | `enums`, `nativeEnums` |
| `SupabaseTransactionContext` | `enums`, `nativeEnums` (it is now `PostgresTransactionContext`) |
| `SupabaseRuntime` | `forRole(binding)`, in place of the four `*WithRole` methods |


```ts
// Before
const rows = await runtime.queryWithRole(plan, { role: 'anon' }).toArray();
const stats = await runtime.executeWithRole(plan, { role: 'anon' });
const named = await runtime.preparedQueryWithRole(statement, params, { role: 'anon' }).toArray();

// After
const anon = runtime.forRole({ role: 'anon' });
const rows = await anon.query(plan).toArray();
const stats = await anon.execute(plan);
const named = await statement.query(anon, params).toArray();
```

The `pg` option takes a `pg.Pool`:

```ts
// Before
const db = await supabase({ contract, pg: new Client({ connectionString }), jwtSecret });

// After: close() does not end a pool you pass in, so keep it and end it at shutdown
const pool = new Pool({ connectionString });
const db = await supabase({ contract, pg: pool, jwtSecret });
// ...
await db.close();
await pool.end();

// Or let Supabase create and end the pool
const db = await supabase({ contract, url: connectionString, jwtSecret });
```

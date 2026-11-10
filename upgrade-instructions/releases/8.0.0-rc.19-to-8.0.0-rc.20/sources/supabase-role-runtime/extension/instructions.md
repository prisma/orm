---
changes:
  - id: supabase-for-role-replaces-with-role-methods
    summary: |
      `SupabaseRuntime` no longer has `queryWithRole`, `executeWithRole`, `preparedQueryWithRole` or `preparedExecuteWithRole`, and `SupabaseRuntimeImpl` no longer has `roleActivitySource`. Call `runtime.forRole(binding)` once and use its members: `runtime.queryWithRole(plan, binding, options)` becomes `runtime.forRole(binding).query(plan, options)`, `executeWithRole` becomes `forRole(binding).execute`, a prepared statement runs on the role with `statement.query(runtime.forRole(binding), params)` or `statement.execute(runtime.forRole(binding), params)`, and the role's activity source is the `activitySource` member of `forRole(binding)`. The detection matches files that call one of the removed methods.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.(?:queryWithRole|executeWithRole|preparedQueryWithRole|preparedExecuteWithRole|roleActivitySource)\('
  - id: raw-connection-obeys-close
    summary: |
      `SqlRuntimeBase.acquireRawConnection()` now follows the close rule of `connection()`: once the runtime starts refusing new work it rejects with `DRIVER.NOT_CONNECTED` "Runtime is closed" (at once with `closeRefusal: 'at-once'`, after the runtime has been idle for a turn of the event loop with `'when-idle'`), unless you pass `{ activityParent }` of an activity that is still open; the statements and transactions run on the connection are work `close()` waits for, and a connection held between statements is not. A transaction now counts as work from its start until its commit or rollback settles, its commit fails, or its connection is released or destroyed, so `close()` waits for an open transaction on any connection and, while it waits only for transactions still open, logs `runtime.close.waiting-for-activities` with `openTransactions`, their count; it waits for each until it commits or rolls back. A subclass that shares its driver with another runtime builds each runtime with the new `ownsDriver: false` option, closes them all, then closes the driver once. The detection matches files that call `acquireRawConnection`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])acquireRawConnection\('
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

// After
const rows = await runtime.forRole({ role: 'anon' }).query(plan).toArray();
```

The statements and the open transactions on a raw connection keep `close()` waiting; a connection held between statements does not, so release it when you are done:

```ts
const connection = await this.acquireRawConnection({ activityParent });
try {
  await connection.execute({ sql: 'SELECT 1' });
} finally {
  await connection.release();
}
```

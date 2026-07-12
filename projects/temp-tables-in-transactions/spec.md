# Typed Temp Tables in Transactions

## Purpose

Transaction-scoped temp tables are a well-established SQL performance primitive. The core idea is to materialise an intermediate result set once into a temporary table, then join or query against it multiple times within the same transaction — instead of re-running the same subquery or CTE on every reference.

### Why temp tables matter

Without temp tables, repeating a complex filter or derived result set in multiple joins forces the query planner to re-evaluate the same expression for every reference:

```sql
-- Without temp table: the inner SELECT is executed twice
SELECT u.name FROM users u
  JOIN ( SELECT id FROM users WHERE active = true ) active ON active.id = u.id
  JOIN posts p ON p.user_id = u.id;
-- Same expensive subquery runs again in every JOIN
```

With a temp table, the result is materialised once, indexed by the engine for the transaction lifetime, and reused cheaply:

```sql
CREATE TEMP TABLE active_users AS SELECT id FROM users WHERE active = true;
-- Now both joins hit the temp table — one scan, not two executions
SELECT u.name FROM users u JOIN active_users a ON a.id = u.id ...;
SELECT u.email FROM users u JOIN active_users a ON a.id = u.id ...;
```

Concrete use cases where this matters:

- **Complex intermediate derivations** — e.g. a scored ranking or partition window that is used in multiple follow-up queries in the same business transaction.
- **Bulk import pipelines** — materialise the incoming data rows once, then run validation queries, conflict detection, and inserts all against the temp table rather than re-parsing the input multiple times. Use `from(columns)` to define the table schema and `append(rows)` to stream in the data:

  ```ts
  const staging = await tx.tempTable({ name: 'staging' }).from([
    { name: 'id',    type: 'int4' },
    { name: 'email', type: 'text' },
  ]);
  await staging.append(importedRows);       // load data
  await staging.append(moreRows);           // add more data if needed
  // … run validations, conflict checks, final INSERT …
  ```
- **Multi-step analytics** — e.g. compute an aggregated cohort once and then join it against multiple fact tables in the same transaction.
- **Avoiding CTE re-evaluation** — some query engines do not guarantee CTEs are materialised; a temp table provides the same guarantee unconditionally.

Temp tables are session/connection-scoped: they are visible for the lifetime of the connection on which they were created and do not leak to other connection-pool members. When a transaction rolls back the temp table is dropped automatically; on commit it persists until explicitly dropped or the connection closes. Explicit `drop()` or `await using` is the recommended cleanup pattern.

### Why this belongs in the runtime extension

Users reach for raw SQL or ad-hoc `executeRaw` calls the moment they need a temp table today, because there is no typed surface. This PR adds a first-class, type-safe `tempTable()` API to the transaction context of both the Postgres and SQLite runtime extensions. The typed handle the API returns is a proper join source — composable with the existing SQL builder's `innerJoin`, `leftJoin`, and `FROM` APIs — so the temp table integrates into the full query composition surface rather than forcing a context switch to raw SQL.

## At a glance

**Today** there is no typed temp-table API:

```ts
await db.transaction(async (tx) => {
  // Only option: raw SQL, no type propagation, no join-source composability
  await tx.execute({ sql: 'CREATE TEMP TABLE t AS SELECT id FROM users WHERE active', params: [] });
});
```

**After this PR:**

```ts
await db.transaction(async (tx) => {
  // SQL builder source
  const source = tx.sql.public.user.select('id', 'email').where((f, fns) => fns.eq(f.active, true));
  await using temp = await tx.tempTable({ name: 'active_users' }).as(source);

  // temp is a typed join source — Row is inferred from the select projection
  const rows = await tx.execute(
    SelectAst.from(temp.buildAst()).withProjection([...]),
  );

  // Reuse in a JOIN without re-evaluating the original subquery
  const joined = await tx.execute(
    tx.sql.public.post
      .innerJoin(temp, (f, fns) => fns.eq(f['user_id'], f['active_users']!['id']))
      .select('title')
      .build(),
  );
});
```

ORM collections are also accepted directly as sources:

```ts
const source = tx.orm.public.User.select('id', 'email').where({ active: true });
const temp = await tx.tempTable({ name: 'active_users' }).as(source);
```

## User-facing API

The transaction context exposes:

```ts
tx.tempTable(options?: string | { name?: string }): TempTableBuilder
```

The builder exposes:

```ts
as(query: TempTableQuerySource): Promise<TempTableHandle<Row>>
from(columns: TempTableColumnDef[]): Promise<TempTableHandle>
```

`as(query)` derives the table schema and initial data from a typed subquery; the returned handle is parameterised over the row shape. `from(columns)` creates an empty table with an explicitly specified column list; data is loaded afterwards via `append()`.`

`TempTableHandle<Row>` exposes:

- **Join-source shape** — the handle is a first-class join source, usable directly in `innerJoin`, `leftJoin`, and `FROM` via `temp.buildAst()`.
- `name: string` — the resolved table name (auto-generated or provided).
- `fields: Row` — the typed field metadata for all columns in the temp table.
- `append(input: TempTableAppendInput<Row>): Promise<void>` — append rows to the table after creation. Accepts either a typed query source (same protocol as `as(...)`) or raw scalar rows (`(string | number | boolean | null)[][]`). Raw-row input is not type-checked against `Row`; typed query input is. Passing an empty array is a no-op.
- `drop(): Promise<void>` — explicit cleanup.
- `[Symbol.asyncDispose](): Promise<void>` — `await using` support, mirrors `drop()`.

### Query sources accepted by `as(...)`

`as(...)` accepts any value that implements the `TempTableQuerySource` interface — an open protocol that any query DSL (including third-party packages) can implement by exposing `buildAst()` and `getRowFields()`. Both the SQL builder and the ORM collection implement this interface:

```ts
// SQL builder — implements TempTableQuerySource directly
tx.sql.public.user.select('id', 'email').where((f, fns) => fns.eq(f.active, true))

// ORM collection — also implements TempTableQuerySource
tx.orm.public.User.select('id', 'email').where({ active: true })
```

### Subquery source in detail

Both source kinds share the same underlying shape: they produce a `SELECT` AST and a typed row-field map. The SQL builder query exposes this directly; an ORM collection is normalised to it internally.

**SQL builder — column projection and filter:**

```ts
// Postgres (namespaced)
const source = tx.sql.public.user
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.email, 'alice@example.com'));

// SQLite (unbound namespace)
const source = tx.sql.users
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.email, 'alice@example.com'));

const temp = await tx.tempTable({ name: 'filtered_users' }).as(source);
```

**ORM collection — same result, different surface:**

```ts
// Postgres
const source = tx.orm.public.User.select('id', 'email').where({ email: 'alice@example.com' });

// SQLite
const source = tx.orm.User.select('id', 'email').where({ email: 'alice@example.com' });

const temp = await tx.tempTable({ name: 'filtered_users' }).as(source);
```

**Using the handle as a `FROM` source:**

The handle's `buildAst()` returns a `TableSource` pointing to the temp table by name. Use it with `SelectAst.from(...)` to compose a typed `SELECT` over the materialised rows:

```ts
const rows = await tx.execute(
  planFromAst(
    SelectAst.from(temp.buildAst()).withProjection([
      ProjectionItem.of('id',    ColumnRef.of(temp.name, 'id')),
      ProjectionItem.of('email', ColumnRef.of(temp.name, 'email')),
    ]),
    db.context.contract,
    'dsl',
  ),
);
// rows: Array<{ id: number; email: string }>
```

**Using the handle in a `JOIN`:**

The handle satisfies the SQL builder's join-source protocol. Pass it directly to `innerJoin` / `leftJoin`; the field proxy gains the temp-table namespace automatically:

```ts
// Postgres
const joinedRows = await tx.execute(
  tx.sql.public.user
    .innerJoin(temp, (f, fns) => fns.eq(f['id'], f['filtered_users']!['id']))
    .select('name', 'created_at')
    .build(),
);

// SQLite
const joinedRows = await tx.execute(
  tx.sql.users
    .innerJoin(temp, (f, fns) => fns.eq(f['id'], f['filtered_users']!['id']))
    .select('name')
    .build(),
);
```

Both FROM and JOIN can be used with the **same** handle within the same transaction — the source query is not re-evaluated.

## Name semantics

- If `name` is omitted, a collision-resistant name is generated: `pn_temp_<20 hex chars>`.
- Validation rules (allowed characters, maximum length) are defined per adapter via `AdapterProfile` so each target can enforce its own constraints. The Postgres adapter rejects names that do not satisfy `[A-Za-z_][A-Za-z0-9_]*` or exceed 63 characters (`NAMEDATALEN` limit); the SQLite adapter applies the same rules for consistency.

## Behavior

- Temp tables are session/connection-scoped. They are visible for the lifetime of the connection on which they were created and do not leak to other connection-pool members. Scoping on commit depends on the target — see **Cleanup strategy** below.
- The returned handle can be reused multiple times in the same transaction without re-executing the source query.
- `drop()` removes the temp table explicitly (early cleanup). It is safe to call more than once.
- `Symbol.asyncDispose` enables the `await using` pattern as a safer cleanup alternative to explicit `try/finally` with `drop()`.
- `include(...)` projections are not supported when an ORM collection is used as the source — only scalar column selections are translated.

## ORM collection as a query source

ORM collections implement `TempTableQuerySource` directly. The temp table API has no dependency on the ORM or the `Connection` class — it only sees the common `TempTableQuerySource` interface.

- `select(...)` on the collection limits the columns that appear in the temp table and in `handle.fields`.
- If no `select(...)` is provided, the ORM's default scalar projection is used.
- `include(...)` projections are not supported as a source; only scalar column selections are translated.
- A public, standalone `asSubquery()` API on `Collection` is **out of scope for this PR** and is tracked as a follow-up if a general ORM-to-query-source conversion primitive is needed.

## Cleanup strategy

Cleanup on commit is target-specific and is signalled via `AdapterProfile.capabilities.tempTable.onCommitDrop`.

### Postgres — `ON COMMIT DROP`

The Postgres adapter sets `capabilities.tempTable.onCommitDrop = true`. The `CREATE TEMP TABLE` statement is emitted with the `ON COMMIT DROP` clause:

```sql
CREATE TEMP TABLE active_users ON COMMIT DROP AS SELECT id, email FROM users WHERE active = TRUE;
```

Postgres drops the table automatically when the transaction commits or rolls back. No pre-commit hook is registered.

### SQLite — pre-commit `DROP TABLE`

SQLite has no `ON COMMIT DROP`. The SQLite adapter sets `capabilities.tempTable.onCommitDrop = false`. The `CREATE TEMP TABLE` statement is emitted without the clause:

```sql
CREATE TEMP TABLE active_users AS SELECT id, email FROM users WHERE active = 1;
```

When `as(...)` creates the table it registers a pre-commit hook on the `RuntimeTransaction`:

```ts
transaction.registerPreCommitHook(async () => {
  await driverTx.query(`DROP TABLE IF EXISTS "${tableName}"`);
});
```

`RuntimeTransaction.commit()` drains all registered hooks in order before issuing `COMMIT`:

```ts
async commit(): Promise<void> {
  for (const hook of preCommitHooks) {
    await hook();
  }
  await driverTx.commit();
}
```

If a hook throws, the commit is aborted and the error propagates; the caller can then call `rollback()`. On `rollback()` hooks are not invoked — SQLite discards the temp table with the transaction automatically.

`drop()` / `await using` removes the hook's table early; the hook is a no-op if the table is already gone (`DROP TABLE IF EXISTS` is idempotent).

- No `asRaw(...)` API — raw SQL strings are not accepted as a source; use the SQL builder's `raw\`...\`` tag to compose raw expressions into a structured query first.
- No temp-table alias method on the returned handle — the handle's `name` is the canonical table name and also serves as the default namespace alias in join field proxies.
- No support outside a transaction — the API is intentionally limited to transaction contexts; transactions pin execution to a single connection, which is required for session-scoped temp tables to be reachable across multiple queries. Outside a transaction, different pool members may serve sequential calls, so the temp table would not be visible between them.
- No automatic index creation — index definition on the temp table is not part of this PR.
- No cross-transaction sharing — each transaction gets its own isolated temp-table namespace.

## Open questions

1. **Explicit index support.** High-frequency patterns (e.g. joining a temp table on a non-PK column) benefit from a temp index. A follow-up `withIndex(column)` builder step is the natural extension point but is not part of this scope.
2. **Public ORM-to-query-source API.** The `asSubquery()`-style conversion is currently internal. If downstream consumers (e.g. middleware, custom lanes) need the same conversion outside of `tempTable().as(...)`, it should be extracted into a public ORM surface — tracked separately.

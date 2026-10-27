# @internal/sqlite

One-package SQLite setup for Prisma 8. Install this single package to get config, runtime, contract authoring, control-plane access, and migration helpers — no reach-ins to internal packages required.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config, contract-builder), migration (control, migration), runtime (runtime)

## Quick Start

```typescript
// prisma.config.ts
import { defineConfig } from '@internal/sqlite/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: 'path/to/app.db' },
});
```

```typescript
// prisma/contract.ts
import { defineContract } from '@internal/sqlite/contract-builder';

export default defineContract({}, ({ field, model, gen, type }) => ({
  models: {
    User: model('User', {
      fields: { id: field.column(type.sql.UuidString()).id().onCreate(gen.uuid()) },
    }),
  },
}));
```

## Exports

### `@internal/sqlite/config`

Simplified `defineConfig` that pre-wires all SQLite internals (family, target, adapter, driver, contract providers). Accepts `contract`, `db.connection`, `extensions`, and `migrations.dir`.

```typescript
import { defineConfig } from '@internal/sqlite/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: 'path/to/app.db' },
  migrations: { dir: 'migrations/app' },
});
```

### `@internal/sqlite/contract-builder`

TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, …). The `defineContract` facade pre-binds `family` and `target` — callers do not pass those fields.

```typescript
import { defineContract } from '@internal/sqlite/contract-builder';

export default defineContract({}, ({ field, model, gen, type }) => ({
  models: {
    User: model('User', {
      fields: { id: field.column(type.sql.UuidString()).id().onCreate(gen.uuid()) },
    }),
  },
}));
```

The entry also exports `field`, `type` and `gen`, the same helpers the callback receives, for code outside a contract, such as the fields of a query fragment: `field.column(type.sql.UuidString()).id().onCreate(gen.uuid())`.

### `@internal/sqlite/control`

Control-plane client factory. Collapses the family + target + adapter + driver wiring into a single call.

```typescript
import { createSqliteControlClient } from '@internal/sqlite/control';
import contract from './src/prisma/contract.json' with { type: 'json' };

const control = createSqliteControlClient({
  connection: 'path/to/app.db',
});
await control.dbUpdate({
  contract,
  mode: 'apply',
  migrationsDir: 'migrations',
  // Where the commands an error's advice prints are run from, and the --config and --db they repeat.
  invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
  answerQuestions: async (questions) => {
    if (questions.length > 0) throw new Error('db update would lose data or widen access');
    return [];
  },
});
```

### `@internal/sqlite/migration`

Re-exports all migration operation helpers from `@internal/target-sqlite/migration` (`Migration`, `MigrationCLI`, `col`, `lit`, `fn`, `primaryKey`, `foreignKey`, `unique`, `addColumn`, `dropTable`, `createIndex`, `dropIndex`, `dropColumn`, `recreateTable`, `dataTransform`, `placeholder`, `rawSql`). `createTable` is no longer a free export — it is a protected method on `Migration`; call it as `this.createTable({...})` inside `get operations()`.

### `@internal/sqlite/runtime`

Composes the SQLite execution stack and returns typed query roots (`db.sql`, `db.raw`, `db.orm`, `db.query(plan)`, `db.execute(plan)`, `db.toSql(plan)`, `db.context`, `db.stack`). Creating a client has no side effects; the database opens on the first query, `db.runtime()` or `db.connect(...)`.

Pass `collections` to give models custom collection classes: `sqlite({ contract, path, collections: { Post: PostCollection } })`, where `PostCollection` extends `Collection<Contract, 'Post'>` from `@prisma/orm-sqlite/orm-client`. `db.orm.Post`, and the ORM inside `db.transaction(...)`, then return a `PostCollection`. The client's type carries the classes as its second type parameter, which defaults to no classes.

Pass `log` (an object with `info`, `warn`, `error` and an optional `debug` method, each taking one event object; `console` works, and the type is `Log` from `@prisma/orm-sqlite/family-runtime`) to receive what the runtime logs: the marker-verification warnings `CONTRACT.MARKER_MISSING` and `CONTRACT.MARKER_MISMATCH` from the first query, the warnings `lints()` emits for rules whose severity is `warn`, and the errors a middleware's `activityEnded` or `activityFinalized` hook throws, which the runtime logs and swallows. It also receives the warning `runtime.close.waiting-for-activities` when `close()` is waiting only for activities whose handles were never ended or for transactions still open, with the counts `openActivities` and `openTransactions`; `close()` waits for each such transaction until it commits or rolls back, and the error `runtime.connection.release.error` when the connection taken for an activity's own transaction fails to release after the transaction settles. If `log` has a `debug` method, it also receives debug events, for example when a middleware intercepts a statement. `budgets()` violations reach `log` only in `mode: 'permissive'` (see *Running plans and rendering SQL*). Without `log`, the runtime drops these events.

`db.orm` offers `fragment` beside the models, unless a model is named `fragment`. A fragment is a reusable query step:

```ts
const titled = db.orm.fragment({ title: { codecId: 'sqlite/text@1', nullable: false } }, (rows) =>
  rows.where((r) => r.title.eq('Hello')),
);
await db.orm.Post.with(titled).all();
```

### Running plans and rendering SQL

`db.query(plan)` runs a plan from `db.sql`, `db.raw` or the ORM and returns its rows as an `AsyncIterableResult`; `await` it for an array. `db.execute(plan)` runs a plan and resolves its statistics, `{ affectedRows }`, with no rows. Both have the types `tx.query` and `tx.execute` have inside `db.transaction(...)`. For an ORM plan such as `db.orm.Post.where({ title: 'Hello' }).prepared.all().plan`, `db.query` yields the database rows, not the result the ORM builds from them.

`db.toSql(plan)` returns the SQL and parameters the plan would run, `{ sql, params }`, with no database. `params` are the values the plan holds, before codecs encode them for the driver. Middleware rewrites (`beforeCompile`) are not applied, because they belong to running a query. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would. `sqliteStatic()` has `toSql` too.

```ts
const plan = db.sql.posts.select('id', 'title').limit(10).build();
console.log(db.toSql(plan));
for await (const row of db.query(plan)) console.log(row);
await db.execute(db.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
```

`mode` is `'strict'` by default, and every `budgets()` violation throws. Pass `mode: 'permissive'` and a violation whose severity is `'warn'` goes to `log.warn` instead, and the query runs; a violation whose severity is `'error'` still throws. `budgets()` gives latency `'warn'` and the row count `'error'` by default, so a row-count limit warns only with `severities: { rowCount: 'warn' }`.

### Transactions

`db.transaction(async (tx) => ...)` commits when the callback returns and rolls back when it throws. `tx` offers the client's query members, with the same types: `sql`, `orm` (with the client's custom collection classes and `fragment`), `raw`, `prepare`, `query`, `execute`, `toSql` and `enums`. Every statement they send runs inside the transaction. `tx` has no `close`, `[Symbol.asyncDispose]`, `transaction` or `runtime()`. The type is `SqliteTransactionContext<Contract>`.

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
  const byId = await tx.prepare({ id: 'sqlite/integer@1' }, (params) =>
    tx.sql.posts.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
  );
  await byId.query(tx, { id: 1 });
});
```

### Prepared SQL and ORM rows

Use `db.prepare(declaration, params => ...)` to prepare SQL queries, ORM row reads or ORM aggregates once and execute them with different parameter values.

```ts
const byId = await db.prepare({ id: 'sqlite/integer@1' }, (params) =>
  db.sql.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
const all = await db.prepare({}, () => db.orm.User.select('id').prepared.all());
const first = await db.prepare({}, () => db.orm.User.select('id').prepared.first());

for await (const row of all.query(db.runtime(), {})) console.log(row.id);
const rowOrNull = await first.query(db.runtime(), {});
const sqlRows = await byId.query(db.runtime(), { id: 1 });
```

Pass a compatible runtime, connection or transaction explicitly to `query(target, params, options?)`. A prepared statement runs on what it is given, wherever it was prepared: `ps.query(tx, params)` inside `db.transaction(async (tx) => ...)` runs inside the transaction. Preparing sends nothing to the database. ORM `all` returns a thenable async row stream; `first` returns a row-or-null promise; `firstOrThrow` returns a row promise that rejects with `RUNTIME.NO_ROWS` when no row matches. For descriptions built with `.prepared.aggregate(selector, configure?)`, `query` returns an aggregate object promise on ungrouped collections (`Promise<AggregateResult<Spec>>`), or an array promise after `groupBy(...)` (`Promise<Array<GroupKeys & AggregateResult<Spec>>>`). See the [ORM composition reference](../../../3-extensions/sql-orm-client/README.md#prepared-row-descriptions) for aggregate examples, HAVING, supported predicates, includes and pagination. Native SQLite database `prepare(sql)` is a separate API.

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

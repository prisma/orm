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
import { defineContract, field, model } from '@internal/sqlite/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.id.uuidv4String() } }),
  },
});
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
import { defineContract, field, model } from '@internal/sqlite/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.id.uuidv4String() } }),
  },
});
```

### `@internal/sqlite/control`

Control-plane client factory. Collapses the family + target + adapter + driver wiring into a single call.

```typescript
import { createSqliteControlClient } from '@internal/sqlite/control';

const control = createSqliteControlClient({
  connection: 'path/to/app.db',
});
await control.dbUpdate({ migrations: { dir: 'migrations/app' } });
```

### `@internal/sqlite/migration`

Re-exports all migration operation helpers from `@internal/target-sqlite/migration` (`Migration`, `MigrationCLI`, `col`, `lit`, `fn`, `primaryKey`, `foreignKey`, `unique`, `addColumn`, `dropTable`, `createIndex`, `dropIndex`, `dropColumn`, `recreateTable`, `dataTransform`, `placeholder`, `rawSql`). `createTable` is no longer a free export — it is a protected method on `Migration`; call it as `this.createTable({...})` inside `get operations()`.

### `@internal/sqlite/runtime`

Composes the SQLite execution stack and returns typed query roots (`db.sql`, `db.orm`, `db.context`, `db.stack`).

### Prepared SQL and ORM rows

`db.prepare(declaration, params => ...)` captures `db.sql` or `db.orm` lexically. The callback receives only declared placeholder expressions, runs once, and lowers SQL once without executing an ORM terminal.

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

`query(target, params, options?)` names a compatible runtime, connection or transaction explicitly. ORM `all` returns a thenable async row stream directly; `first` returns a row-or-null promise. SQL plans preserve `PreparedFor`: raw affected-count plans expose `execute(target, params, options?)`, while a row field named `affectedRows` still produces a row-query handle. Declarations retain the contract's codec input types; runtime rejects unused names.

ORM predicates accept non-nullable scalar placeholders: `db.prepare({ id: 'sqlite/integer@1' }, p => db.orm.User.where({ id: p.id }).select('id').prepared.all())`. Callback comparisons, relation/include predicates, `prepared.first` filters and fixed lists of individual placeholders are also supported. Nullable prepared parameters in structured ORM comparisons reject before execution; literal-null filters and nullable columns compared with non-nullable parameters remain supported. Raw SQL is opaque, including nullable interpolations, and retains SQL semantics.

Root and nested ORM `limit`/`offset` accept non-nullable numeric placeholders, including distinct and scalar/combine include refinements. `prepared.first()` replaces an earlier limit with `1`; declarations used only by that limit are rejected as unreferenced. Dynamic parameter lists, aggregate/mutation terminals and custom helper preparation are not supported. Projection, includes and model mapping use ordinary ORM processing, including existing include buffering. See the [ORM composition reference](../sql-orm-client/README.md#prepared-row-descriptions). Native SQLite database `prepare(sql)` is a separate API.

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

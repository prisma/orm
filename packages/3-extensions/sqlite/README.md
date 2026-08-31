# @internal/sqlite

One-package SQLite setup for Prisma Next. Install this single package to get config, runtime, contract authoring, control-plane access, and migration helpers — no reach-ins to internal packages required.

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

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

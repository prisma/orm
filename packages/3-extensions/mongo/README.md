# @internal/mongo

One-package MongoDB setup for Prisma Next. Install this single package to get config, runtime, contract authoring, control-plane access, and BSON value constructors — no reach-ins to internal packages required.

> **Breaking change:** the top-level `@internal/mongo` barrel (`import { ObjectId } from '@internal/mongo'`) has been removed. Move BSON constructor imports to `@internal/mongo/bson`:
>
> ```diff
> - import { ObjectId } from '@internal/mongo';
> + import { ObjectId } from '@internal/mongo/bson';
> ```

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config, contract-builder, bson, family, target), migration (control), runtime (runtime)

## Quick Start

```typescript
// prisma.config.ts
import { defineConfig } from '@internal/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
});
```

```typescript
// prisma/contract.ts
import { defineContract, field, model } from '@internal/mongo/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
```

## Exports

### `@internal/mongo/config`

Simplified `defineConfig` that pre-wires all MongoDB internals (family, target, adapter, driver, contract providers). Accepts `contract`, `db`, `extensions`, and `migrations.dir`.

```typescript
import { defineConfig } from '@internal/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
  migrations: { dir: 'migrations/app' },
});
```

### `@internal/mongo/contract-builder`

TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, `index`, `valueObject`, …). The `defineContract` facade pre-binds `family` and `target` — callers do not pass those fields.

```typescript
import { defineContract, field, model } from '@internal/mongo/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
```

### `@internal/mongo/control`

Control-plane client factory. Collapses the family + target + adapter + driver wiring into a single call.

```typescript
import { createMongoControlClient } from '@internal/mongo/control';

const control = createMongoControlClient({
  connection: process.env['MONGODB_URL']!,
});
await control.dbUpdate({ migrations: { dir: 'migrations/app' } });
```

### `@internal/mongo/bson`

BSON value constructors for use in seed scripts, fixtures, and tests.

```typescript
import { ObjectId } from '@internal/mongo/bson';

const id = new ObjectId();
```

Exports: `Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`, `Timestamp`.

### `@internal/mongo/runtime`

Re-exports `createMongoRuntime` from `@internal/mongo-runtime` for composing the MongoDB execution pipeline.

### `@internal/mongo/family`

Re-exports the MongoDB family pack (only needed when using the low-level API; `defineContract` pre-binds this for you).

### `@internal/mongo/target`

Re-exports the MongoDB target pack (only needed when using the low-level API; `defineContract` pre-binds this for you).

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

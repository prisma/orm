# @internal/mongo

One-package MongoDB setup for Prisma 8. Install this single package to get config, runtime, contract authoring, control-plane access, and BSON value constructors — no reach-ins to internal packages required.

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

Simplified `defineConfig` that pre-wires all MongoDB internals (family, target, adapter, driver, contract providers). Pass a contract path (`.prisma` or `.ts`) or a ready `ContractConfig`, and optional `db`, `extensions`, and `migrations.dir`.

```typescript
import { defineConfig } from '@internal/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
  migrations: { dir: 'migrations/app' },
});
```

#### `prisma6Schema(path)`: adopt a Prisma 6 MongoDB schema during the transition

`prisma6Schema` reads a Prisma 6 MongoDB `schema.prisma` as the contract source, so a project that still runs Prisma 6 can adopt Prisma 8 without a second schema file. It accepts one file or a directory of `.prisma` files (every file under it, nested directories included, as Prisma 6 reads a schema directory). `contract emit` writes `contract.json` and `contract.d.ts` into the directory that holds the schema file or the schema directory: `prisma6Schema('prisma/schema.prisma')` and `prisma6Schema('prisma/schema')` both write `prisma/contract.json` and `prisma/contract.d.ts`. The `output` directory on `defineConfig` overrides that, as for every other source.

```typescript
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma6Schema } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma6Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma/config` is the published `prisma` package re-exporting `definePrismaConfig` from `@prisma/cli-engine`. Contributors working inside this repository import it from `@prisma/cli-engine` directly and the facade from `@internal/mongo/config`; the forms are the same functions.

What the project needs around that file:

- A `package.json` that depends on `@prisma/orm-mongo` and `prisma` (the Prisma 8 CLI, which also provides `prisma/config`). `contract emit` reads the nearest manifest to decide which package names `contract.d.ts` imports.
- `db.connection` is the database URL Prisma 6 reads from its `datasource` block, usually the same `DATABASE_URL` variable. The schema keeps `url` in the `datasource` block as Prisma 6 wants it; this source reads only `provider`, which must be `"mongodb"`.
- The schema uses only what Prisma 8 supports on MongoDB. A construct it does not support (a composite `@@id`, a list relation, a `@default` other than `now()` on a `DateTime`, a referential action, a `view`, and so on) fails `contract emit` with one `PSL.PRISMA6_MONGO_*` diagnostic per construct and writes nothing. The codes are listed in the [error reference](../../../docs/reference/error-reference.md).

The contract carries no `$jsonSchema` validators, because a Prisma 6 database has none. Indexes are matched by keys and options, not by name, so the names Prisma 6 gives them (`Post_authorId_idx`, `User_email_key`) need no change.

During the transition Prisma 6 keeps owning the database: `prisma db push` on Prisma 6 creates collections and indexes. Prisma 8 reads the schema and verifies it against what Prisma 6 built; it does not migrate. After every schema change on Prisma 6, run `prisma contract emit` and then `prisma db sign` so the recorded contract matches the database again; `prisma db verify` reports nothing when they match.

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

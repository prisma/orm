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

`prisma contract format` treats this source as PSL: when `prisma6Schema` names one file, the command rewrites that file in place with the Prisma 8 formatter. To keep Prisma 6's own formatting, do not run `prisma contract format`; format the schema with Prisma 6's `prisma format` instead.

```typescript
// prisma.config.ts
import 'dotenv/config';
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma6Schema } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma6Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma/config` is the published `prisma` package re-exporting `definePrismaConfig` from `@prisma/cli-engine`. Contributors working inside this repository import it from `@prisma/cli-engine` directly and the facade from `@internal/mongo/config`; the forms are the same functions. The Prisma 8 CLI does not load `.env` by itself, hence the `dotenv/config` import.

What the project needs around that file:

- `db.connection` is the database URL Prisma 6 reads from its `datasource` block, usually the same `DATABASE_URL` variable. The schema keeps `url` in the `datasource` block as Prisma 6 wants it; this source reads only `provider`, which must be `"mongodb"`.
- The schema uses only what Prisma 8 supports on MongoDB. A construct it does not support (a composite `@@id`, a list relation, a `@default` other than `now()` on a `DateTime`, a referential action, a `view`, and so on) fails `contract emit` with one `PSL.PRISMA6_MONGO_*` diagnostic per construct and writes nothing. Each diagnostic says what its fix does to the running Prisma 6 app. The codes are listed in the [error reference](../../../docs/reference/error-reference.md).
- Both CLIs installed side by side, as the next section describes. `contract emit` reads the nearest `package.json` to decide which package names `contract.d.ts` imports.

The contract carries no `$jsonSchema` validators, because a Prisma 6 database has none. Indexes are matched by keys and options, not by name, so the names Prisma 6 gives them (`Post_authorId_idx`, `User_email_key`) need no change.

##### Running the Prisma 6 and Prisma 8 CLIs in one project

Both CLIs are published as `prisma`, so one package name cannot resolve to both. Keep Prisma 8 as `prisma` (`prisma.config.ts` imports its `prisma/config`) and install the Prisma 6 CLI under an npm alias, `prisma6`, at the version of your `@prisma/client` (6.19.3 here):

```sh
pnpm add @prisma/orm-mongo@latest dotenv mongodb
pnpm add -D prisma@latest prisma6@npm:prisma@6.19.3
```

Then add a script that runs the aliased Prisma 6 CLI:

```json
{
  "scripts": {
    "prisma6": "node node_modules/prisma6/build/index.js --config prisma6.config.ts"
  }
}
```

```typescript
// prisma6.config.ts, read by the Prisma 6 CLI only
import 'dotenv/config';
import { defineConfig } from 'prisma6/config';

export default defineConfig({ schema: 'prisma/schema.prisma' });
```

- The alias installs no `prisma6` binary: the package's binary is still called `prisma`, and `node_modules/.bin/prisma` is the Prisma 8 CLI. Run Prisma 6 through the `prisma6` script instead (`pnpm prisma6 db push`, `npm run prisma6 -- db push`), and change every existing script that runs a Prisma 6 command (`prisma generate`, `prisma db push`) to use it.
- The Prisma 6 CLI reads `prisma.config.ts` whenever that file exists, and it is now Prisma 8's, so the script passes `--config prisma6.config.ts`. A project that already has a Prisma 6 `prisma.config.ts` renames it to `prisma6.config.ts` and imports `defineConfig` from `prisma6/config` in it.
- With a config file, neither CLI loads `.env` by itself, so both config files import `dotenv/config`.
- `@prisma/client` stays at the Prisma 6 CLI's version, and `prisma6 generate` generates it as before.
- `mongodb` 7 is a peer dependency of `@prisma/orm-mongo`. Declare it: a package manager does not always add it for you (pnpm leaves it out when another package asks for a different major).
- pnpm 10 runs no dependency install scripts until you approve them. Run `pnpm approve-builds` and approve `prisma`, `@prisma/engines` and `@prisma/client`: their scripts download the Prisma 6 engines and generate the Prisma 6 client.
- `prisma orm init` in a Prisma 6 MongoDB project prints these steps instead of scaffolding (`CLI.INIT_PRISMA6_SCHEMA_FOUND`).

This setup was run with pnpm 10.27 and Prisma 6.19.3 against a MongoDB replica set: `prisma6 db push` and `prisma6 generate`, a write through the generated Prisma 6 client, then `prisma contract emit`, `prisma db sign` and `prisma db verify`.

##### Keeping Prisma 8 in step with Prisma 6

During the transition Prisma 6 keeps owning the database: Prisma 6's `db push` creates collections and indexes. Prisma 8 reads the schema and verifies it against what Prisma 6 built; it does not migrate. After every schema change, run Prisma 6's `db push` (`pnpm prisma6 db push`), then `prisma contract emit` and `prisma db sign`, so the recorded contract matches the database again; `prisma db verify` reports nothing when they match. When `db verify` or `db sign` finds the database behind the contract, apply the change with Prisma 6's `db push` rather than the `prisma db update` the CLI suggests, then sign again.

`db sign` also records the signed contract in the project, as it does in every Prisma 8 project: it writes `migrations/app/refs/db.json` (the `db` ref, set to the signed contract's hash) and a snapshot of the contract under `migrations/snapshots/<hash>/` (`contract.json` and `contract.d.ts`). These are what Prisma 8 migrations plan from once the project moves off Prisma 6, so commit them. A project, or a CI or deployment step, that only reads the Prisma 6 schema can pass `--no-advance-ref`, which signs the database without writing either.

##### What changes for Prisma 6 application code

Code that moves from the Prisma 6 client to the Prisma 8 client reads the same documents with these differences:

- **The id is `_id`.** `id String @id @default(auto()) @map("_id") @db.ObjectId` is the field `_id` in Prisma 8 (a hex string, as in Prisma 6), not `id`.
- **Models are reached by collection name.** `model User { @@map("users") }` is `db.orm.users`, where Prisma 6 has `prisma.user`.
- **Enum values are the stored values.** A member with `@map` is read and written as its stored value: `ADMIN @map("admin")` is `'admin'` in Prisma 8, where the Prisma 6 client exposes `'ADMIN'`.
- **Optional fields.** An optional field is typed `T | null`. Prisma 6 leaves an unset optional field out of the document, so a document it wrote can read with the field absent rather than `null`; test for it with `== null`, which covers both.
- **`Bytes` is a `Uint8Array`**, as in Prisma 6. Write a `Uint8Array`, not a driver `Binary`.
- **`BigInt` is a `bigint`**, as in Prisma 6, with no precision lost above 2^53.
- **`Int` stays a `number`.** Prisma 6 stores a plain `Int` (and `Int @db.Long`) as a BSON long and presents it as a `number`. Prisma 8 does the same through the `Int64Number` type (`mongo/int64Number@1`): it reads a stored long as a `number` and writes a `number` back as a long. A value outside ±(2^53 − 1), or a stored fractional number, fails with `RUNTIME.DECODE_FAILED` or `RUNTIME.ENCODE_FAILED` instead of being rounded. `Int @db.Int` is a BSON int (`Int32`), also a `number`.
- **Native types are read as what they store.** Every native type Prisma 6 accepts on MongoDB gives the field the codec for the BSON type Prisma 6 stores, and most of them store what the plain field stores (`@db.String`, `@db.Bool`, `@db.Double`, `@db.Date`, `@db.BinData`, `@db.Json`, `@db.Long` on `BigInt`). `DateTime @db.Timestamp` is refused: Prisma 8 has no codec for a BSON timestamp.
- **`Bytes @db.ObjectId` is a hex string.** The field holds an ObjectId, so Prisma 8 reads it as its 24-digit hex string and takes only a hex string (or an ObjectId) when writing it; a 12-byte `Buffer` or `Uint8Array`, which the Prisma 6 client uses, is refused. Convert at the boundary: `Buffer.from(hex, 'hex')` turns the hex string into the 12 bytes, and `bytes.toString('hex')` (or `Buffer.from(bytes).toString('hex')` for a `Uint8Array`) turns the bytes into the hex string.
- **`Decimal` is a `string`** in Prisma 8, the decimal's text such as `"12.50"`. Prisma 6 refuses `Decimal` on MongoDB, so a schema Prisma 6 accepts has no `Decimal` field.
- **`Json` holds JSON values only.** A `Json` value that contains a BSON type JSON cannot represent (a date, an ObjectId, a long above 2^53, and so on), written by other code or by an older Prisma, fails to read in Prisma 8 with `RUNTIME.DECODE_FAILED`.

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

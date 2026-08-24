# Welcome to Prisma Next!

Prisma Next lets you query your database in simple, easy-to-read TypeScript. Define what your data looks like, and Prisma Next gives you a fully typed client — with autocomplete for every collection, field, and relation.

This project is set up for MongoDB. Prisma Next also supports other databases.

{{requirements}}

## Your data contract

Your data contract is the heart of your application. It lives at [`{{schemaPath}}`]({{schemaPath}}) and describes your models:

{{schemaSample}}

Every model you define in your contract can be queried from your app. Your editor will autocomplete the query methods and show you what type each field is:

```typescript
import { db } from '{{dbImportPath}}';

const user = await db.orm.users
  .where({ email: 'alice@example.com' })
  .first();

// Your editor will show the type of user as
// { _id: ObjectId; email: string; username: string | null; name: string | null; posts: Post[] } | null
```

`db` connects to MongoDB lazily on the first query, so there is no manual `connect(...)` step in your application code. Call `await db.close()` if you need to release the underlying connection (typically only in tests or short-lived scripts). After `close()` the client is single-shot — any further query, `connect()`, or `runtime()` call rejects with `"Mongo client is closed"`. Construct a new `mongo({...})` if you need to use it again.

Your contract has two companion files in the same directory:

- **`contract.json`** — this tells your application what models exist, just like `package-lock.json` tells your package manager what dependencies your project has
- **`contract.d.ts`** — this powers autocomplete and type checking in your editor

Commit both files to git. When you change your contract, run `{{pkgRun}} contract emit` to update them.

If you use a framework like Next.js or Vite, the Prisma Next plugin will do this for you automatically.

## Configuration

[`prisma.config.ts`](prisma.config.ts) tells the CLI where your contract lives and how to connect to your database. It loads environment variables from `.env` automatically:

```typescript
import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '{{configEntrypoint}}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './{{schemaPath}}',
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
```

Notice the `DATABASE_URL` above? It's defined in your [`.env`](./.env) file:

```env
DATABASE_URL="mongodb://localhost:27017/mydb"
```

You can customize how your environment variables are loaded by changing or removing the `import 'dotenv/config'` line.

## Quick reference

### Commands

```bash
{{pkgRun}} contract emit       # Update contract.json and contract.d.ts
{{pkgRun}} db init             # Create collections in the database
{{pkgRun}} migration status    # Show migration status
```

### Files

| File | Purpose |
|---|---|
| [`{{schemaPath}}`]({{schemaPath}}) | Your data contract — define your models here |
| [`prisma.config.ts`](prisma.config.ts) | CLI configuration |
| [`{{schemaDir}}/db.ts`]({{schemaDir}}/db.ts) | Database client — `import { db } from '{{dbImportPath}}'` |
| `{{schemaDir}}/contract.json` | Compiled contract (generated) |
| `{{schemaDir}}/contract.d.ts` | Contract types (generated) |

### Workflow

1. Edit [`{{schemaPath}}`]({{schemaPath}}) to add or change models.
2. Run `{{pkgRun}} contract emit` to regenerate the contract.
3. Query your models — your IDE will autocomplete everything.

## Transactions and change streams (Mongo)

Multi-document transactions and change streams require MongoDB to run as a **replica set** — even single-node setups for development. A standalone `mongod` will reject `withTransaction()` at runtime. For local development you have a few options:

- **Docker Compose:** start `mongo` with `--replSet rs0` and run `rs.initiate()` once.
- **`mongodb-memory-server`:** use `MongoMemoryReplSet` instead of `MongoMemoryServer` in tests.
- **MongoDB Atlas:** every Atlas cluster is already a replica set.

The transaction API (`db.transaction(...)`) is on the roadmap and tracked under [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams). Prisma Next's Mongo facade does not expose it yet — until that ticket lands, drive transactions yourself with a raw `MongoClient` using the escape hatch in the next section.

## Escape hatches

The ORM covers the common cases. For the rest, two escape hatches are designed in:

- **Typed raw aggregations — `db.query`.** The facade exposes `db.query`, a typed builder for aggregation pipelines that runs through the same runtime + middleware + codec stack as `db.orm`. Reach for it when the ORM can't express a `$lookup`/`$facet`/`$graphLookup`/window-function pipeline.
- **Direct `mongodb` driver control — `mongoClient` binding.** Construct your own `MongoClient` and pass it to `mongo({ mongoClient, dbName, contractJson })`. Your code keeps the `MongoClient` reference and uses it directly (transactions, change streams, sessions, anything Prisma Next doesn't surface yet); the same `db` object continues to give you the typed ORM.

`db.runtime()` is **not** the escape hatch — it returns the internal executor (`MongoRuntime`), not a `mongodb` `MongoClient` or `Db`. Use `db.query` for raw aggregations and the `mongoClient` binding for direct driver control.

## Monorepo notes (pnpm workspaces)

If this project lives inside a pnpm workspace, a few things are worth knowing:

- **Catalogs.** When the workspace's `pnpm-workspace.yaml` defines a `catalogs` entry for `prisma` or `{{pkg}}`, pnpm uses the catalog version everywhere — `init` does too. If you wanted the published `latest` instead, update or remove the catalog entry, then re-run `pnpm install`.
- **`pnpm dlx`.** `pnpm dlx prisma@next orm init …` works in any directory. Inside a workspace, pnpm still resolves dependencies through the workspace's catalog/overrides rather than the registry; expect the installed Prisma Next packages to reflect the workspace's catalog rather than `latest`.
- **`pnpm` → `npm` fallback.** If `pnpm` ever fails to install Prisma Next with a `workspace:*` or `catalog:` resolution error (a leak in a published artefact), `init` falls back to `npm install` and surfaces a warning. Once the offending package republishes a clean version you can switch back with `pnpm install`.

# @internal/postgres

One-package Postgres setup for Prisma Next. Install this single package to get config, runtime, and all transitive type dependencies.

Two runtime facades ship under different entrypoints:

- `@internal/postgres/runtime` — long-lived Node process facade with closure-cached `runtime()`, `orm`, and `transaction()`.
- `@internal/postgres/serverless` — per-request facade for serverless / edge runtimes (Cloudflare Workers + Hyperdrive, AWS Lambda, Vercel, Deno Deploy, Bun edge). Each `connect()` returns a fresh `Runtime & AsyncDisposable`.

Pick the facade that matches your deployment lifecycle. The asymmetry is intentional: closure caching is unsafe across `fetch` invocations (stale connections after isolate idle, concurrent-query races, no clean shutdown), so the serverless facade deliberately omits `orm`, `runtime()`, and `transaction()`. See `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` and the deployment guide for the rationale.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config), runtime (runtime, serverless)

## Quick Start

```typescript
// prisma.config.ts
import { defineConfig } from '@internal/postgres/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['DATABASE_URL']! },
});
```

### Node (long-lived process)

```typescript
// db.ts
import postgres from '@internal/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
```

### Serverless / per-request runtimes

```typescript
// db.ts — module scope: only the static authoring surface is built here.
import postgresServerless from '@internal/postgres/serverless';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgresServerless<Contract>({ contractJson });

// worker.ts — per-request: acquire a fresh Runtime, dispose with `await using`.
export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
    const rows = await runtime.query(db.sql.from(/* ... */).build());
    return Response.json(rows);
  },
};
```

The returned client exposes `sql`, `context`, `stack`, `contract`, and `connect()` — and intentionally nothing else. Construct ORM clients (or invoke `withTransaction` from `@internal/sql-runtime`) against the runtime returned by `connect()` instead of caching one on the closure.

## Exports

### `@internal/postgres/config`

Simplified `defineConfig` that pre-wires all Postgres internals (family, target, adapter, driver, contract providers). Pass a contract path and optional db/migrations/extensions config.

### `@internal/postgres/runtime`

`@internal/postgres/runtime` exposes a single `postgres(...)` helper that composes the Postgres execution stack and returns query/runtime roots:

- `db.sql`
- `db.orm`
- `db.context`
- `db.stack`

Runtime resources are deferred until `db.runtime()` or `db.connect(...)` is called.
Connection binding can be provided up front (`url`, `pg`, `binding`) or deferred via `db.connect(...)`.

When URL binding is used, pool timeouts are configurable via `poolOptions`:

- `poolOptions.connectionTimeoutMillis` (default `20_000`)
- `poolOptions.idleTimeoutMillis` (default `30_000`)

### `@internal/postgres/contract-builder`

Re-exports the TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, ...) so a generated `prisma/contract.ts` can author its contract using only this facade package. The `defineContract` export is a Postgres-specific wrapper that pre-binds `family` and `target` — callers do not pass those fields:

```typescript
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract(
  { extensions: {} },
  ({ field: f, model: m }) => ({
    models: {
      User: m('User', { fields: { id: f.id.uuidv4String() } }),
    },
  }),
);
```

### `@internal/postgres/migration`

Re-exports everything from `@internal/target-postgres/migration` so a user-authored `migration.ts` file can import its base class, CLI runner, and operation helpers from the single Postgres facade:

```typescript
import { Migration, MigrationCLI, addColumn, createTable } from '@internal/postgres/migration';

export default class M extends Migration {
  up() {
    return [createTable('users', ...)];
  }
}
MigrationCLI.run(import.meta.url, M);
```

### `@internal/postgres/family`

Re-exports the SQL family pack (the value passed as `family:` to `defineContract`).

### `@internal/postgres/target`

Re-exports the Postgres target pack (the value passed as `target:` to `defineContract`).

### `@internal/postgres/serverless`

`@internal/postgres/serverless` exposes `postgresServerless(...)` for per-request runtimes. The returned client exposes only:

- `db.sql`
- `db.context`
- `db.stack`
- `db.contract`
- `db.connect({ url })` — returns `Promise<Runtime & AsyncDisposable>`

Each `connect()` call constructs a fresh `pg.Client` and a fresh `Runtime`. No `pg.Pool` is allocated. `[Symbol.asyncDispose]` calls `runtime.close()`, which closes the underlying client. `pg-cursor` is enabled by default; opt out via `cursor: { disabled: true }`.

## Responsibilities

- Build a static Postgres execution stack from target, adapter, and driver descriptors
- Build a typed SQL authoring surface from the execution context
- Build a static ORM root from the execution context
- Normalize runtime binding input (`binding`, `url`, `pg`)
- Lazily instantiate runtime resources on first `db.runtime()` or `db.connect(...)` call
- Connect the internal Postgres driver through `db.connect(...)` or from initial binding options
- Memoize runtime so repeated `db.runtime()` calls return one instance

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[postgres(...)]
    Client --> Static[Roots: sql orm context stack]
    Client --> Lazy[runtime()]

    Lazy --> Instantiate[instantiateExecutionStack]
    Lazy --> Bind[Resolve binding: url or pg]
    Bind --> Pool[pg.Pool for url binding]
    Bind --> Reuse[Reuse Pool or Client for pg binding]
    Lazy --> Runtime[createRuntime]

    Runtime --> Target[@internal/target-postgres]
    Runtime --> Adapter[@internal/adapter-postgres]
    Runtime --> Driver[@internal/driver-postgres]
    Runtime --> SqlRuntime[@internal/sql-runtime]
    Runtime --> ExecPlane[@internal/framework-components/execution]
```

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

# @internal/postgres

One-package Postgres setup for Prisma 8. Install this single package to get config, runtime, and all transitive type dependencies.

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
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.prisma',
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

The default export must be the value `definePrismaConfig` returns, with the ORM settings nested under `orm`; the CLI rejects a bare `defineConfig` result with `CONFIG.VERSION_MARKER_MISSING`. (Inside this repository the same two imports are `@prisma/cli-engine` and `@internal/postgres/config`; see the contributor note under `prisma7Schema` below.)

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

Simplified `defineConfig` that pre-wires all Postgres internals (family, target, adapter, driver, contract providers). Pass a contract path (`.prisma` or `.ts`) or a ready `ContractConfig`, and optional db/migrations/extensions config.

#### `prisma7Schema(path, options?)`: adopt a Prisma 7 schema during the transition

`prisma7Schema` reads a Prisma 7 `schema.prisma` as the contract source, so a project that still runs Prisma 7 can adopt Prisma 8 without a second schema file. It accepts one file or a directory of `.prisma` files (every file under it, nested directories included, as Prisma 7 reads a schema directory) and produces the same `ContractConfig` as a `.prisma` path does. `contract emit` writes `contract.json` and `contract.d.ts` into the directory that holds the schema file or the schema directory, whatever the file is named: `prisma7Schema('prisma/schema.prisma')` and `prisma7Schema('prisma/schema')` both write `prisma/contract.json` and `prisma/contract.d.ts`, never inside the schema directory. This differs from a Prisma 8 PSL source, which defaults to `<schema name>.json` beside the schema (`prisma/schema.prisma` writes `prisma/schema.json`); `output` sets either explicitly. `options.output` is the path of the JSON file, resolved like the schema path, and `contract.d.ts` goes beside it: `prisma7Schema('prisma/schema.prisma', { output: 'src/generated/contract.json' })`.

```typescript
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma/config` is the published `prisma` package re-exporting `definePrismaConfig` from `@prisma/cli-engine`. Contributors working inside this repository, where the published `prisma` package is not built, import it from `@prisma/cli-engine` directly and the facade from `@internal/postgres/config`; the forms are the same functions. A worked example that runs Prisma 7 and Prisma 8 side by side is `examples/prisma7-adoption`.

What the project needs around that file:

- A `package.json` that depends on `@prisma/orm-postgres` and `prisma` (the Prisma 8 CLI, which also provides `prisma/config`). `@prisma/cli-engine` is not a direct dependency of the project: `prisma/config` re-exports `definePrismaConfig` from it, and the generated `contract.d.ts` imports only `@prisma/orm-postgres/...`. `contract emit` reads the nearest manifest to decide which package names `contract.d.ts` imports; without one it imports workspace-internal names that are not published.
- `db.connection` is the same database URL Prisma 7 has in its own `prisma.config.ts` (`datasource.url`). Prisma 8 does not read Prisma 7's config, so pass it here too, usually from the same `DATABASE_URL` variable.
- The Prisma 7 schema stays as Prisma 7 wants it: the `datasource` block carries `provider` only. Prisma 7 rejects `url` in the schema (it moved to `prisma.config.ts`), and this source ignores it.
- The commands print prose to the terminal and JSON when stdout is not a terminal (a pipe, a file, or an agent). Pass `--json` to get JSON in a terminal too.

During the transition Prisma 7 keeps owning the database and its migrations. Prisma 8 reads the schema and verifies it against what Prisma 7 built; it does not migrate. After every Prisma 7 migration, run `prisma contract emit` and then `prisma db sign` so the recorded contract matches the database again; `prisma db verify` reports nothing when they match. A database last migrated on Prisma 5 or earlier must migrate on Prisma 7 first: since Prisma 6.0.0 the implicit many-to-many junction tables carry a primary key on `(A, B)` instead of a unique index, and the source describes that shape.

The source interprets every construct Prisma 7 creates in Postgres: scalars and `@db.*` native types, `@map` and `@@map`, `@@schema`, enums as native enum types (with member `@map`), `@ignore` and `@@ignore`, defaults and ORM-side generators, `@updatedAt`, `@id`, `@unique`, `@@unique`, `@@index`, explicit and implicit relations. Anything it cannot express is a hard error with the file, line, and what to change. Prisma 7 still owns the database, so every edit below is a Prisma 7 schema change that Prisma 7's next migration applies; the table says what that migration does where it does anything:

| Code | What it means | What to change |
|---|---|---|
| `PRISMA7_PROVIDER_MISMATCH` | No `datasource` block, or its `provider` is not `postgresql`. | Use this source only with a Postgres schema. |
| `PRISMA7_RELATION_MODE_UNSUPPORTED` | `relationMode = "prisma"`, or the older `referentialIntegrity = "prisma"`. | Remove it or set `relationMode = "foreignKeys"`. Prisma 7's next migration then adds the foreign keys, and fails if any existing row breaks one. |
| `PRISMA7_VIEW_UNSUPPORTED` | A `view` block. | Remove the view; Prisma 8 has no views. |
| `PRISMA7_UNSUPPORTED_TYPE` | `Unsupported("...")`, or an unknown type. | Prisma 7 rejects `@ignore` on an `Unsupported` field, and removing the field drops its column on Prisma 7's next migration. Add `@@ignore` to the model instead: Prisma 7's next migration is empty, but the model disappears from the Prisma 7 client as well as from the contract, and any relation field that points to it needs `@ignore`. Correct an unknown type name. |
| `PRISMA7_NATIVE_TYPE_UNSUPPORTED` | A `@db.*` type with no Prisma 8 codec (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`). | If no key, index, or relation uses the field, add `@ignore` to it: Prisma 7's next migration is empty, the field disappears from the Prisma 7 client too, and a required field with no column default then accepts no inserts from either client. If one does, the model cannot use this source until the column type changes, because Prisma 7 still creates that constraint over an `@ignore`d column. Changing the field's type is a column type change on Prisma 7's next migration. |
| `PRISMA7_ENUM_NAMESPACE_MISMATCH` | A field uses an enum declared under a different `@@schema`. | Declare the enum in the model's schema, or move the model. |
| `PRISMA7_RELATION_UNRESOLVED` | A relation field that cannot be paired, is ambiguous, or is required over an optional foreign key field. | Name both sides with `@relation("name")`, add the missing `fields`/`references`, or add `?` to a relation field one of whose fields is optional. |
| `PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED` | `SetNull` over a required foreign key field, or `SetDefault` over a required field with no column default (a client-side generator such as `uuid()` gives none). | Make the fields optional, or give them a column default such as a literal or `dbgenerated("<expression>")`, which changes the column on Prisma 7's next migration, or choose another action, which replaces the foreign key on Prisma 7's next migration. |
| `PRISMA7_JUNCTION_ID_UNSUPPORTED` | An implicit many-to-many relation on a model without a single-field `@id`. | Give the model a single-field `@id`, or write the junction model out. |
| `PRISMA7_JUNCTION_NAME_COLLISION` | A model has the name of an implicit many-to-many junction model (`PostToTag`, or the relation name). | Rename the model and keep its table with `@@map("<table>")`; Prisma 7's next migration is empty. |
| `PRISMA7_TABLE_COLLISION` | Two models map to the same table in one schema. | Give each model its own table. |
| `PRISMA7_UNKNOWN_DEFAULT` | A `@default` value the source cannot read, or `dbgenerated()` with no expression on a required field, which is not supported yet. | Use a literal, an enum member, or one of `autoincrement()`, `now()`, `dbgenerated("<expression>")`, `uuid()`, `ulid()`, `nanoid()`, `cuid()`. For `dbgenerated()`, either remove the `@default`, which makes Prisma 7's next migration drop the column default (`ALTER COLUMN ... DROP DEFAULT`) and both clients require the value on create, or write the column's database default as the expression, which Prisma 7's next migration sets on the column. |
| `PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED` | A `Json` default of `"null"`, which the contract cannot tell apart from SQL `NULL`. | Remove the `@default` or give it another JSON value; either changes the column default on Prisma 7's next migration. |
| `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` | `@default(uuid())`, another generator, or `@updatedAt` on an optional field. | Remove `@updatedAt` or the generator `@default(...)` and keep the `?`. The database does not change, and both clients then stop filling the value. |
| `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` | `@updatedAt` combined with `@default`. | Remove the `@default`. `@updatedAt` still sets the value on create and on update, and Prisma 7's next migration removes the column default. |
| `PRISMA7_IGNORED_FIELD_REFERENCED` | An `@ignore`d field that a key, an index, or a relation's `fields:` uses. | Remove `@ignore` from the field: Prisma 7's next migration is empty, and the field appears in the Prisma 7 client again. |
| `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` | `sort`, `length`, `ops`, or an index type Prisma 8 does not have. | Remove the argument; Prisma 8 indexes carry none. |
| `PRISMA7_UNKNOWN_ATTRIBUTE` | An attribute Prisma 7 for Postgres does not have. | Remove it. |
| `PRISMA7_CONTRACT_INVALID` | The schema gives a contract Prisma 8 rejects, for a cause the source has no specific diagnostic for. | The message names the cause; report the schema, because the source should reject it with a precise diagnostic. |
| `PRISMA7_SCHEMA_READ_FAILED` | The path could not be read, or the schema directory holds no `.prisma` file. | Fix the path. |

Two things `db verify` gained alongside this source benefit every Prisma 8 project: it now recognises three more default spellings introspection reports (an enum literal cast to a type in another schema, a zoneless `timestamp` literal, and an `ARRAY[...]` list default), and it now compares a schema-qualified mixed-case type name such as `audit."AuditAction"` correctly.

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

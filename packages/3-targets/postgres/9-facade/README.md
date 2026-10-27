# @internal/postgres

One-package Postgres setup for Prisma 8. Install this single package to get config, runtime, and all transitive type dependencies.

Two runtime entry points create three kinds of object:

- `@internal/postgres/runtime` — `postgres()` returns a **client** for a long-lived Node process, with closure-cached `runtime()`, `orm`, `query()`, `execute()`, `toSql()` and `transaction()`.
- `@internal/postgres/serverless` — for serverless / edge runtimes (Cloudflare Workers + Hyperdrive, AWS Lambda, Vercel, Deno Deploy, Bun edge). `postgresServerless()` returns a **serverless client**, which holds no database connection. Each `connect({ url })` on it opens a fresh database connection and returns a **connection** with the members of a `postgres()` client except `connect`.

Pick the entry point that matches your deployment lifecycle. A database connection kept at module scope fails across `fetch` invocations in the four ways ADR 263 lists, so on the serverless side everything bound to a database connection lives on the connection. Inside a request, `db` does everything the `db` from `postgres()` does. See [ADR 263](../../../../docs/architecture%20docs/adrs/ADR%20263%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md) and the [Serverless Deployment Guide](../../../../docs/Serverless%20Deployment%20Guide.md) for the rationale.

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
import { contractFromJson } from '@internal/postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);
export const db = postgres({ contract });
```

### Serverless / per-request runtimes

```typescript
// db.ts — module scope: the serverless client holds no database connection.
import postgresServerless from '@internal/postgres/serverless';
import { contractFromJson } from '@internal/postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
export const postgres = postgresServerless({ contract });

// worker.ts — per request: open a connection, close it with `await using`.
export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString });
    const users = await db.orm.public.User.all();
    return Response.json(users);
  },
};
```

Inside a request, `db` does everything the `db` from `postgres()` does: `db.orm`, `db.sql`, `db.raw`, `db.transaction(...)`, `db.prepare(...)` and `db.query(...)` work unchanged. Await every query before the `await using` scope ends. The connection's `close()` waits until the runtime has been idle for one turn of the event loop (a `setTimeout(0)`), then refuses new work. A lazy ORM read such as `db.orm.public.User.all()`, or `db.query(plan)`, returned from the scope without `await` starts only when the caller awaits it, after the scope has closed, so it rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"), whose `fix` names the missing `await`. Work that keeps the runtime busy from the close onward completes: a `first()`, `execute()` or `transaction()`, an ORM write and its reload, including `include(...).create()` and a nested `create()`, and an async helper whose steps go through `db.orm`, `db.transaction()` or `db.prepare()`; a transaction commits. Such work is never refused because of the close; if it fails for its own reason, it rejects like any unawaited promise. A helper that calls `db.runtime()` after the scope has ended throws "Postgres connection is closed" at that call. Work that starts after the runtime was idle for a turn is refused. Whether a query sent after waiting on something other than the database counts as idle depends on when that callback runs relative to the timer, so do not rely on it. An unawaited promise that fails then, or fails for its own reason, rejects like any unawaited promise, and Node reports it as unhandled. Write `return await db.orm...`, not `return db.orm...`. `connect` connects to the database before it returns and rejects with `DRIVER.CONNECTION_FAILED` when the database refuses the connection, rejects the credentials, or does not answer within 20 seconds. `db` is not a `Runtime`; anything that takes a runtime gets `db.runtime()`. Never call `connect` at module scope.

## Exports

### `@internal/postgres/config`

Simplified `defineConfig` that pre-wires all Postgres internals (family, target, adapter, driver, contract providers). Pass a contract path (`.prisma` or `.ts`) or a ready `ContractConfig`, and optional db/migrations/extensions config.

#### A PSL source with a default control policy

`defineConfig` has no option for the contract's `defaultControlPolicy`, and a PSL file cannot carry it. To set one on a PSL contract, such as the file `prisma contract print --output` writes for a contract that has one, build the source with `prismaContract` from `@prisma/orm-family-sql` (add that package to the project's dependencies) and pass it the Postgres settings `defineConfig` passes for a `.prisma` path:

```typescript
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@prisma/orm-postgres/target/codec-ids';
import postgresPack from '@prisma/orm-postgres/target/pack';
import { postgresCreateNamespace } from '@prisma/orm-postgres/target/types';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prismaContract('./prisma/contract.prisma', {
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
      defaultControlPolicy: 'external',
    }),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`contract emit` then writes `prisma/contract.json` and `prisma/contract.d.ts`.

#### `prisma7Schema(path)`: adopt a Prisma 7 schema during the transition

`prisma7Schema` reads a Prisma 7 `schema.prisma` as the contract source, so a project that still runs Prisma 7 can adopt Prisma 8 without a second schema file. It accepts one file or a directory of `.prisma` files (every file under it, nested directories included, as Prisma 7 reads a schema directory) and produces the same `ContractConfig` as a `.prisma` path does. `contract emit` writes `contract.json` and `contract.d.ts` into the directory that holds the schema file or the schema directory, whatever the file is named: `prisma7Schema('prisma/schema.prisma')` and `prisma7Schema('prisma/schema')` both write `prisma/contract.json` and `prisma/contract.d.ts`, never inside the schema directory. This differs from a Prisma 8 PSL source, which defaults to `<schema name>.json` beside the schema (`prisma/schema.prisma` writes `prisma/schema.json`). The `output` directory on `defineConfig` sets either explicitly, as for every other source: with `output: 'generated/prisma8'`, `contract emit` writes `generated/prisma8/contract.json` and `generated/prisma8/contract.d.ts`.

`prisma contract format` treats this source as PSL: when `prisma7Schema` names one file, the command rewrites that file in place with the Prisma 8 formatter. To keep Prisma 7's own formatting, do not run `prisma contract format`; format the schema with Prisma 7's `prisma format` instead.

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
- The commands print prose to the terminal. When stdout is a pipe or a file, it receives only the command's plain data lines, such as one line per migration. Pass `--json` to get JSON.

During the transition Prisma 7 keeps owning the database and its migrations. Prisma 8 reads the schema and verifies it against what Prisma 7 built; it does not migrate. After every Prisma 7 migration, run `prisma contract emit` and then `prisma db sign` so the recorded contract matches the database again; `prisma db verify` reports nothing when they match. When `db verify` or `db sign` finds the database behind the contract, apply the change with a Prisma 7 migration rather than the `prisma db update` the CLI suggests, then sign again. A database last migrated on Prisma 5 or earlier must migrate on Prisma 7 first: since Prisma 6.0.0 the implicit many-to-many junction tables carry a primary key on `(A, B)` instead of a unique index, and the source describes that shape.

When the project is ready to stop reading the Prisma 7 file, `prisma contract print --output <path>` writes the Prisma 8 PSL that produces the same contract, with a header naming the schema it came from; without `--output` it prints the PSL instead. Point `contract` at the written file, run `prisma contract emit`, then take migration ownership: `prisma migration plan --name baseline`, `prisma db sign`, and `prisma migration ref set db <timestamp>_baseline`. Without an explicit `output`, `defineConfig` names the emitted files after the contract path it is given, so a written file with another name than the emitted files (for example `contract: './prisma/app.prisma'` where `contract emit` wrote `prisma/contract.json`) moves them to `prisma/app.json` and `prisma/app.d.ts` and leaves the old files on disk; `contract print` names both pairs in its next step when that happens. The command needs no database connection, and refuses rather than approximating, so the contract before and after the switch is the same one. Not every Prisma 7 schema prints yet: a schema that declares one model name in two `@@schema` namespaces exits `2` with `CONTRACT.PRINT_UNSUPPORTED` and prints and writes nothing.

A construct is either described exactly or refused. There is no approximate lowering and no silent change. The source reads scalars and `@db.*` native types, `@map` and `@@map`, `@@schema`, enums as native enum types (with member `@map`), `@ignore` and `@@ignore`, `Unsupported("...")` fields, defaults and ORM-side generators, `@updatedAt`, `@id`, `@@id`, `@unique`, `@@unique`, `@@index`, and explicit and implicit relations. Everything else is a hard error naming the file, the line, and what to change: views, `@db.*` types Prisma 8 has no codec for, `relationMode = "prisma"`, and the handful of shapes in the table below that Prisma 8 cannot yet express. Prisma 7 still owns the database, so every edit below is a Prisma 7 schema change that Prisma 7's next migration applies; the table says what that migration does where it does anything.

An `Unsupported("X")` field becomes a raw column (ADR 273): its type is the text `X` as written, and the model has no field for it, as the Prisma 7 client had none. When the schema loads, the reader checks that `X` is one type name; it compares `X` with the database's catalog text only at `db verify`. Postgres stores the type under its catalog name, so `Unsupported("int4")` loads, and `db verify` then reports the column with the text the database prints, here `integer`. Write that text in the Prisma 7 schema; Prisma 7 plans nothing for the edit. A required `Unsupported` field with no default warns `PN_COLUMN_REQUIRED_UNMAPPED`, because no ORM insert into its table can succeed: make it optional, or give it `@default(dbgenerated("..."))`. `contract print` cannot write a column with no field yet, so a schema with `Unsupported` fields stays on `prisma7Schema(...)` for now.



| Code | What it means | What to change |
|---|---|---|
| `PSL.PRISMA7_PROVIDER_MISMATCH` | No `datasource` block, or its `provider` is not `postgresql`. | Use this source only with a Postgres schema. |
| `PSL.PRISMA7_RELATION_MODE_UNSUPPORTED` | `relationMode = "prisma"`, or the older `referentialIntegrity = "prisma"`. | Remove it or set `relationMode = "foreignKeys"`. Prisma 7's next migration then adds the foreign keys, and fails if any existing row breaks one. |
| `PSL.PRISMA7_VIEW_UNSUPPORTED` | A `view` block. | Remove the view; Prisma 8 has no views. |
| `PSL.PRISMA7_UNSUPPORTED_TYPE` | An unknown type, a type constructor other than `Unsupported(...)`, or an `Unsupported(...)` that is not one string holding one type name. | Correct the type name. Write `Unsupported("<type>")` with the type as the database prints it, such as `Unsupported("tsvector")`. |
| `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED` | A `@db.*` type with no Prisma 8 codec (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`). | Prisma 8 cannot read the schema until it supports the column type. `@ignore` and `@@ignore` do not help, because Prisma 8 keeps the columns of ignored fields and models in the contract. Changing the field's type to one Prisma 8 supports changes the column type on Prisma 7's next migration. |
| `PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH` | A field uses an enum declared under a different `@@schema`. | Declare the enum in the model's schema, or move the model. |
| `PSL.PRISMA7_RELATION_UNRESOLVED` | A relation field that cannot be paired, is ambiguous, or is required over an optional foreign key field. | Name both sides with `@relation("name")`, add the missing `fields`/`references`, or add `?` to a relation field one of whose fields is optional. |
| `PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED` | `SetNull` over a required foreign key field, or `SetDefault` over a required field with no column default (a client-side generator such as `uuid()` gives none). | Make the fields optional, which drops `NOT NULL` on Prisma 7's next migration and makes them nullable in the Prisma 7 client. Or give them a column default such as a literal or `dbgenerated("<expression>")` (in Prisma 7; in Prisma 8 the same default is written `` sql`<expression>` ``), which Prisma 7's next migration sets: a field without a `@default` then becomes optional when creating records with the Prisma 7 client, and a field with a client-side generator such as `@default(uuid())` must have that `@default` replaced, because a field takes only one, after which the Prisma 7 client stops generating its value. Or choose another action, which replaces the foreign key on Prisma 7's next migration and leaves the Prisma 7 client unchanged. |
| `PSL.PRISMA7_JUNCTION_ID_UNSUPPORTED` | An implicit many-to-many relation on a model without a single-field `@id`. | Give the model a single-field `@id`, or write the junction model out. |
| `PSL.PRISMA7_JUNCTION_NAME_COLLISION` | A model in the same schema as an implicit many-to-many junction has the junction model's name (`PostToTag`, or the relation name). | Rename the model and keep its table with `@@map("<table>")`; Prisma 7's next migration is empty. |
| `PSL.PRISMA7_RELATION_NAME_SHARED` | Implicit many-to-many relations on different models in the same schema use the same relation name; Prisma 7 creates one `_<name>` table, wired to only one of them. The same name in two schemas is fine: Prisma 7 creates a table in each. | Give each relation its own name. Renaming a relation that table does not reference makes Prisma 7's next migration create its own table; renaming the one it references moves the table's foreign keys to another relation, which fails on rows whose ids that relation's models lack. |
| `PSL.PRISMA7_TABLE_COLLISION` | Two models map to the same table in one schema, or a model maps to the table of an implicit many-to-many relation (`_PostToTag`). | Give each model its own table. For a relation's table, rename the model's table with `@@map`, which makes Prisma 7's next migration create the table it never created; renaming the relation instead rebuilds its table as the model's and loses the relation's rows. |
| `PSL.PRISMA7_UNKNOWN_DEFAULT` | A `@default` value the source cannot read. | Use a literal, an enum member, or one of `autoincrement()`, `now()`, `dbgenerated("<expression>")`, `uuid()`, `ulid()`, `nanoid()`, `cuid()`. On an `Unsupported` field, use only `dbgenerated("<expression>")`, as Prisma 7 requires. |
| `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED` | A `Json` default of `"null"`, which the contract cannot tell apart from SQL `NULL`. | Remove the `@default` or give it another JSON value; either changes the column default on Prisma 7's next migration. |
| `PSL.PRISMA7_IGNORED_FIELD_REFERENCED` | An `@ignore`d field, or an `Unsupported` field of a model that is not `@@ignore`, in `@id` or `@@id`, or one a relation that is not `@ignore` joins on through `fields:` or `references:`. | For a primary key, remove `@ignore` from the field, or replace it with `@@ignore` on the model: either gives an empty Prisma 7 migration, and `@@ignore` keeps the table and removes the model from both clients, while Prisma 7 then requires `@ignore` on every relation field that points to the model. For a relation, remove `@ignore` from the field, or mark the relation field `@ignore` too, which keeps its foreign key and removes the relation field from the Prisma 7 client. For an `Unsupported` field, add `@@ignore` to the model, or mark the relation field `@ignore`. |
| `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` | `sort`, `length`, `ops`, or an index type Prisma 8 does not have. | Remove the argument; Prisma 8 indexes carry none. |
| `PSL.PRISMA7_UNKNOWN_ATTRIBUTE` | An attribute Prisma 7 for Postgres does not have, or `@db.*` on an `Unsupported` field. | Remove it. |
| `PSL.PRISMA7_CONTRACT_INVALID` | The schema gives a contract Prisma 8 rejects, for a cause the source has no specific diagnostic for. | This is a bug in Prisma ORM: report it with the schema. The message names the cause. |
| `PSL.PRISMA7_SCHEMA_READ_FAILED` | The path could not be read, or the schema directory holds no `.prisma` file. | Fix the path. |

#### What every Prisma 8 project gets alongside this source

These changes are not specific to a Prisma 7 schema. They apply to any Postgres project.

- `db verify` reads more of the default spellings Postgres prints. It reads a negative or cast numeral (`'-1'::integer`, `(5)::smallint`) as the number, an enum literal cast to a type in another schema as the enum value, and a zoneless `timestamp` literal as that timestamp. It reads `ARRAY[...]` defaults of text, boolean, integer (including negative), bigint, float, decimal, timestamp and enum elements, with the casts Postgres prints, and an empty `VARCHAR(n)[]`. An element that is an expression or a function call stays raw. Columns that were reported as drift on these spellings now verify clean.
- `db verify` compares a schema-qualified mixed-case type name such as `audit."AuditAction"` correctly.
- Introspection reads defaults, check constraints, index predicates, and policy expressions in a session pinned to `TimeZone = UTC`, `DateStyle = ISO, MDY`, `IntervalStyle = postgres`, and `bytea_output = hex`, restoring the caller's settings afterwards. The text it reads is therefore the same whatever the server, the role, or the caller set. One consequence: a contract inferred earlier from a server outside UTC, holding a `timestamptz` constant inside check or index text, shows that text once as a difference; the new text is stable from then on. On a server set to `bytea_output = escape`, the pin also rewrites a `bytea` constant inside check, index or policy text, from `'\001'::bytea` to `'\x01'::bytea`, so a contract inferred earlier from such a server shows that text once as a difference too.
- Migration planning renders a list literal default with its cast (`ARRAY['1', '-2']::int8[]`), the same rendering the adapter uses for column DDL.

**The ORM's `now` for `timestamp` columns is UTC wall-clock time, whatever the host's time zone.** A database `now()` default uses the session time zone instead, so a column filled by the ORM and a column filled by a database default agree only in a UTC session. Prisma 7 writes UTC into `timestamp(3)`, so a Prisma 7 database stays consistent with what Prisma 8's generator writes. A Prisma 7 schema read with `prisma7Schema` fills a `@default(now())` column with the ORM's `now` on create, as Prisma 7's client did, and keeps the database default for writes from outside Prisma.

### `@internal/postgres/runtime`

`@internal/postgres/runtime` exposes a single `postgres(...)` helper that composes the Postgres execution stack and returns query/runtime roots:

- `db.sql`, `db.raw`, `db.orm`
- `db.query(plan)`, `db.execute(plan)`, `db.toSql(plan)`
- `db.context`
- `db.stack`

Creating a client has no side effects. The pool is created on the first query, `db.runtime()` or `db.connect(...)`.
Connection binding can be provided up front (`url`, `pg`, `binding`) or deferred via `db.connect(...)`.

Pass `collections` to give models custom collection classes: `postgres({ contract, url, collections: { Post: PostCollection } })`, where `PostCollection` extends `Collection<Contract, 'Post'>` from `@prisma/orm-postgres/orm-client`. `db.orm.public.Post` and `tx.orm.public.Post` inside `db.transaction(...)` are then a `PostCollection`. The client's type carries the classes as its second type parameter, `PostgresClient<Contract, { Post: typeof PostCollection }>`, which defaults to no classes; a parameter typed `PostgresClient<Contract>` accepts a client with classes. `postgresServerless()` accepts the same option, and every connection it opens uses the classes.

`db.close()` refuses every new call at once with `DRIVER.NOT_CONNECTED` ("Postgres client is closed"), so callers that keep querying cannot keep it waiting. A member that returns a promise or a result, such as `query`, `execute`, `prepare`, `transaction` or an ORM call, reports the error through what it returns: the promise rejects, and the result rejects when it is awaited or read. `db.runtime()`, which returns a runtime, throws at the call, and so does a mistake in the call itself. See [Shutdown](../../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md#shutdown) for the rule. A runtime captured with `db.runtime()` before `close()` is refused at once too, with "Runtime is closed", because the client builds its runtime with the `'at-once'` close policy and closes it. It waits for the queries and transactions already in flight, and a transaction in flight commits. It also waits for every ORM call started before `close()`: a call is one activity, and an activity already open when `close()` is called finishes its work, so an ORM write left pending, including `include(...).create()` and a nested create with its reload, completes. A streaming ORM read such as `all()` starts its call only when the caller reads it; read after `close()`, it is refused with "Postgres client is closed". It always closes the runtime. It ends the pool only for a client built from `{ url }`: a caller's `pg.Pool` or `pg.Client` stays open, and the caller ends it. Every call returns the same promise. See [Shutdown](../../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md#shutdown).

When URL binding is used, pool timeouts are configurable via `poolOptions`:

- `poolOptions.connectionTimeoutMillis` (default `20_000`)
- `poolOptions.idleTimeoutMillis` (default `30_000`)

Reads are buffered by default. Pass `cursor` (typed `PostgresCursorOptions`, `{ batchSize?: number | undefined }`) to read through a server-side cursor (`pg-cursor`): `{ batchSize: 50 }` streams in batches of 50; `{}` or `{ batchSize: undefined }` in batches of 100; a `batchSize` that is not a positive integer fails the factory call. There is no flag that turns cursors off; leaving the option out does that. A `cursor` value with any other key, or a `batchSize` that is not a positive integer, fails the factory call with `RUNTIME.ARGUMENT_INVALID`. `postgresServerless()` accepts the same option.

Pass `log` (an object with `info`, `warn`, `error` and an optional `debug` method, each taking one event object; `console` works, and the type is `Log` from `@prisma/orm-postgres/family-runtime`) to receive what the runtime logs: the marker-verification warnings `CONTRACT.MARKER_MISSING` and `CONTRACT.MARKER_MISMATCH` from the first query, the warnings `lints()` emits for rules whose severity is `warn`, and the errors a middleware's `activityEnded` or `activityFinalized` hook throws, which the runtime logs and swallows. It also receives the warning `runtime.close.waiting-for-activities` when `close()` is waiting only for activities whose handles were never ended or for transactions still open, with the counts `openActivities` and `openTransactions`; `close()` waits for each such transaction until it commits or rolls back, and the error `runtime.connection.release.error` when the connection taken for an activity's own transaction fails to release after the transaction settles. If `log` has a `debug` method, it also receives debug events, for example when a middleware intercepts a statement. `budgets()` violations reach `log` only in `mode: 'permissive'` (see *Running plans and rendering SQL*). Without `log`, the runtime drops these events. `postgresServerless()` accepts the same option.

### Running plans and rendering SQL

`db.query(plan)` runs a plan from `db.sql`, `db.raw` or the ORM and returns its rows as an `AsyncIterableResult`; `await` it for an array. `db.execute(plan)` runs a plan and resolves its statistics, `{ affectedRows }`, with no rows. Both have the types `tx.query` and `tx.execute` have inside `db.transaction(...)`. For an ORM plan such as `db.orm.public.Post.published().prepared.all().plan`, `db.query` yields the database rows, not the result the ORM builds from them.

`db.toSql(plan)` returns the SQL and parameters the plan would run, `{ sql, params }`, with no database. `params` are the values the plan holds, before codecs encode them for the driver. Middleware rewrites (`beforeCompile`) are not applied, because they belong to running a query. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would. `postgresStatic()` has `toSql` too.

```ts
const plan = db.sql.public.posts.select('id', 'title').limit(10).build();
console.log(db.toSql(plan));
for await (const row of db.query(plan)) console.log(row);
await db.execute(db.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
```

`mode` is `'strict'` by default, and every `budgets()` violation throws. Pass `mode: 'permissive'` and a violation whose severity is `'warn'` goes to `log.warn` instead, and the query runs; a violation whose severity is `'error'` still throws. `budgets()` gives latency `'warn'` and the row count `'error'` by default, so a row-count limit warns only with `severities: { rowCount: 'warn' }`.

### Transactions

`db.transaction(async (tx) => ...)` commits when the callback returns and rolls back when it throws. `tx` offers the client's query members, with the same types: `sql`, `orm` (with the client's custom collection classes), `raw`, `prepare`, `query`, `execute`, `toSql`, `enums` and `nativeEnums`. Every statement they send runs inside the transaction. `tx` has no `close`, `[Symbol.asyncDispose]`, `transaction` or `runtime()`. A transaction on a serverless connection (`await postgres.connect({ url })`) offers the same members. The type is `PostgresTransactionContext<Contract>`.

```ts
await db.transaction(async (tx) => {
  const posts = await tx.orm.public.Post.published().forUpdate().all();
  await tx.execute(tx.raw.sql`UPDATE posts SET pinned = false WHERE id = ${posts[0]!.id}`.affectedCount().build());
  const byId = await tx.prepare({ id: 'pg/int4@1' }, (params) =>
    tx.sql.public.posts.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
  );
  await byId.query(tx, { id: 1 });
});
```

`published()` is a method of a custom `PostCollection`. `tx.prepare` lets code inside a transaction prepare a statement without the outer client. Preparing sends nothing to the database.

### Prepared SQL and ORM rows

Use `db.prepare(declaration, params => ...)` to prepare SQL queries, ORM row reads or ORM aggregates once and execute them with different parameter values.

```ts
const byId = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
const all = await db.prepare({}, () => db.orm.public.User.select('id').prepared.all());
const first = await db.prepare({}, () => db.orm.public.User.select('id').prepared.first());

const rows = all.query(db.runtime(), {});
for await (const row of rows) console.log(row.id);
const rowOrNull = await first.query(db.runtime(), {});
const sqlRows = await byId.query(db.runtime(), { id: 1 });
```

Pass a compatible runtime, connection or transaction explicitly to `query(target, params, options?)`. A prepared statement runs on what it is given, wherever it was prepared: `ps.query(tx, params)` inside `db.transaction(async (tx) => ...)` runs inside the transaction. ORM `all` returns a thenable async row stream; `first` returns a row-or-null promise; `firstOrThrow` returns a row promise that rejects with `RUNTIME.NO_ROWS` when no row matches. For descriptions built with `.prepared.aggregate(selector, configure?)`, `query` returns an aggregate object promise on ungrouped collections (`Promise<AggregateResult<Spec>>`), or an array promise after `groupBy(...)` (`Promise<Array<GroupKeys & AggregateResult<Spec>>>`). See the [ORM composition reference](../../../3-extensions/sql-orm-client/README.md#prepared-row-descriptions) for aggregate examples, HAVING, supported predicates, includes and pagination.

### `@internal/postgres/contract-builder`

Re-exports the TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, ...) so a generated `prisma/contract.ts` can author its contract using only this facade package. The `defineContract` export is a Postgres-specific wrapper that pre-binds `family` and `target` — callers do not pass those fields:

```typescript
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract(
  { extensions: {} },
  ({ field: f, model: m, gen, type }) => ({
    models: {
      User: m('User', { fields: { id: f.column(type.Uuid()).id().onCreate(gen.uuid()) } }),
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

`@internal/postgres/serverless` exposes `postgresServerless(...)` for per-request runtimes. It returns the serverless client, which holds no database connection and exposes:

- `postgres.sql`, `postgres.raw`, `postgres.enums`, `postgres.nativeEnums`, `postgres.toSql(plan)`
- `postgres.context`, `postgres.contract`, `postgres.stack`
- `postgres.connect({ url })` — returns `Promise<PostgresServerlessConnection<Contract>>`

`PostgresServerlessConnection<Contract>` is `PostgresClient<Contract>` without `connect`: `sql`, `raw`, `enums`, `nativeEnums`, `toSql`, `context`, `contract` and `stack` (the same objects as on the serverless client), plus `orm`, `query(plan)`, `execute(plan)`, `runtime()`, `transaction(fn)`, `prepare(...)`, `close()` and `[Symbol.asyncDispose]`.

Each `connect()` call creates a fresh `pg.Client`, connects it to the database, and wraps it in a fresh runtime. When the database refuses the connection, rejects the credentials, or does not answer within 20 seconds, `connect()` rejects with `DRIVER.CONNECTION_FAILED` and ends the `pg.Client`. No `pg.Pool` is allocated. `close()` and `[Symbol.asyncDispose]` close the runtime once, which ends its `pg.Client`. After that, `db.runtime()` throws `DRIVER.NOT_CONNECTED` ("Postgres connection is closed"). ORM queries, `db.transaction(...)` and `db.prepare(...)` go through the runtime: `close()` waits until the runtime has been idle for one turn of the event loop, then ends the `pg.Client`, and work that starts after that rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"). A connection has one database connection, a `pg.Client`, so inside `db.transaction(async (tx) => ...)` run every query through `tx`. Reads are buffered by default. To stream on some paths only, create a second serverless client with `cursor: { batchSize }` and open connections from it only on those paths; they read through `pg-cursor` in batches. On such a connection, finish or `break` a `for await` over a read before sending another query through `db`: the cursor holds the only database connection until the loop ends, so a query inside the loop waits forever. For the same reason, an iterator started by hand with `next()` and never finished or returned holds the client query lock, and `close()` waits for it for ever, as it does for a `db.runtime().connection()` that is never released. Behind Cloudflare Hyperdrive, reads with cursors on hang, so those paths hang there and the paths whose connections come from the serverless client without the option do not.

### `@internal/postgres/static`

`contractFromJson<Contract>(json)` validates an emitted `contract.json` and returns it as the `Contract` type from `contract.d.ts`. Pass the result to `postgres({ contract })`, `postgresServerless({ contract })` or `postgresStatic({ contract })`. It is validated once, however many clients use it. A contract written in TypeScript with `defineContract` is already a typed value and goes to the client directly. The default export, `postgresStatic({ contract })`, builds the static members (`sql`, `raw`, `enums`, `nativeEnums`, `context`, `contract`, `stack`) without loading the database driver.

## Responsibilities

- Build a static Postgres execution stack from target, adapter, and driver descriptors
- Build the static members (`sql`, `raw`, `enums`, `nativeEnums`, `context`, `contract`, `stack`) from the execution context, once per client or serverless client
- Build the runtime-bound members (`orm`, `query()`, `execute()`, `runtime()`, `transaction()`, `prepare()`) over a runtime, for a client and for each connection
- Normalize runtime binding input (`binding`, `url`, `pg`) for `postgres()`
- Lazily instantiate a client's runtime resources on the first `db.runtime()` or `db.connect(...)` call, and memoize the runtime so repeated `db.runtime()` calls return one instance
- Open one `pg.Client` per `connect({ url })` on a serverless client, and close it with the connection

## Architecture

The diagram shows `postgres()`. A connection from `postgresServerless()` has the same static and runtime-bound members over one `pg.Client` instead of a lazy pool.

```mermaid
flowchart TD
    App[App Code] --> Client[postgres(...)]
    Client --> Static[Static members: sql raw enums nativeEnums context contract stack]
    Client --> Bound[Runtime-bound members: orm runtime() transaction prepare]
    Bound --> Lazy[runtime() on first use]

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

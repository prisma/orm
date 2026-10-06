---
from: "8.0.0-rc.13"
to: "8.0.0-rc.14"
changes:
  - id: engine-pin-moves-to-0-6-2
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.2` (up from 0.6.1). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.2`. With this engine the CLI prints its own name in hints and messages where it used to print a literal `{bin}`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.1"'
  - id: temporal-polyfill-is-a-peer-dependency
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`, not a dependency. The Postgres control plane, such as the `prisma` commands and the Vite plugin, imports it. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
      anyMatch: true
  - id: serverless-connect-returns-connection
    summary: "connect({ url }) on the serverless client from @prisma/orm-postgres/serverless returns a connection, not a Runtime. Call db.runtime().query(plan) and db.runtime().execute(plan), and pass db.runtime() wherever the connect() result was used as a runtime. connect() now connects before it returns and rejects with DRIVER.CONNECTION_FAILED when the database cannot be reached."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '[''"]@prisma/orm-postgres/serverless[''"]'
  - id: serverless-connection-orm-and-transaction
    summary: "Optional: the connection has orm and transaction(fn), so db.orm replaces a hand-built orm({ runtime, context }) in queries that call no custom collection method, and db.transaction(fn) replaces withTransaction(runtime, fn)."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '[''"]@prisma/orm-postgres/serverless[''"]'
  - id: serverless-cursor-default-off
    summary: "Reads through connections from @prisma/orm-postgres/serverless no longer go through a server-side cursor by default. A path that must keep batched streaming opens its connection from a second serverless client with cursor: { batchSize: 100 }; that path hangs behind Cloudflare Hyperdrive. PostgresServerlessCursorOptions is now PostgresCursorOptions, which is { batchSize?: number | undefined } with no disabled flag, so cursor: { disabled: true } no longer compiles and must be deleted."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '[''"]@prisma/orm-postgres/serverless[''"]'
  - id: date-time-default-stored-in-canonical-form
    summary: |
      A PSL date or time default is stored in `contract.json` in its type's canonical form, however it was written: `@default("2024-01-01T01:00:00+01:00")` on a `DateTime` column is stored as `"2024-01-01T00:00:00Z"`. A default that was not already in that form gets a new storage hash when the contract is re-emitted. The database needs no change: re-emit, then `prisma db sign`, or record an empty migration with `prisma migration new`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(DateTime|Timestamptz|TimestamptzJsDate|TimestamptzString|Timestamp|TimestampString|Date|DateString|Time|TimeString|Timetz)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: date-time-default-refused-text
    summary: |
      `prisma contract emit` refuses a date or time default its column's type does not hold, with `PSL_INVALID_DEFAULT_LITERAL`: an offset on `Timestamp`, `Date` or `Time`, no offset on `DateTime`, `Timestamptz` or `Timetz`, a date on a time column, a time on a `Date` column, more than six digits after the decimal point (three on a SQLite `DateTime`), a date or time that does not exist, a year outside the range the type holds, or a ` BC` suffix on a SQLite `DateTime`. The message shows text the column takes.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(DateTime|Timestamptz|TimestamptzJsDate|TimestamptzString|Timestamp|TimestampString|Date|DateString|Time|TimeString|Timetz)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: date-time-ts-default-stored-in-canonical-form
    summary: |
      In a TypeScript contract, a default on `field.temporal.timestamptzJsDate()`, `field.temporal.timestamptzString()`, `field.temporal.timestampString()`, the SQLite `field.temporal.datetime()`, and the `dateStringColumn`, `timeStringColumn`, `timetzColumn` and SQLite `sqliteDatetimeColumn` helpers is stored in the same canonical form as in PSL: `new Date('2024-01-01T00:00:00Z')` is stored as `"2024-01-01T00:00:00Z"`, not `"2024-01-01T00:00:00.000Z"`. A `Temporal` default with digits below one microsecond is refused. The storage hash changes; re-emit, then sign or migrate as for PSL.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.(timestamptzJsDate|timestamptzString|timestampString|datetime)\([^)]*\)(\s*\.\w+\([^)]*\))*?\s*\.default\('
        - '\b(timestamptzJsDateColumn|timestamptzStringColumn|timestampStringColumn|dateStringColumn|timeStringColumn|timetzColumn|sqliteDatetimeColumn|datetimeColumn)\b[^\n]*\.default\('
  - id: mongo-create-returns-stored-document
    summary: |
      Mongo `create()` and `createAll()` now return each inserted document as stored, decoded like
      a read, instead of the input with the new `_id`. The ORM computes it from the document it
      sent, through the client's BSON options, without a second query. A `Bson` field comes back
      as a read returns it (a `Long` in the safe-integer range as a number, bytes as `Binary`, a
      `BSONRegExp` as a `RegExp`), and a nullable field left out comes back as `null`.
  - id: mongo-reads-decode-includes-value-objects-and-absent-fields
    summary: |
      Mongo reads now decode included documents (`include(...)`) and composite-type (value
      object) fields through their codecs, and a nullable field missing from the stored document
      reads as `null` instead of `undefined`.
  - id: mongo-where-filter-expressions-encoded
    summary: |
      A filter expression passed to the Mongo ORM's `where()` now encodes its comparison and
      `$in`/`$nin` values through the field's codec, as the object form of `where()` does, and each
      element of a whole-list comparison through the element codec. A value the codec refuses,
      such as a driver `Long` for an `Int64` field (the codec takes a `bigint`) or a fraction for
      an `Int32` field, fails with `RUNTIME.ENCODE_FAILED`. The object form of `where()` now also
      refuses a fraction or an out-of-range number for an `Int32` field. This applies to the ORM
      only: the query builder's `match()` sends values as given.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.where\(\s*(?:MongoFieldFilter|MongoAndExpr|MongoOrExpr|MongoNotExpr)\.'
  - id: mongo-writes-check-int32-enum-and-null-values
    summary: |
      The Mongo ORM refuses, with `RUNTIME.ENCODE_FAILED` naming the field, a write of a fraction
      or an out-of-range number to an `Int32` field, of a value outside the field's enum, and of
      `null` to a field that is not nullable. Before, depending on the field's type, the field's
      codec refused it, a contract with a collection validator got a bare "Document failed
      validation" from the server, or a contract without one (TypeScript builder, Prisma 6 schema)
      stored the value. Filters still accept a value outside the enum and `null`, so they can find
      documents that hold one.
  - id: mongo-codecs-check-value-types
    summary: |
      The Mongo `String`, `Bool`, `Date`, `ObjectId` and vector codecs refuse a value of the wrong
      type with `RUNTIME.ENCODE_FAILED` naming the field, in writes and filters, as `Int32` and
      `Double` do. Before, a `null` element in a `String[]`, `Bool[]` or `Date[]` list or a
      mistyped value was stored as given, an invalid `Date` was stored as the epoch, and `null`,
      `undefined` or a number for an `ObjectId` field became a new id or a timestamp.
  - id: mongo-list-elements-encoded
    summary: |
      The Mongo ORM encodes each element of a list field through the field's codec, on writes and
      in filters. An `ObjectId[]`, `Int64[]`, `Decimal128[]` or `Binary[]` field now stores its
      elements as `ObjectId`, `long`, `decimal` and `binData`, where before the whole list reached
      the element codec and the write failed with `RUNTIME.ENCODE_FAILED`. A whole number in a
      `Double[]` field is stored as a `double`.
  - id: mongo-query-builder-bson-values-match
    summary: |
      A query-builder filter or raw command that compares with a driver class such as `ObjectId`,
      `Long`, `Decimal128` or `Binary` now sends it as that BSON value. Before, the Mongo adapter
      copied it into a plain object, so the filter matched nothing.
  - id: mongo-upsert-keeps-create-values
    summary: |
      When `create` sets a field that has an update default (`@updatedAt`,
      `temporal.updatedAt()`, `temporal.timestamp(onUpdate: now)`), `upsert()` now inserts the
      `create` value, and still applies the update default on update, in one atomic command.
      Before, the insert got the current time instead. Such an upsert refuses `pull()` by a match
      document with `ORM.OPERATION_UNSUPPORTED`.
  - id: contract-source-warnings-are-diagnostics
    summary: |
      `prisma contract emit` and `prisma contract print` report contract source warnings, such as
      `PSL_DEPRECATED_SCALAR_NAME`, as `warn` diagnostics of the result instead of free-text
      `warning …` messages. With `--json` they are in the result envelope's `diagnostics`. Their
      file, and the file of a source error from either command, is shown relative to the working
      directory.
  - id: mongo-ts-preset-field-not-optional
    summary: |
      In a Mongo TypeScript contract, `.optional()` or `.many()` on a field a preset fills, such
      as `field.temporal.createdAt()`, is now a type error that says "A preset fills this field on
      write, so it cannot be optional" (or "a list"); it always failed when the contract was built.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\btemporal\.(?:createdAt|updatedAt|timestamp)\([^)]*\)\s*\.(?:optional|many)\('
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.14. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.13"'
---

# 8.0.0-rc.13 → 8.0.0-rc.14 — User upgrade instructions

## `engine-pin-moves-to-0-6-2`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.1` to `0.6.2` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

Engine 0.6.2 replaces the placeholder `{bin}` with the name of the CLI that was run. A hint that used to print as `{bin} db migrate` now prints as `prisma db migrate`. The replacement applies to next actions, warnings, errors, and summary and list text, in human, `--json`, and `--format markdown` output. If a script or a test of yours matches the literal text `{bin}` in the CLI's output, change it to match the CLI name.

## `temporal-polyfill-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-postgres` or `@prisma/orm-target-postgres`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.

## `serverless-connect-returns-connection`

`postgresServerless(...).connect({ url })` used to return a `Runtime`. It now returns a **connection** with the members of a `postgres()` client except `connect`: `sql`, `raw`, `enums`, `nativeEnums`, `context`, `contract`, `stack`, `orm`, `runtime()`, `transaction(fn)`, `prepare(...)`, `close()` and `[Symbol.asyncDispose]`. It is not a `Runtime`: it has no `query` or `execute`. `db.runtime()` returns the runtime. A connection owns one database connection, and `await using` still closes it when the scope ends.

The **serverless client** returned by `postgresServerless(...)` still holds no database connection. It now also has `raw`, `enums` and `nativeEnums`.

In each file that imports `@prisma/orm-postgres/serverless`, or that uses the result of its `connect()`:

1. Name the serverless client `postgres` and the connection that `connect()` returns `db`. With these names, code written for a `postgres()` client (`db.orm...`, `db.transaction(...)`, `db.runtime().query(...)`) works unchanged inside a request, as long as every query is awaited before the `await using` scope ends: the connection closes when the scope ends, so a lazy ORM read or `db.runtime().query(plan)` returned from the scope without `await` starts after the close and rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"), whose `fix` names the missing `await`; a `first()`, `execute()` or `transaction()` returned without `await` had already started, so the close waits for it and it completes. Update every import of the serverless client to the new name.
2. Replace `runtime.query(plan)` with `db.runtime().query(plan)`, and `runtime.execute(plan)` with `db.runtime().execute(plan)`. The old `connect()` result was a full `Runtime`, so the same applies to its other methods: `runtime.connection()`, `runtime.telemetry()` and `runtime.prepare(...)` become `db.runtime().connection()`, `db.runtime().telemetry()` and `db.runtime().prepare(...)`. `db.prepare(...)` also exists and accepts ORM queries as well as SQL plans. `db.sql` is the same object as `postgres.sql`, so `postgres.sql...` inside a request may be written `db.sql...`.
3. Anything that took the `connect()` result as a runtime takes `db.runtime()` instead: `withTransaction(runtime, fn)`, `orm({ runtime, context })`, `preparedStatement.query(runtime, params)`, and your own functions whose parameter is typed `Runtime`. A function that needs both the runtime and the context can take the connection, typed with `PostgresServerlessConnection<Contract>` from `@prisma/orm-postgres/serverless`, and read `db.runtime()` and `db.context`. That removes any cast of the serverless client's `context` to `ExecutionContext<Contract>`, and the `Runtime`, `ExecutionContext` and serverless client imports that only served it.
4. Update comments that describe the old shape. A comment that names the old variable or says the runtime is acquired through `db.connect(...)` now names `postgres.connect({ url })` and the connection `db`. A comment that calls the serverless client a facade, or calls a connection a per-request client or a runtime, now says serverless client or connection. For example, the doc comment on the serverless client says that it is built once per isolate, holds no database connection, and that each request opens its own connection with `postgres.connect({ url })`; it sits directly above the `postgresServerless(...)` declaration, so move it there if it sits above another declaration. Update any README that describes the old shape in the same way.
5. `connect({ url })` now connects to the database before it returns. It rejects with `DRIVER.CONNECTION_FAILED` when the database refuses the connection, rejects the credentials, or does not answer within 20 seconds, and leaves nothing open; a malformed URL, or one with a scheme such as `http://`, now fails at `connect()` with `RUNTIME.BINDING_INVALID`; before, `connect()` resolved and the first query failed instead. Move any handling of an unreachable database (a `try`/`catch` that answers with an error response, for example) from the first query to the `connect()` call. Answer a request that needs no query, such as an unknown route or a missing query parameter, before `connect()`, because `connect()` now opens a database connection whether or not a query follows; move such checks above the `connect()` call.

Before:

```ts
// src/prisma/db.ts
export const db = postgresServerless<Contract>({ contractJson });

// src/orm-client/client.ts
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { ExecutionContext } from '@prisma/orm-postgres/relational-core/query-lane-context';
import { db } from '../prisma/db';

const context = db.context as ExecutionContext<Contract>;

export function createOrmClient(runtime: Runtime) {
  return orm({ runtime, context, collections: { User: UserCollection } }).public;
}

// src/worker.ts
import { db } from './prisma/db';

await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
const rows = await runtime.query(db.sql.public.user.select('id').build());
const users = await createOrmClient(runtime).User.newestFirst().all();
```

After:

```ts
// src/prisma/db.ts
/**
 * Serverless client, built once per isolate. It holds no database connection. Each request opens
 * its own connection with `postgres.connect({ url })`.
 */
export const postgres = postgresServerless<Contract>({ contractJson });

// src/orm-client/client.ts
import { orm } from '@prisma/orm-postgres/orm-client';
import type { PostgresServerlessConnection } from '@prisma/orm-postgres/serverless';
import type { Contract } from '../prisma/contract.d';
import { UserCollection } from './collections';

export function createOrmClient(
  db: Pick<PostgresServerlessConnection<Contract>, 'runtime' | 'context'>,
) {
  return orm({
    runtime: db.runtime(),
    context: db.context,
    collections: { User: UserCollection },
  }).public;
}

// src/worker.ts
import { postgres } from './prisma/db';

await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString });
const rows = await db.runtime().query(db.sql.public.user.select('id').build());
const users = await createOrmClient(db).User.newestFirst().all();
```

The same applies to scripts that connect through the serverless client, for example a seed script: `await using db = await postgres.connect({ url })`, then `db.runtime().execute(...)`.

## `serverless-connection-orm-and-transaction`

This change is optional. The connection builds an ORM client and runs transactions itself.

- For each query on a hand-built `orm({ runtime, context })` client, check whether it calls a method defined on a custom collection class. If it calls none, run it on `db.orm` instead, even when the hand-built client registers custom collections, and drop the hand-built client from that code path when nothing else there uses it. For example, `const orm = createOrmClient(db); const rows = await orm.Post.where({ userId }).all();` becomes `const rows = await db.orm.public.Post.where({ userId }).all();`. Keep the hand-built client, built from `db.runtime()` and `db.context`, for queries that call custom collection methods, such as `orm.User.newestFirst()`.
- Replace `withTransaction(runtime, async (tx) => ...)` with `db.transaction(async (tx) => ...)`. `tx` has the same `execute` and `query` as before, plus `tx.sql`, `tx.orm`, `tx.enums` and `tx.nativeEnums`. Remove the `withTransaction` import when nothing else uses it.
- Update comments and README text that name `withTransaction(...)`, or a hand-built ORM client for a query that now runs on `db.orm`, to say `db.transaction(...)` and `db.orm`.

Before:

```ts
import { withTransaction } from '@prisma/orm-postgres/family-runtime';

await using runtime = await db.connect({ url });
const posts = await orm({ runtime, context }).public.Post.where({ userId }).all();
await withTransaction(runtime, async (tx) => {
  await tx.execute(db.sql.public.user.update({ displayName }).where((f, fns) => fns.eq(f.id, userId)).build());
});
```

After:

```ts
await using db = await postgres.connect({ url });
const posts = await db.orm.public.Post.where({ userId }).all();
await db.transaction(async (tx) => {
  await tx.execute(db.sql.public.user.update({ displayName }).where((f, fns) => fns.eq(f.id, userId)).build());
});
```

## `serverless-cursor-default-off`

`postgresServerless()` used to read through `pg-cursor` in batches of 100 rows unless you passed `cursor: { disabled: true }`. Reads are now buffered by default, the same as on `postgres()`: the whole result arrives before the first row is yielded. The `cursor` option is now `PostgresCursorOptions`, which is `{ batchSize?: number | undefined }`: leaving it unset keeps cursors off, and setting it turns them on, in batches of 100 when `batchSize` is omitted or `undefined` (`{}`), or of `n` for `{ batchSize: n }` with a positive integer `n`; any other `batchSize` fails the factory call. There is no `disabled` flag: `cursor: { disabled: true }` and `cursor: { disabled: false }` no longer compile, and a `disabled` key that reaches the factory at run time, from JavaScript or from options loaded from JSON, fails the call with `RUNTIME.ARGUMENT_INVALID`.

1. Find the paths that rely on batched streaming, for example `for await` over a large result with an early `break`. Leave the serverless client every other path uses without a `cursor` option; those paths now buffer. To keep a streaming path streaming, give it its own serverless client, for example `streamingPostgres`, created with the same options as the serverless client the other paths use (such as `middleware` and `extensions`) plus `cursor: { batchSize: 100 }`, and open that path's connection from it, so each request still opens one connection. Document on that serverless client that it is used only by that path and that reads through its connections hang behind Cloudflare Hyperdrive. Behind real Cloudflare Hyperdrive that path hangs, because reads with cursors on hang there; the other paths do not. If the path must work behind real Hyperdrive, do not create the second serverless client and accept buffered reads on it instead. Never put the `cursor` option on the serverless client every path uses. On a connection from the streaming serverless client, a `for await` over a read must end before the next query through `db`; a query inside the loop waits forever, because the cursor holds the connection's only database connection until the loop ends.
2. Delete `cursor: { disabled: true }` from `postgresServerless(...)` options. Unset is now off, and the flag no longer compiles. Delete `disabled: false` and keep the rest: `cursor: { disabled: false }` becomes `cursor: {}` (batches of 100), and `cursor: { disabled: false, batchSize: 50 }` becomes `cursor: { batchSize: 50 }`. Leave `cursor: { batchSize: n }` as it is; it means the same as before.
3. Replace the type `PostgresServerlessCursorOptions` with `PostgresCursorOptions`, exported from `@prisma/orm-postgres/serverless` and `@prisma/orm-postgres/runtime`.
4. Update comments and README text that say the serverless client streams through a cursor by default. Say which paths use the streaming serverless client, and that those paths hang behind real Cloudflare Hyperdrive while the other paths do not.

A streaming path, before:

```ts
// src/prisma/db.ts
export const postgres = postgresServerless<Contract>({ contractJson });

// src/worker.ts, in fetch; the /cursor/large path streams with `for await` and breaks early
await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString });
```

After:

```ts
// src/prisma/db.ts
export const postgres = postgresServerless<Contract>({ contractJson });

/**
 * Serverless client with cursors on, used only by the `/cursor/large` route to stream a large
 * result. Reads through its connections hang behind Cloudflare Hyperdrive.
 */
export const streamingPostgres = postgresServerless<Contract>({
  contractJson,
  cursor: { batchSize: 100 },
});

// src/worker.ts
import { postgres, streamingPostgres } from './prisma/db';

// in fetch
const routePostgres = url.pathname === '/cursor/large' ? streamingPostgres : postgres;
await using db = await routePostgres.connect({ url: env.HYPERDRIVE.connectionString });
```

`cursor: { disabled: true }` and the old type, before:

```ts
import postgresServerless, {
  type PostgresServerlessCursorOptions,
} from '@prisma/orm-postgres/serverless';

const cursor: PostgresServerlessCursorOptions = { disabled: true };

export const postgres = postgresServerless<Contract>({ contractJson, cursor });
```

After:

```ts
import postgresServerless from '@prisma/orm-postgres/serverless';

export const postgres = postgresServerless<Contract>({ contractJson });
```

`disabled: false` next to a batch size, before:

```ts
export const streamingPostgres = postgresServerless<Contract>({
  contractJson,
  cursor: { disabled: false, batchSize: 50 },
});
```

After:

```ts
export const streamingPostgres = postgresServerless<Contract>({ contractJson, cursor: { batchSize: 50 } });
```

A batch size alone, before and after (unchanged):

```ts
export const streamingPostgres = postgresServerless<Contract>({ contractJson, cursor: { batchSize: 100 } });
```

## `date-time-default-stored-in-canonical-form`

Each date and time type now stores one text for each value, its canonical form. These three defaults are one instant, and each is stored as `"2024-01-01T00:00:00Z"`:

```prisma
model Event {
  id Int      @id
  a  DateTime @default("2024-01-01T00:00:00Z")
  b  DateTime @default("2024-01-01T00:00:00.000Z")
  c  DateTime @default("2024-01-01T01:00:00+01:00")
}
```

| Column type | Written | Stored before | Stored now |
| --- | --- | --- | --- |
| `DateTime`, `Timestamptz` | `2024-01-01 01:00:00+01` | as written | `2024-01-01T00:00:00Z` (UTC) |
| `Timestamp` | `2024-01-01 12:34:56.500` | as written | `2024-01-01T12:34:56.5` |
| `Date` | `0044-03-15 BC` | as written | `-000043-03-15` |
| `Time` | `12:34` | as written | `12:34:00` |
| `Timetz` | `12:34:56+02` | as written | `12:34:56+02:00` |
| SQLite `DateTime` | `2024-01-01 01:00:00+01:00` | as written | `2024-01-01T00:00:00Z` |

A year outside 0000 to 9999 is a sign and six digits, and year 0000 is 1 BC. `prisma contract infer` and `prisma contract print` print a date or time default in the same form.

1. Search your `.prisma` files for `@default("` on a date or time column.
2. Run `prisma contract emit` and review the diff of `contract.json`. A default whose text changed changes the storage hash. The database does not change: schema verification compares the old and the new text as the same value. Re-emit before you run `prisma db verify` or `prisma db update`. With the earlier `contract.json`, `prisma db verify` names the refusal of a default this version refuses and suggests re-emitting. `prisma db update`, `prisma db init` and `prisma migration plan` refuse to write that default with `CONTRACT.DEFAULT_INVALID`.
3. If you create the database with `prisma db init` or `prisma db update`, `prisma db verify` now reports that the database is signed with the earlier contract. Run `prisma db verify --schema-only` to confirm the schema matches, then `prisma db sign` to sign the database with the re-emitted contract. Sign the database before you deploy the re-emitted contract. Until then the application logs `CONTRACT.MARKER_MISMATCH`, because the database marker holds the earlier storage hash.
4. If you use migrations, `prisma migration plan` refuses with "Contract changed but planner produced no operations", because nothing in the database changes. Run `prisma migration new --name canonical-date-defaults` to write an empty migration from the earlier contract to the re-emitted one, then `prisma db migrate`. When `migration new` cannot tell where to start, pass `--from` with the storage hash of the earlier contract: the `to` hash of your latest migration, which `prisma migration list` shows. Apply the migration before you deploy the re-emitted contract. Until then the application logs `CONTRACT.MARKER_MISMATCH`, because the database marker holds the earlier storage hash.

### SQLite tables created before the upgrade

SQLite compares text byte by byte, so a `DateTime` default must be the same text the application writes for the same instant. Tables and columns created from now on get that text, such as `'2024-01-01T00:00:00.000Z'`. A table created before the upgrade keeps the default text it was created with, such as `'2024-01-01T01:00:00+01:00'` or `'2024-01-01T00:00:00Z'`. Every row that took that default compares and sorts wrongly against rows the application wrote. `prisma db verify` does not report it, because it compares the two texts as the same instant.

Find the rows that hold the old text, and rewrite them to the text the application writes:

```sql
SELECT count(*) FROM "event" WHERE "at" = '2024-01-01T01:00:00+01:00';
UPDATE "event" SET "at" = '2024-01-01T00:00:00.000Z' WHERE "at" = '2024-01-01T01:00:00+01:00';
```

SQLite cannot change a column's default in place, so new rows keep taking the old text until the table is rebuilt. A migration that rebuilds the table, which the planner writes for a change to one of its columns, writes the new default text. Until then, run the `UPDATE` again after inserts that take the default.

## `date-time-default-refused-text`

`prisma contract emit` now refuses a date or time default that its column's type does not hold, with `PSL_INVALID_DEFAULT_LITERAL`:

```text
Field "Event.localAt": pg/timestamp holds no UTC offset, but "2024-01-01T00:00:00Z" has one. Leave it out, as in "2024-01-01T12:34:56".
```

| Refused | Fix |
| --- | --- |
| an offset on `Timestamp`, `Date` or `Time` | remove the offset, or make the column `DateTime` if it holds an instant |
| no offset on `DateTime`, `Timestamptz`, `Timetz` or SQLite `DateTime` | add `Z` for UTC, or the offset, as in `2024-01-01T00:00:00Z` |
| a time on a `Date` column, or a date on a `Time` or `Timetz` column | remove the part the column does not hold |
| more than six digits after the decimal point, or more than three on a SQLite `DateTime`, which holds milliseconds | round to six digits or fewer, or three on SQLite |
| a date or time that does not exist, such as `2024-02-30`, `25:00:00` or `24:00:00` | write a real date or time; for `24:00:00`, write ``@default(sql`'24:00:00'::time`)`` |
| a date outside the range the column's type holds, such as a date before 24 November 4714 BC on Postgres | write a date inside the range the message names |
| a ` BC` suffix on a SQLite `DateTime` | write a signed year, as in `-000043-03-15T00:00:00Z` for 44 BC |

Run `prisma contract emit` after each fix until it succeeds.

A fix that gives the default a different value, such as a rounded time or another date, also changes the default the database holds. That needs a real migration: plan one with `prisma migration plan`, or run `prisma db update`. The empty migration and `prisma db sign` of `date-time-default-stored-in-canonical-form` cover only a new text for the same value.

## `date-time-ts-default-stored-in-canonical-form`

A TypeScript contract stores the same canonical form as PSL. The codecs whose value is a `Date` or database text now write it:

```typescript
createdAt: field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z')),
// stored before: "2024-01-01T00:00:00.000Z"; stored now: "2024-01-01T00:00:00Z"
```

A `*String` preset or column helper default is read by the column's type the same way PSL text is, so `'2024-01-01 00:00:00+00'` on `field.temporal.timestamptzString()` is stored as `"2024-01-01T00:00:00Z"`. Text the type does not hold is refused with `CONTRACT.DEFAULT_INVALID`, and the message says what is wrong, as in the table above. Defaults on `field.dateTime()` and the other `Temporal` presets were already stored in this form and do not change. A `Temporal` default with digits below one microsecond, such as `Temporal.Instant.from('2024-01-01T00:00:00.123456789Z')`, is now refused the same way, because the database holds microseconds; round it to six digits.

1. Search your contract files for `.default(` on the presets and helpers named above.
2. Run `prisma contract emit` and review the diff of `contract.json`.
3. Sign the database or record an empty migration, as steps 3 and 4 of `date-time-default-stored-in-canonical-form` describe.

## `mongo-create-returns-stored-document`

This change has no detection pattern: it depends on what the code does with the value `create()` or `createAll()` returns.

Code that relied on getting its input objects back, such as a `Long`, `Int32`, `Double` or `Uint8Array` inside a `Bson` field, or a key missing for a nullable field it did not pass, now gets the values a read returns. Compare with what a read returns, or keep a reference to the input instead.

## `mongo-reads-decode-includes-value-objects-and-absent-fields`

This change has no detection pattern: it depends on the fields and the data.

Remove code that converted driver classes by hand in included documents or composite-type fields, such as `author._id.toHexString()`, `karma.toBigInt()` or `new Uint8Array(avatar.value())`: they now arrive as a hex string, `bigint`, decimal text and `Uint8Array`, as their types say. Replace checks like `user.name === undefined` for an optional field that Prisma 6 or the driver left out of the document with `user.name === null`.

## `mongo-where-filter-expressions-encoded`

The pattern finds filter expressions written inside `where(...)`; also check expressions built elsewhere and passed to the ORM's `where()`. Leave filters passed to the query builder's `match()` as they are.

For each field filter, pass the field's application value: a `bigint` for an `Int64` field, decimal text for a `Decimal128` field, a hex string or an `ObjectId` for an `ObjectId` field, and an integer in the signed 32-bit range for an `Int32` field. A value that is not a `MongoValue`, such as a `bigint`, an `ObjectId` or a driver `Long`, goes in a `MongoParamRef` from `@prisma/orm-mongo/value`: write `MongoFieldFilter.gt('views', new MongoParamRef(5n))` in place of `MongoFieldFilter.gt('views', Long.fromNumber(5))` or `5`. A value the field's codec refuses now fails with `RUNTIME.ENCODE_FAILED` before the query runs; before, it was sent as is. A filter on a `Bson` field with an `ObjectId`, `Long` or `Decimal128` now matches the stored value; before, it matched nothing.

## `mongo-codecs-check-value-types`

This change has no detection pattern: which writes carry such values depends on the data.

Pass each field's application type: a string for `String`, a boolean for `Bool`, a valid `Date` for `Date`, and a 24-digit hex string or an `ObjectId` for `ObjectId`. Remove `null` elements from lists before writing them; a list field's elements cannot be `null`.

## `mongo-list-elements-encoded`

This change has no detection pattern: it applies to every list field.

Remove workarounds for list fields that failed to write, such as declaring an `ObjectId[]` field as `String[]` or `Bson`.

## `mongo-query-builder-bson-values-match`

This change has no detection pattern: filters that matched nothing do not look different in code.

Remove workarounds for query-builder filters that compared with a driver class and matched nothing, such as running those queries through the driver's own collection.

## `mongo-upsert-keeps-create-values`

This change has no detection pattern: it depends on which fields `create` sets.

Remove code that corrected such a field after an upsert inserted a document. If an upsert whose `create` sets such a field pulls by a match document, pull a single value instead, or leave the field out of `create` so the update default applies.

## `mongo-writes-check-int32-enum-and-null-values`

This change has no detection pattern: which writes carry such values depends on the data.

Round a number before writing it to an `Int32` field, or declare the field `Double` or `Int64`. Map any value outside an enum, such as a Prisma 6 member name like `'ADMIN'` where the stored value is `'admin'`, to one of the enum's values. The error's `details.allowed` lists them. Instead of writing `null` to a required field, write a value, or declare the field optional (`String?`) when documents may hold `null`.

## `contract-source-warnings-are-diagnostics`

This change has no detection pattern: scripts that read the CLI's output are not TypeScript sources.

A script that read contract source warnings from `contract emit --json` or `contract print --json` message lines of the form `warning <path>:<line>:<column> <CODE> <message>` reads the result envelope's `diagnostics` instead. Each has `code: 'CONTRACT.SOURCE_DIAGNOSTIC'`, `severity: 'warn'`, `where: { path, line }` and `meta: { code, span }`, where `meta.code` is the source's code and `meta.span.start.column` the column.

## `mongo-ts-preset-field-not-optional`

Remove `.optional()` or `.many()` from each match. A field a preset fills cannot be optional or a list; to keep an optional timestamp that nothing fills, use `field.date().optional()`.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the embedded `version` moving to `8.0.0-rc.14`; any other difference in the emitted files comes from an earlier entry in this guide.

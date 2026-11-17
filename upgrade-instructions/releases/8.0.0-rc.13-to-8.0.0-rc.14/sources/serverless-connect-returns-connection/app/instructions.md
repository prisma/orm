---
changes:
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
---

## `serverless-connect-returns-connection`

`postgresServerless(...).connect({ url })` used to return a `Runtime`. It now returns a **connection** with the members of a `postgres()` client except `connect`: `sql`, `raw`, `enums`, `nativeEnums`, `context`, `contract`, `stack`, `orm`, `runtime()`, `transaction(fn)`, `prepare(...)`, `close()` and `[Symbol.asyncDispose]`. It is not a `Runtime`: it has no `query` or `execute`. `db.runtime()` returns the runtime. A connection owns one database connection, and `await using` still closes it when the scope ends.

The **serverless client** returned by `postgresServerless(...)` still holds no database connection. It now also has `raw`, `enums` and `nativeEnums`.

In each file that imports `@prisma/orm-postgres/serverless`, or that uses the result of its `connect()`:

1. Name the serverless client `postgres` and the connection that `connect()` returns `db`. With these names, code written for a `postgres()` client (`db.orm...`, `db.transaction(...)`, `db.runtime().query(...)`) works unchanged inside a request, as long as every query is awaited before the `await using` scope ends. The connection's `close()` waits until the runtime has been idle for one turn of the event loop, then refuses new work: a lazy ORM read or `db.runtime().query(...)` returned without `await` starts after the close and rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"), while a `first()`, `execute()`, `transaction()` or ORM write returned without `await` keeps the runtime busy from the close onward and completes. Write `return await`. Update every import of the serverless client to the new name.
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

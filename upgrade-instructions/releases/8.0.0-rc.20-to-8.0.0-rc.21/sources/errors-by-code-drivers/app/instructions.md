---
changes:
  - id: close-ends-the-client-not-your-pool
    summary: |
      `close()` on a Postgres or Supabase client built on a pool or `pg.Client` you passed in now also closes its runtime, so a runtime you captured with `db.runtime()` before `close()` refuses new work. Your pool or `pg.Client` stays open, as before; end it yourself.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?:postgres|supabase)\(\s*\{[\s\S]*?\b(?:pg|binding|pool|client)\s*[:,}]'
  - id: sqlite-open-failure-is-a-connection-error
    summary: |
      A SQLite database file that cannot be opened (a missing directory, or a file that is not a database) is now a connection error (`SqlConnectionError`), not a query error (`SqlQueryError`), in the driver. Code that caught the query error to handle a bad database path catches the connection error instead.
---

# Postgres and SQLite errors are classified by code

## `close()` with a pool or client you passed in

When you pass your own `pg.Pool` or `pg.Client` to `postgres()` or `supabase()`, `close()` on the Prisma client now also closes its runtime. Calls on `db` already failed after `close()`; what changes is a runtime you captured with `db.runtime()` before `close()`, which used to keep working and now refuses new work. Your pool or client is still yours: Prisma never ends it. If you used a captured runtime after `close()`, create a new Prisma client on the same pool instead:

```ts
await db.close();
const db2 = postgres({ contract, pg: pool });
```

A `pg.Client` you pass in may be connected or not: Prisma connects it if it has not started connecting. If its connection is lost, create a new `pg.Client`; a pg client cannot reconnect.

## SQLite open failures

When the SQLite database file cannot be opened, the driver now raises a connection error (`SqlConnectionError`) instead of a query error (`SqlQueryError`).

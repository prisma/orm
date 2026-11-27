# ADR 337 — A SQL driver does not resend a statement after its connection fails

**Status:** Accepted
**Date:** 2026-11-27
**Domain:** Adapters / Targets
**Related:** [ADR 159 — Driver Terminology and Lifecycle](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md) (how a driver ensures a connection is its own choice), [ADR 210 — Prepared Statements](ADR%20210%20-%20Prepared%20Statements%20-%20Author%20Surface%20and%20Driver%20SPI.md) (the one statement a driver sends again: a re-prepare after the server lost a prepared statement), [Adapters & Targets](../subsystems/5.%20Adapters%20&%20Targets.md)

## At a glance

An application hands its own pool to the client. The process pauses, as a platform that pauses idle instances does, and the pool's one connection dies while idle. Nothing tells the process, so the pool still lists the connection as idle.

```ts
const pool = new pg.Pool({ connectionString, max: 1 });
const db = postgres({ contract, pg: pool });

await db.orm.public.User.select('id').all(); // the pool now holds one idle connection

// The process pauses; the connection dies while idle.

await db.orm.public.User.select('id').all(); // works
```

The second read works because the driver checks the idle connection before it sends the read. The check fails, so the driver evicts the connection, takes a new one, and sends the read on that. The read is sent once.

If the connection dies after the read was sent, the driver does not send the read again. The caller gets a `SqlConnectionError`. An application that wants a retry retries its own unit of work:

```ts
import { SqlConnectionError } from '@prisma/orm-family-sql/errors';

async function readUsersWithOneRetry() {
  try {
    return await db.orm.public.User.select('id').all();
  } catch (error) {
    if (!SqlConnectionError.is(error) || error.transient !== true) throw error;
    return await db.orm.public.User.select('id').all();
  }
}
```

Here the work is a read, which the application knows is safe to run twice. For a write, only the application can say whether a second run is safe.

## Decision

**A SQL driver does not resend a statement after its connection fails.** This covers every statement a caller sent, read or write, inside or outside a transaction.

What to use instead:

- **The driver checks an idle connection before it uses it.** A pooled driver confirms that a connection which sat idle is alive before it sends a caller's statement on it. The Postgres driver does this itself. The MySQL and MariaDB drivers do it through their connector, which checks a connection idle for over 500 ms by default.
- **An application that wants a retry retries its own unit of work.** Only the application knows whether a statement that may have run is safe to run again.

The record is scoped to SQL drivers. The MongoDB driver resends reads and writes by its own protocol (`retryReads`, `retryWrites`), which the MongoDB server makes safe, and this record does not change that.

## Why

A connection can fail after the statement reached the server. The server may have run it, committed it, or be running it still. The driver cannot tell which. Sending it again can insert a row twice, charge twice, or run a migration step twice. SQLAlchemy's documentation says of this case that "data is silently lost" when a pool retries.

A check before use removes most of the failures that a resend would hide, without that risk. The common failure is a connection that died while idle: a paused process, or a NAT or load balancer that dropped the connection with no FIN or RST reaching the client. A pool keeps such a connection as idle until the process writes to it. Checking it before the caller's statement finds it dead while nothing of the caller's has been sent.

What the check does not cover still fails with `SqlConnectionError`: a connection that dies between the check and the statement, or while a statement runs.

## Statements the driver sends that the user did not write

The project intent promises no hidden extra round trips. A driver may still send a statement the user did not write when it changes no data and no session state the caller can see. Its README lists each one. For the Postgres driver today:

- the session-settings statement, which sets the settings the target declares on a connection that does not start with them;
- `BEGIN` and `COMMIT` around a cursor stream outside a transaction, which keep the cursor's portal alive;
- the liveness check: an empty statement on a pooled connection that sat idle, or the session-settings statement when it is due.

## Prior art

| Project | Check on checkout | Resends a statement |
| --- | --- | --- |
| pgx (Go) | Default on: ping if idle over 1 s | Only when zero bytes were written |
| HikariCP | Default on: if idle over 500 ms, limit 5 s | No |
| MariaDB Node connector | Default on: ping if idle over 500 ms, limit 250 ms | No |
| PgBouncer | Empty query if idle over 30 s | No |
| Rails ActiveRecord | Default on: `;` if idle over 2 s, unless the first statement is safe to repeat | Only statements marked safe to repeat |
| SQLAlchemy | Opt-in ping; a failure also invalidates older pooled connections | No |
| Django, psycopg pool | Opt-in | No |
| Drizzle, Kysely, Knex, Sequelize, TypeORM, Prisma 7 pg adapter, node-postgres, postgres.js | No | No |

## Consequences

- A request no longer fails, or waits with no limit, because the pool handed the driver a connection that died while idle.
- A busy application pays nothing: a connection used within the last second is used without a check.
- A connection that fails between the check and the statement still fails that statement. The application sees it as `SqlConnectionError` and decides what to do.
- Each statement the driver sends on its own account is listed in its README, so the extra round trips are documented and bounded.

## Alternatives considered

- **Resend once on a fresh connection.** It hides more failures, but it runs a statement twice whenever the first attempt reached the server. The driver cannot know whether it did.
- **Resend only statements marked safe to repeat**, as Rails does. It needs a way to mark a statement, and every mark is a promise the author must keep correct as the statement changes. The check before use already covers the case that matters most, with no marking.
- **An opt-in check.** The failure it prevents hits an application the first time a platform pauses it, before anyone knows to turn the check on. The check costs nothing on a busy connection, so it is on for every pooled connection, with no option.
- **The check in pg-pool's `verify` hook.** pg-pool runs `verify` only for a connection it has just opened, never for one it hands out again from idle, which is the one that can be dead.

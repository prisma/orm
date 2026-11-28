# ADR 333 — The runtime's marker check only warns

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Runtime & Execution
**Supersedes:** in [ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md), the last sentence of the 2026-11-20 amendment ("A read that cannot reach the database still fails the call with `CONTRACT.MARKER_READ_FAILED`"), the strict-mode refusals under "Verification modes" and "Drift handling", and, for the runtime only, the statement that a singleton-shape marker fails when read

## At a glance

An application starts against a database whose marker row was written in a form this release cannot decode. Its first query:

```ts
const db = postgres({ contract, url, log });
const users = await db.orm.public.User.select('id').all();
```

The runtime reads the marker once, before its first use of the database. The row cannot be decoded, so it logs one line and runs the query:

```ts
log.warn({
  code: 'CONTRACT.MARKER_ROW_CORRUPT',
  scope: 'marker-verification',
  expected: { storageHash: '6b46…', profileHash: '9d1f…' },
  actual: null,
  message: 'Contract marker in database could not be decoded',
  error: { code: 'CONTRACT.MARKER_ROW_CORRUPT', message: '…', why: '…' },
});
```

`users` holds the rows.

## Decision

The check that compares a running application's contract with the database's marker never stops the application. Every outcome other than a match is a `warn`-level log line, and the query runs:

| What the check finds | Log code |
| --- | --- |
| The marker's hashes differ from the contract's | `CONTRACT.MARKER_MISMATCH` |
| No marker | `CONTRACT.MARKER_MISSING` |
| The marker row cannot be decoded | `CONTRACT.MARKER_ROW_CORRUPT` |
| The marker cannot be read, for any other reason | `CONTRACT.MARKER_READ_FAILED` |

The check runs once for each runtime instance, before the runtime's first statement or the first connection it takes to hold. A check that ends in any row of this table is that one check, including a marker that could not be read. It is not tried again.

A read that fails with a connection error is not an outcome of the check. A connection error is a `SqlConnectionError`, or a structured error coded `DRIVER.CONNECTION_FAILED` or `DRIVER.NOT_CONNECTED`; the runtime goes by the error's type or code, never by its message. The call rejects with that error, nothing is logged, and the next call makes the check.

The drivers decide what is a connection error. A server that does not answer, a refused connection and a connection lost during the read are connection errors. So is a SQLite database that is busy or locked. A PostgreSQL or MySQL server that answers and refuses the sign-in, reports that the database does not exist, or has no connection to spare raises a statement error. That is a marker that cannot be read: the check warns once and is not tried again, and the user's query then fails with the server's own error.

`verifyMarker: false` still skips the check.

An application that passes no `log` sees these warnings on the console: the runtime's default logger passes each one to `console.warn`, which in Node writes to standard error ([ADR 340](ADR%20340%20-%20The%20client%20logs%20to%20the%20console%20when%20given%20no%20log.md)). An application that wants them elsewhere passes `log`, and one that wants none passes a logger whose methods do nothing.

## Why

The marker is a record Prisma keeps for itself. A later release of Prisma 8 must work with a database an earlier one set up, and an application must never stop serving queries because of Prisma's own records. A marker that is unreadable says nothing about whether the application's tables match its contract. Refusing to run would turn a diagnostic into an outage, and the user could do nothing about it while the application is down.

The check is a diagnostic, not a safeguard. A database that lacks a table or column the contract names fails the query that needs it, with the database's own error. A difference the database does not report, such as a changed nullability or type, runs unnoticed whether the check warns or fails. `prisma db verify` is the command that finds it.

A read that failed with anything other than a connection error is not tried again on later calls. Such a failure rarely goes away by itself: a role with no `SELECT` on the marker table would add a failing read to every call.

A connection error is treated differently for two reasons. The user's query would most likely meet the same error, and rejecting at once spares the call a second wait for the connection timeout. And an application that starts before its database server does still gets its check, and its mismatch warning, once the server answers.

A logger that throws does not fail the call either. The runtime discards an error from `log.warn` during the check.

## What does not change

The control plane still stops on a marker it cannot read or decode. `prisma db verify`, `prisma db migrate` and `prisma db sign` report `CONTRACT.MARKER_READ_FAILED` and `CONTRACT.MARKER_ROW_CORRUPT` as errors, because they are about to act on what the marker says. An operator who wants a deploy to stop on drift runs `prisma db verify` in the deploy.

## Alternatives considered

- **Fail the call on an unreadable marker, warn on drift.** It stops an application for a failure in a record the application does not use.
- **A strict mode that refuses to run.** ADR 021 described one. The runtime has none, and `prisma db verify` serves the operator who wants a deploy to stop.
- **Read again on each call until one read completes, then warn once.** Rejected for a read that reached the database: a failure that does not go away adds a failing read to every call.
- **Warn when the database cannot be reached, and let the query fail by itself.** Rejected: the first call waits for the connection timeout twice, and the check is used up before it ever reached the database.

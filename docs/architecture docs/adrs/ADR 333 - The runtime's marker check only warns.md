# ADR 333 — The runtime's marker check only warns

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Runtime & Execution
**In force from:** the first release candidate after `8.0.0-rc.25`
**Supersedes:** in [ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md), the last sentence of the 2026-11-20 amendment ("A read that cannot reach the database still fails the call with `CONTRACT.MARKER_READ_FAILED`"), the strict-mode refusals under "Verification modes" and "Drift handling", and, for the runtime only, the statement that a singleton-shape marker fails when read

## At a glance

An application starts against a database whose marker row was written in a form this release cannot decode. Its first query:

```ts
const db = postgres({ contract, url, log });
const users = await db.orm.user.select({ id: true }).all();
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

The check runs once for each runtime instance, before the runtime's first statement or the first connection it takes to hold. A check that failed counts as that one check. It is not tried again.

If the database cannot be reached at all, the check logs `CONTRACT.MARKER_READ_FAILED` and the user's own query then fails with the driver's own error.

`verifyMarker: false` still skips the check.

## Why

The marker is a record Prisma keeps for itself. A later release of Prisma 8 must work with a database an earlier one set up, and an application must never stop serving queries because of Prisma's own records. A marker that is unreadable says nothing about whether the application's tables match its contract. Refusing to run would turn a diagnostic into an outage, and the user could do nothing about it while the application is down.

A query against a database that really does not match the contract fails on its own, with the database's error for the table or column that is missing.

A failed read is not tried again on later calls. With no failure to recover from, a retry would only repeat the warning on every call for as long as the marker stays unreadable.

## What does not change

The control plane still stops on a marker it cannot read or decode. `prisma db verify`, `prisma db migrate` and `prisma db sign` report `CONTRACT.MARKER_READ_FAILED` and `CONTRACT.MARKER_ROW_CORRUPT` as errors, because they are about to act on what the marker says. An operator who wants a deploy to stop on drift runs `prisma db verify` in the deploy.

The runtime's default logger discards warnings. An application sees them when it passes `log`.

## Alternatives considered

- **Fail the call on an unreadable marker, warn on drift.** It stops an application for a failure in a record the application does not use.
- **A strict mode that refuses to run.** ADR 021 described one. The runtime has none, and `prisma db verify` serves the operator who wants a deploy to stop.
- **Retry a failed read on the next call.** Rejected for the reason above.

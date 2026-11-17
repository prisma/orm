# ADR 307 — No recovery resets or drops a database

**Status:** Accepted
**Date:** 2026-10-23

## Decision

No error, document or skill recommends resetting or dropping a database to fix a migration, marker or contract problem. Prisma 8 has no reset operation. A database can always be moved, in one of two ways:

- **`db update`**, which plans the operations that make the live database satisfy a target contract, runs them, and signs the database. It is for a database whose migration history does not need to be kept: a local, development, staging or preview database, shared or not.
- **Authored migrations**, for a database that changes only through migrations, such as production.

The commonest case is a database whose marker names a contract that is not in the migration graph:

```text
✖ The database is at a contract that is not in the migration graph (MIGRATION.MARKER_MISMATCH)
  why  The database's marker names 267755c4…, which no migration in migrations/app starts or ends at. After 9f1e02ab…, the last graph contract it reached, it applied 20261013T0910_request_description, which is no longer on disk.
  next Unless this database changes only through migrations, as production does, move it with db update; its data stays:
         prisma db update --to 4b1c…e09a --dry-run --db <url>
         prisma db update --to 4b1c…e09a --db <url>
       Otherwise plan a migration from 9f1e02ab… to its current contract, then one to 4b1c…e09a, and deploy again.
```

The error gives both recoveries; the condition on the first says which kind of database each is for.

## Why

A reset loses data that no migration needs to lose. When any text allows one, an agent that has run out of ideas reaches for it, and a database whose data mattered is lost.

A reset is also never needed. `db update` moves a database to any contract it can name, whatever its marker says, asking before it loses data. Authored migrations move a database whose changes must be reviewed. Between them they cover every state a database can be in, including a marker outside the migration graph, the case where a reset most often looks like the only option, because no migration can start from a contract outside the graph.

## Consequences

- The reset recoveries and the "auto-reset" development policy in [ADR 123](ADR%20123%20-%20Drift%20Detection,%20Recovery%20&%20Reconciliation.md) are superseded. Where ADR 123 lists a reset, use `db update` or an authored migration, chosen as above.
- A database whose data does not matter is still moved with `db update`, not reset. The rule has no exception for disposable data.
- [ADR 287](ADR%20287%20-%20Prisma%208%20has%20no%20db%20push%20to%20production.md) still holds: production changes only through migrations. Its wording that `db update` is for development only is superseded: `db update` is for any database whose migration history does not need to be kept.
- No revisit-if condition is recorded.

## Alternatives considered

- **A reset command for development databases.** Rejected: `db update` already moves any database to any contract it can name, and a reset command would be the option agents reach for on databases whose data matters.
- **Recommending a reset only where the data is disposable.** Rejected: neither the CLI nor an agent can tell from a connection whether a database's data matters.

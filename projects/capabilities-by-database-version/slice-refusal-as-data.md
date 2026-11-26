# Slice: the refusal of a database is data the CLI renders

Part of slice 3 of [plan.md](plan.md) ("Signing checks the database"). The operator settled the design and the wording on 2026-11-26, and approved the framework change it needs. This brief is our best effort: if the code shows part of it is wrong, say so with the evidence.

## Why

Today the PostgreSQL package writes the refusal as finished prose, with branches for each case, and the SQL family files it under the mismatch cause "the database differs". The CLI prints that prose and then its general drift advice, which tells the user to run `db update`. That command cannot upgrade a server. The message also claims a version the contract "requires", which the code infers from capabilities. And a capability the installed table does not know is dropped before the check, so the database is signed and nothing is said.

## Outcome

- A database that does not provide what the contract requires is reported as its own kind of failure, carried to the CLI as data, not prose.
- The CLI renders it, the same way for every database, and prints no `db update` line or other drift advice for it.
- A capability that neither the target's table nor the client's adapter and driver declare is reported by the client, not dropped.
- The contract keeps storing capability keys only. The message never needs the version its author stated.

## The data

One failure holds a list of findings. Each finding is one of:

- **Missing capabilities:** the database's version as it reports it (`15.4`), and the capabilities it lacks, each with the first version of the target's table that provides it.
- **Older than supported:** the database's version and the oldest version the target supports.
- **Version not read:** the database's version could not be read.

The database's name (`PostgreSQL`) is data from the target. The framework names no database.

## The wording (settled)

Missing capabilities, one sentence per highest first version:

> Your contract requires database capabilities first available in PostgreSQL 17 (sql.mergeReturning), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove the capabilities from your contract: state version 15, and take them out of its capabilities list if it lists them.

**Built differently:** capabilities nothing in the table knows are not a signing finding. Signing cannot tell them from capabilities the application's driver provides, because every PostgreSQL control descriptor declares none and the stack that migrates is not the application's. The client's check, which knows its adapter and driver, reports them at compile time and at start.

Older than supported, and version not read: keep today's text, rendered from the data.

## Where it applies

`db verify`, `db sign`, and the runner behind `db init`, `db update` and `db migrate`, each through the same data and the same rendering. Other drift issues in the same run keep their current advice.

## Not in this slice

The general drift advice for other mismatches (`db update` or "change the contract") is a guess about the user's workflow and is often wrong for a project that uses migrations. That is recorded in [deferred.md](deferred.md), not fixed here.

## Tests

- The target turns a contract's capabilities, its table and a server version into the findings, for each kind, including several first versions and a server between two rows. A test with a table whose rows differ.
- The CLI renders each kind exactly as worded above, and prints no `db update` line when the only failure is this one; when other drift issues are present, theirs still print.
- A capability no row names is not a signing finding; the client reports it. Every flag the table names is on in some row, so no database capability is checked nowhere.
- `db sign`, `db verify` and the runner's refusal each produce the rendered text.

## Records

The spec section 5.1, the plan, and the decision record on capabilities (ADR 335) are updated by the orchestrator.

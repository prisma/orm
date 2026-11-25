# Capabilities by database version: preliminary design

Status: preliminary, 2026-11-18. Will Madden owns this work. It records a design discussion and is not yet a spec. No code has been written.

## The problem

A contract lists the capabilities the application depends on, such as `sql.returning` or `sql.lateral`. The query builder and the ORM client offer a feature only when the contract lists its capability.

Today that list does not describe the user's database. Each adapter has one fixed capability list, and `contract emit` copies it into the contract:

```ts
// packages/3-targets/postgres/2-adapter/src/core/capabilities.ts
export const postgresAdapterCapabilities = Object.freeze({
  postgres: { lateral: true, jsonAgg: true, returning: true /* … */ },
  sql: { returning: true, lateral: true, jsonAgg: true /* … */ },
} as const);
```

Four things follow from this.

1. **One list has to fit every supported version.** The list can only name what the oldest supported version provides. A feature that needs a newer server, such as `MERGE … RETURNING` on PostgreSQL 17, cannot be offered at all. The minimum server version (`POSTGRES_MIN_SERVER_VERSION`, [ADR 222](../../docs/architecture%20docs/adrs/ADR%20222%20-%20Version%20support%20policy.md)) stands in for a statement of which version provides which capability.
2. **Nothing checks the running database.** `db sign` and `db verify` check the schema and the hashes. They do not check that the database provides the contract's capabilities. A PostgreSQL 13 database can be signed, and it fails later with a raw SQL error. Only `orm init --probe-db` compares the server version with the minimum, and it only warns.
3. **The profile hash in the marker proves nothing about the database.** The profile hash is a hash of the target, the family and the capability list. Signing records it, and the runtime compares it at connect time. Since the list comes from the adapter package and not from the database, a match shows only that the same list was signed.
4. **The runtime ignores the contract's list.** `createExecutionContext` (`packages/2-sql-family/5-runtime/src/sql-context.ts`) merges the capabilities of the target, the adapter, the driver and the extensions over the contract's capabilities. The stack wins. A runtime stack with more capabilities than the contract was emitted with turns them on.

This matters most for MySQL and MariaDB, where behaviour changes between versions, and not only by addition.

## What a capability flag is

Agreed 2026-11-25.

A capability flag is a yes-or-no fact about the environment that a query client, such as the SQL query builder or the ORM client, reads to decide what it offers or how it writes a query. The capability layer does not say which. Only the client knows whether it changes its interface, its behaviour, or both, depending on a flag.

The facts come from three places:

1. **The database itself:** the engine, its version, and the service it runs on. MySQL has no `RETURNING`. `MERGE … RETURNING` needs PostgreSQL 17. A managed service such as Aurora can differ from the version it reports.
2. **How that database is configured:** server settings, such as MySQL's `sql_mode` or the `GROUP_CONCAT` length limit behind `sql.jsonAggWithoutTruncation`, and topology, such as a MongoDB replica set, which transactions need.
3. **The connection:** the adapter, the driver and the transport. It can narrow what the database offers: an HTTP driver or PgBouncer in transaction mode allows no interactive transactions or no session state. It may also widen it, with batching or pipelining. With SQLite the driver embeds the engine, so it decides the first kind too.

Kinds 1 and 2 describe the database. They are in the contract and its profile hash, and signing checks them. Kind 3 describes one connection to that database. A database is often migrated over a direct connection and queried by the application over a pooler or an HTTP driver, so kind 3 belongs to the runtime stack, not to the contract.

Adding operations and data types is not a capability. It goes through the operation registry and the codecs. The flags extensions declare today (`pgvector.cosine`, `postgis.geometry`, `paradedb/bm25`, in each extension's `descriptor-meta.ts`) are read by nothing and are removed. How an extension's operation depends on the version of the database extension installed, such as HNSW indexes needing pgvector 0.5, belongs to the extension system.

## The design

### The contract states capabilities, never a version

The contract keeps a list of capability keys, as today. It does not store a database version. A capability is the requirement; a version is one way a database comes to satisfy it.

Consequences:

- A contract emitted for PostgreSQL 15 can be signed on PostgreSQL 17 unchanged.
- Upgrading the database does not change the contract or its hashes.
- The framework compares two capability sets. It never reads or compares a version, so version knowledge stays inside each target.

### A target offers one profile per supported version

A profile is the target as one database version provides it: the same target, with only the capabilities that version has. The capability list stops being one list per adapter and becomes one list per profile.

A behaviour that a later version drops is a capability the later profile does not have. Capabilities that describe behaviour already exist, for example `sql.jsonAggWithoutTruncation`, which MariaDB's adapter turns off.

### The user names the profile in the import

There is no default profile. The name the user imports carries the version, for example:

```ts
import { postgres18 } from '@prisma/orm-postgres';
```

The exact names are not decided. The version has to appear at both places where the user selects the target today, because the facade builds the stack inside each of them:

- the config, `defineConfig` from `@prisma/orm-postgres/config`, used by `contract emit` and the other commands;
- the client factory in the application, `postgres<Contract>({ contractJson, url })`.

Why no default:

- A default of the oldest version would give users fewer features than their database has.
- A default of the recommended version would change every user's contract when the recommendation moves.
- With the version in the name, "recommended" is only what the docs and `orm init` write. Moving the recommendation changes no existing project.

The capability types travel with the import. The contract's capability type is already computed from the types of the target, the adapter and the extensions (`DerivedCapabilities` in `packages/2-sql-family/2-authoring/contract-ts/src/contract-types.ts`). A profile with a narrower capability type therefore makes a feature that needs a newer version fail to type-check, with no new mechanism.

### `orm init` writes the profile that matches the database

`orm init --probe-db` already reads the server version. When it has the version, it writes the import for that version. Otherwise it writes the recommended one. A new user on PostgreSQL 16 then does not begin with an error.

### Signing checks the database against the contract

`db sign` runs the same verification as `db verify` (`packages/1-framework/3-tooling/cli/src/control-api/operations/db-sign.ts` calls the introspection and verification of `db-verify.ts`). The capability check goes into that shared verification, so `db verify`, `db sign` and the signing that `db migrate` does all get it.

The check:

1. The framework asks the adapter which capabilities the connected database provides.
2. The adapter reads what it needs from the database. For most capabilities that is the server version. It can also read settings that change behaviour, such as MySQL's `sql_mode`, or which extensions are installed.
3. The framework signs only if the provided set covers the contract's set.

With this check, the profile hash in the marker has a meaning: the database was checked and provides that capability set. The hash stays in the marker.

Because `db verify` runs the check too, a database that loses a capability after signing, for example through a MySQL upgrade, is reported.

### The error speaks in versions

The comparison is in capabilities, but a message such as "your database lacks `sql.jsonAgg`" helps nobody. The target owns the table of which version provides which capability, so it can state the cause in the user's terms:

> Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 15.4. Either upgrade the database, or select the PostgreSQL 15 profile in your config, which turns off the features that need 17.

The advice always has two parts: change the profile, which changes the features available, or upgrade the database. When the cause is not the version, the target names the real cause, for example the `sql_mode` setting.

### The runtime obeys the contract

The runtime stops merging the stack's capabilities over the contract's. The contract's list is the list. The runtime refuses a stack whose capabilities do not cover the contract's, in the same place it already refuses a stack with the wrong target or a missing extension pack (`assertExecutionStackContractRequirements`).

This closes the case where the config names one profile and the application names another.

## Why this lands before GA

It is not purely additive.

- Once the runtime obeys the contract's capability list, a contract whose list differs from what its stack supplied behaves differently.
- If a profile's capability list differs from today's adapter list in any flag, the profile hash changes, and every signed database has to be signed again.
- The names users import change.

## Open

- The names of the versioned exports, at both entry points.
- Which versions get a profile for each target at GA, and which is recommended.
- What the minimum server version constants become once profiles exist. A database older than the oldest profile fails the capability check, so the constants may no longer be needed.
- How an extension pack's capabilities depend on the extension's own version.
- MongoDB: the same design should apply, and has not been checked against the MongoDB family's code.
- Whether [ADR 004](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 031](../../docs/architecture%20docs/adrs/ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md) and [ADR 065](../../docs/architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md) need amending, or one new ADR replaces their capability sections.

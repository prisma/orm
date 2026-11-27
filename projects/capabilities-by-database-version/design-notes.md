# Capabilities by database version: design notes

Status: the design discussion as of 2026-11-25. Will Madden owns this work. [spec.md](spec.md) states what the project delivers and [plan.md](plan.md) its slices; this file holds the reasoning. No code has been written.

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

The contract is where the application states what it requires, so it lists flags of all three kinds. What differs is which step checks them. Kinds 1 and 2 describe the database, and signing checks them. Kind 3 describes one connection to that database, and creating the client checks it. A database is often migrated over a direct connection and queried by the application over a pooler or an HTTP driver, so signing cannot answer for the connection the application will use.

Adding operations and data types is not a capability. It goes through the operation registry and the codecs. The flags extensions declare today (`pgvector.cosine`, `postgis.geometry`, `paradedb/bm25`, in each extension's `descriptor-meta.ts`) are read by nothing and are removed. How an extension's operation depends on the version of the database extension installed, such as HNSW indexes needing pgvector 0.5, belongs to the extension system.

## Scenarios the design must handle

Agreed 2026-11-25.

1. **A new project.** `orm init` connects to the user's PostgreSQL 17 database and sets up the project to match it.
2. **A feature the production database lacks.** The application uses `MERGE … RETURNING`, which needs PostgreSQL 17. Production runs 16. The design decides whether this is caught at type-check, at emit or at signing.
3. **The database is upgraded.** Production moves from PostgreSQL 16 to 17, and the user wants the features 17 adds.
4. **Environments run different versions.** Development runs PostgreSQL 17 locally, and production runs 16.
5. **The database loses a capability.** A backup is restored to an older server, or the application is pointed at a replica that runs an older version.
6. **A service differs from the version it reports.** Aurora, Neon or Supabase report a PostgreSQL version but differ from it in places.
7. **A setting changes behaviour.** MySQL's `sql_mode` changes how queries behave, without any change of version.
8. **A database extension's version matters.** HNSW indexes need pgvector 0.5. This belongs to the extension system, not to capability flags.
9. **The driver decides the engine.** With SQLite the library inside `node:sqlite` or `better-sqlite3` is the engine, so its version decides what is available.
10. **Topology decides a capability.** MongoDB transactions need a replica set. Atlas offers `$vectorSearch`, which a self-hosted server does not.
11. **We add or drop a version.** PostgreSQL 19 is released, or a version reaches end of life and we stop supporting it.
12. **The application connects to a database it has not signed.**
13. **The application queries over a narrower connection than the one it migrates over.** The application uses interactive transactions, so its contract requires them. Migrations run over a direct connection, and that database provides interactive transactions, so signing succeeds. The application then runs on Cloudflare Workers over an HTTP driver, which has no interactive transactions. The application fails to type-check, and at runtime the client reports the mismatch as it reports a signature that does not match.

## The design

### The contract states capabilities, never a version

The contract keeps a list of capability keys, as today. It does not store a database version. A capability is the requirement; a version is one way a database comes to satisfy it.

Consequences:

- A contract emitted for PostgreSQL 15 can be signed on PostgreSQL 17 unchanged.
- Upgrading the database does not change the contract or its hashes.
- The framework compares two capability sets. It never reads or compares a version, so version knowledge stays inside each target.

### Each capability is declared by the component that knows the fact

Agreed 2026-11-25.

| Fact | Declared by | Example |
| --- | --- | --- |
| What the database provides, by version | Target | `MERGE … RETURNING` from PostgreSQL 17 |
| What the connection provides | Driver | Interactive transactions |
| What the adapter can write as a query | Adapter | Whether it can render a lateral join |

The target holds the table of which version provides which capability. A profile is the target as one database version provides it: the same target, with only the capabilities that version has. Whether PostgreSQL 17 has a feature is a fact about PostgreSQL, the same for every adapter, and the table is also where the error message "requires PostgreSQL 17 or later" comes from.

A behaviour that a later version drops is a capability the later profile does not have. Capabilities that describe behaviour already exist, for example `sql.jsonAggWithoutTruncation`, which MariaDB's adapter turns off.

This reverses a recorded position. The [Runtime & Middleware Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md) doc and the rule `.agents/rules/capabilities-ownership.mdc` say capabilities are reported by the adapter and not defined by the target. Today every PostgreSQL flag is declared on the adapter, and the target and driver declare none. The project updates that doc and that rule in place.

### The contract states the version and the connection capabilities it requires

Agreed 2026-11-25. The database version and the capabilities required of the connection both choose the contract's requirements, so they belong where the contract is written, not among the settings for the commands. Emitting turns them into the contract's list of required capabilities. Signing and the client both work from the contract, so the client takes no version and no profile.

**The version** selects which profile of the target the contract is emitted for. It is required and has no default:

- A default of the oldest version would give users fewer features than their database has.
- A default of the recommended version would change every user's contract when the recommendation moves.
- With no default, "recommended" is only what the docs and `orm init` write. Moving the recommendation changes no existing project.

It is written as a version value that the target resolves against its table, such as `17` or `'8.0.19'`, not as a named object per version:

- MySQL and SQLite add features in patch releases (check constraints in MySQL 8.0.16, `RETURNING` in SQLite 3.35), so an object per version would mean dozens of exported names.
- A new database version is a new row in the target's table, not a new export.
- Accepting a profile object as well, for example for a service that differs from the version it reports, can be added later. Going from objects to values could not.

How the target resolves the value is left to the building session.

**The connection capabilities** are those a database version cannot imply, because the driver or adapter provides them. Interactive transactions are the example: the driver provides them, never the database, and a driver that works over HTTP does not declare them. The user passes them in, usually by taking them from the driver the application runs with. When they are omitted, the facade supplies the capabilities of its default driver, which is the driver its client uses by default.

**A contract written in TypeScript** states both in `defineContract`, which already has a `capabilities` input:

```ts
export const contract = defineContract({
  target: postgres({ databaseVersion: 17 }),
  capabilities: neonHttp.capabilities,
  // models…
});
```

**A contract written in the Prisma schema language** cannot state either today: the file names no target and cannot import a driver. For now both are given in the config's contract entry, beside the path to the file. The names below are illustrative:

```ts
import neonHttp from 'prisma-orm-driver-neon-http';

export default defineConfig({
  contract: {
    path: './prisma/contract.prisma',
    databaseVersion: 17,
    capabilities: neonHttp.capabilities,
  },
  db: { connection: env('DATABASE_URL') },
});
```

How it reaches the contract:

1. The facade's `defineConfig` uses the version to pick the target's capabilities for that version.
2. It adds the connection capabilities. By default these are the capabilities of the adapter and driver the facade's client uses at runtime. A project on another driver passes that driver's capabilities, which replace the default.
3. The interpreter receives one capability list through the context the tooling already gives the contract source (`context.capabilities` in `packages/2-sql-family/2-authoring/contract-psl/src/provider.ts`). It never sees a version. It already writes the list into the contract and checks the file against it: a model with `@@check` is rejected when `sql.checkConstraint` is missing.

Not yet confirmed in the code: how the tooling builds that context's capability list from the config's components. The building session confirms it first, since it decides whether this needs any change outside the facade and the SQL family.

This is a compromise. The idiomatic form is syntax in the Prisma schema language, so that the contract file states its own requirements. **By the end of this project that syntax must at least be designed, and preferably built.** When it exists, the config options keep working until the next major version, as the compatibility policy requires.

An earlier draft put the version in the name the user imports (`postgres18`), in the config and again in the client. The client no longer needs it. Hibernate 6 deprecated its versioned dialect classes in favour of a setting; see the [prior art](2026-11-25-capability-prior-art.md).

### `orm init` writes the version that matches the database

`orm init --probe-db` already reads the server version. When it has the version, it writes that version. Otherwise it writes the newest one in the target's table. A new user on PostgreSQL 16 then does not begin with an error.

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

> Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 15.4. Either upgrade the database, or state version 15 for your contract, which turns off the features that need 17.

The advice always has two parts: change the version the contract states, which changes the features available, or upgrade the database. When the cause is not the version, the target names the real cause, for example the `sql_mode` setting.

### The signature is the one check of the database

Agreed 2026-11-25. This is what the subsystem docs already describe ([Data Contract](../../docs/architecture%20docs/subsystems/1.%20Data%20Contract.md), "ProfileHash Computation"): verification checks that the database satisfies the contract's capability requirements and writes the hashes, and the runtime only compares the hashes in the contract with those in the database. The client does not read the database's capabilities again at connect time. A database changed after signing is found by `db verify`.

### The assembled stack is checked against the contract

Agreed 2026-11-25. The family, target, adapter and driver each state what they provide, and their types carry it. The contract's requirements are compared with the assembled stack twice:

- **At compile time.** A stack that does not provide what the contract requires fails to type-check where the client is created.
- **At runtime.** The client compares the requirements in `contract.json` with what the stack's components declare, and reports a mismatch as it reports a signature that does not match.

The runtime stops merging the stack's capabilities over the contract's. The contract's list is the list.

The subsystem docs already describe the runtime check ([Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md), "Capability discovery flow"; [Runtime & Middleware Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md), "Capabilities, Packs, and Codecs"). The code does not do it.

## Why this lands before GA

It is not purely additive.

- Once the runtime obeys the contract's capability list, a contract whose list differs from what its stack supplied behaves differently.
- If a profile's capability list differs from today's adapter list in any flag, the profile hash changes, and every signed database has to be signed again.
- The contract gains a required version, which every existing project must state.

## Settled without further discussion

- **Versions at GA.** PostgreSQL's table covers 15 to 18. "Recommended" is only what `orm init` writes when it cannot read the database: the newest.
- **Minimum server version constants.** They become the first row of the target's table. A database older than that fails signing like any other missing capability.
- **Other targets.** MySQL, MariaDB, SQLite and MongoDB follow the same design, checked against each target's code. They are at Early Access, so PostgreSQL comes first and is the only one GA waits for.
- **Decision records.** The earlier records on the profile hash and on adapter capabilities are updated in place.

## Open

- The syntax in the Prisma schema language for the version and the connection capabilities. It must be designed by the end of the project.
- The form of the capabilities value, so that a driver's declared capabilities can be passed in directly.

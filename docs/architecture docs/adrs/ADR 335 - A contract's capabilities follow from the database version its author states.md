# ADR 335 — A contract's capabilities follow from the database version its author states

**Status:** Accepted
**Date:** 2026-11-26
**Related:** [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 031 — Adapter capability discovery](ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md), [ADR 065 — Adapter capability schema & discovery](ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md), [ADR 222 — Version support policy](ADR%20222%20-%20Version%20support%20policy.md)

## At a glance

A PostgreSQL contract states the version of the database it must run on:

```ts
export const contract = defineContract({
  databaseVersion: 17,
  // models…
});
```

A contract written in the Prisma schema language states it where the config loads the file:

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './prisma/contract.prisma', databaseVersion: 17 },
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

Emitting turns the version into the contract's list of required capabilities. `prisma db sign` then refuses a database that does not provide them. The example supposes a capability, `sql.mergeReturning`, that PostgreSQL has from version 17; today all four supported versions provide the same capabilities:

```text
Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 15.4. Either upgrade the database, or state version 15 for your contract, which turns off the features that need 17. If its capabilities list turns one of them on (sql.mergeReturning), remove it there.
```

## Decision

A contract is the application's statement of the capabilities it requires. Three rules make that statement true of the environment the application runs in.

1. **The author states the environment, and the capabilities follow.** The author states the database version, and optionally the capabilities the connection provides. The version is required and has no default. The contract stores capability keys and never the version.
2. **A signed database provides them.** Verification checks the connected database against the contract's capabilities before a signature is written. The client then checks only the signature.
3. **The client's stack provides them.** The client offers what the contract lists and nothing more. The adapter and driver it is built from are checked against the contract when the code is compiled and when the client is created.

### Each capability is declared by the component that knows the fact

| Fact | Declared by | Example |
| --- | --- | --- |
| What the database provides, by version | Target | `sql.lateral` on PostgreSQL 15 to 18 |
| What the connection provides | Driver | `sql.interactiveTransactions` |
| What the adapter can write as a query | Adapter | None yet for PostgreSQL |

The target holds a table of which version provides which capability (`postgresCapabilitiesByVersion`). Whether PostgreSQL 17 has a feature is a fact about PostgreSQL, the same for every adapter, so the target declares it and the adapter does not. The table is also where the refusal's "requires PostgreSQL 17 or later" comes from.

A capability is a yes-or-no fact that a query client reads to decide what it offers or how it writes a query. New operations and data types are not capabilities; they go through the operation registry and the codecs. Extension descriptors declare no capability flags.

### How the list reaches the contract

The facade resolves the list once: the version's row from the target's table, then the `capabilities` list merged over it in order, keeping the flags that are on. It hands the result to whichever source reads the contract: `defineContract`, the Prisma schema provider, or the Prisma 7 schema provider. Every authoring route therefore produces the same list.

The `capabilities` list is an array of capability sets, each the nested object a component declares. It defaults to the sets of the adapter and the driver the facade's client uses (`defaultConnectionCapabilities`). A list the author writes replaces the default. A later set overrides an earlier one, and `false` turns a flag off.

The control descriptors of the target, adapter and driver declare no capabilities. The framework still merges the capabilities of the config's components into a contract at emit, and with nothing declared that merge adds nothing. The config's adapter and driver are the stack that migrates, not the stack the application runs on, so they have no say in what the application requires.

A config built without the facade's `defineConfig` passes the same resolved list to its contract source itself, with `postgresContractCapabilities({ databaseVersion, capabilities? })`.

### The version is a value

The option is named `databaseVersion`, because a bare `version` in a contract or in the config's contract entry reads as the contract's own version. Its value is one the target resolves against its table, such as `17`. It is not an exported name per version. MySQL and SQLite add features in patch releases, so a name per version would mean dozens of exports, and a new database version is a new row, not a new export.

It has no default. A default of the oldest version would give users fewer features than their database has, and a default of the newest would change every contract when the newest moves.

### Signing checks the database

A SQL target may implement `databaseCapabilitiesNotProvided`, which receives the contract and the introspected database and returns what the database lacks, in the user's terms. The SQL family's schema verification calls it and fails on its answer under its own code, `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`. No control policy and no strict setting can turn that failure into a warning. `db verify` and `db sign` run that verification.

The PostgreSQL runner behind `db migrate`, `db update` and `db init` reads the server's version once and checks every contract space before any space's operations run. It fails with `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED` and sends nothing that changes the database.

Only the flags in the target's table are checked against the database. A server older than the table's first version is refused whatever the contract requires. A server newer than the last version is treated as the last. The adapter reads the version as the number `server_version_num`, never from display text.

### The client checks its stack, and only that

The runtime keeps the contract's capabilities as the contract lists them. It does not merge the capabilities of its target, adapter, driver or extensions over them.

The contract's capabilities that are not the database's must be provided by the adapter's and the driver's sets. The target tells the check which flags are the database's (`databaseCapabilities` on the SQL runtime target descriptor); signing answers for those.

- **At compile time,** creating a client from a contract whose type is known and whose stack lacks a required capability is a type error that names the capability. A helper that passes on a contract type it does not know yet compiles, and is checked at run time.
- **When the client is created,** the same comparison runs on the values in `contract.json` and logs one warning, `CONTRACT.CAPABILITIES_NOT_PROVIDED`. It is reported as a signature that does not match is reported, and `verifyMarker: false` turns both off.

`transaction()` is the first feature that depends on a connection capability. Calling it with a contract that does not list `sql.interactiveTransactions` is a type error, and a refusal at run time.

The client does not read the database's capabilities at connect time. A database changed after it was signed is found by `db verify`.

## Consequences

- **A supported version's row does not change within a major version.** Adding a flag to the row of PostgreSQL 17 would change what every contract for 17 requires without its author changing anything, so a database signed before was not checked against it. Where the profile hash covers the capability list ([ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) says what it covers), every such database would also have to be signed again. A feature that needs a newer database can arrive in a minor release only with a new version row. A test pins each row.
- **The same holds for the default connection list.** Switching to a driver with a different set changes the contract's capabilities and, where the profile hash covers them, its profile hash, so each database is signed again. A hash over only the database's flags would avoid that, at the cost of a hash function that knows which flags are the database's wherever a contract's hashes are computed or verified.
- **All four PostgreSQL rows are equal today.** No feature Prisma supports needs a version above 15. The version is required now because a required option cannot be added after `8.0`.
- **A contract that is given no capabilities gets none.** A config built without the facade that forgets `postgresContractCapabilities` emits a contract with no database flags, and so with fewer features. Nothing refuses it, because the SQL family cannot know that one target's contract should have some.
- **The minimum server version is the oldest supported version, and the table's first row.** `POSTGRES_MIN_SERVER_VERSION` is the oldest entry in the target's list of supported versions (`server-version-range`, which imports nothing, so the `init` entrypoint can read it). The table has one row for each of those versions, and a test checks that its first row is the minimum ([ADR 222](ADR%20222%20-%20Version%20support%20policy.md)).
- **Other targets.** MySQL, MariaDB, SQLite and MongoDB still take their capabilities from their adapters' lists. They follow this design when each is built, including server settings such as MySQL's `sql_mode` and topology such as a MongoDB replica set.

## Alternatives considered

- **An exported name per version (`postgres18`), imported in the config and again in the client.** The client needs no version, since it goes by the contract, and Hibernate 6 deprecated its versioned dialect classes in favour of a setting.
- **The option named `version`.** In `contract: { version: 17 }` it reads as the contract's own version.
- **The version in the command settings (`db: { version }`).** The version chooses the contract's requirements, so it belongs where the contract is written.
- **Naming the runtime driver in the config.** It puts a runtime choice in a file that is about emitting and migrating. A list of capabilities says what it does: it adds requirements to the contract.
- **A version-resolved target descriptor whose `capabilities` are the version's row, merged in by the framework at emit.** A TypeScript contract cannot use it, so it is a second mechanism beside the one that contract needs, and the two disagree: a flag turned off in the list comes back on at emit, and a client built without the facade's config emits a contract with no flags and no error.
- **Reading the database's capabilities when the client connects.** The signature is the one check of the database. A second check costs a query at every start, which matters on serverless platforms.
- **Removing `transaction()` from the type of a client whose contract lacks the capability.** Helpers that wrap a client with a contract type they do not know yet stopped compiling.

# ADR 335 — A contract lists the capabilities it requires

**Status:** Accepted
**Date:** 2026-11-27
**Related:** [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 031 — Adapter capability discovery](ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md), [ADR 065 — Adapter capability schema & discovery](ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md), [ADR 222 — Version support policy](ADR%20222%20-%20Version%20support%20policy.md)

## At a glance

A PostgreSQL contract lists every capability it requires. Prisma exports the list each PostgreSQL version provides and the list the driver's connection provides, and the author spreads them:

```ts
import { defineContract, postgres17, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({
  requiredCapabilities: [...postgres17, ...postgresDriver],
  // models…
});
```

A contract written in the Prisma schema language lists them where the config loads the file, until the schema language has syntax for it:

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres17, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './prisma/contract.prisma',
      requiredCapabilities: [...postgres17, ...postgresDriver],
    },
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma db sign` refuses a database that does not provide what the contract requires of it. The example supposes a capability, `sql.mergeReturning`, that PostgreSQL has from version 17; today all four supported versions provide the same capabilities:

```text
Your contract requires database capabilities first available in PostgreSQL 17 (sql.mergeReturning), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove them from your contract's required capabilities.
```

## Decision

Capabilities are a contract's dependencies. A database version or a connection **provides** a capability, and a contract **requires** it. Those two words are used everywhere, as package managers use them (`Provides` and `Requires` in RPM, `Provide-Capability` and `Require-Capability` in OSGi).

The three rules below are built for PostgreSQL. The other targets follow them when each is rebuilt (see Consequences).

1. **The author writes the whole list.** `requiredCapabilities` holds every capability the contract requires. From `8.0` nothing is implied and there is no default, so a capability a message names is always one the author can find in their own source. A list that is written must not be empty, and each entry must be a capability key (`namespace.flag`); nothing checks which capabilities it names. Until `8.0`, a contract with no list keeps working (see "Projects on a release candidate keep working").
2. **A signed database provides them.** Verification checks the connected database against the contract's database capabilities before a signature is written. The client then checks only the signature.
3. **The client's connection provides the rest.** The client offers what the contract requires and nothing more. The adapter and driver it is built from are checked against the contract when the code is compiled and when the client is created.

### Each capability is provided by one side, and declared by the component that knows the fact

| Fact | Declared by | Example |
| --- | --- | --- |
| What the database provides, by version | Target | `sql.lateral` on PostgreSQL 15 to 18 |
| What the connection provides | Driver | `sql.interactiveTransactions` |

The target holds a table of which version provides which capability (`postgresCapabilitiesByVersion`), and exports each row as a list of keys: `postgres15` to `postgres18`. Whether PostgreSQL 17 has a feature is a fact about PostgreSQL, the same for every adapter, so the target declares it. The table is also where the refusal's "first available in PostgreSQL 17" comes from.

The driver exports the list its connection provides, `postgresDriver`. A connection capability is a fact about the whole path to the database: behind a pooler in transaction mode, the driver can hold a connection for a transaction and the pooler cannot. The driver's list is the usual source, and an author behind such a pooler leaves the capability out. No PostgreSQL capability is a fact about the adapter.

A capability is a yes-or-no fact that a query client reads to decide what it offers or how it writes a query. New operations and data types are not capabilities; they go through the operation registry and the codecs. Extension descriptors declare no capability flags.

### How the list is written and where

A capability in the list is its key, such as `sql.returning`. The author removes one by leaving it out, for example by filtering a version's list. `contract.json` stores the keys the list names and never a database version.

The list belongs in the contract's own source. `defineContract` takes it for a TypeScript contract. The Prisma schema language has no syntax for it yet, so a Prisma schema's list is written in the config's contract entry, and a Prisma 7 schema's in `prisma7Schema(path, { requiredCapabilities })`; both are a stopgap until the syntax exists. Every route hands the same list to the source that reads the contract, so every route produces the same contract.

`prisma orm init` writes the whole list into a new project, from the newest version's list and the driver's.

On PostgreSQL the control descriptors of the target, adapter and driver declare no capabilities. The framework still merges the capabilities of the config's components into a contract at emit, and with nothing declared that merge adds nothing. The config's adapter and driver are the stack that migrates, not the stack the application runs on, so on PostgreSQL they have no say in what the application requires. On MySQL, MariaDB and SQLite that merge still writes the adapter's fixed list into the contract, until each target is rebuilt this way.

### Signing checks the database

A SQL target may implement `databaseCapabilitiesNotProvided`, which receives the contract and the introspected database and returns what the database lacks as data: the database's name and version, and each finding, such as the capabilities it lacks with the first version that provides each. The framework renders that data into the message the CLI prints and the runner's failure carries, and the CLI gives no drift advice for it, because no command changes a server's version. While the database is refused, the CLI also gives no advice for other differences found in the same run: `db update`, `db init` and `db migrate` are refused until the database provides what the contract requires, and the refusal is the first thing to fix. Those differences are still listed, and the next run gives their advice once the refusal is gone. A target that implements the hook must also refuse in its runner, as PostgreSQL's does; otherwise the CLI would withhold advice for commands that would have worked. The SQL family's schema verification calls it and fails on its answer under its own code, `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`. No control policy and no strict setting can turn that failure into a warning. `db verify` and `db sign` run that verification.

The PostgreSQL runner behind `db migrate`, `db update` and `db init` reads the server's version once and checks every contract space before any space's operations run. It fails with `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED` and sends nothing that changes the database.

No message needs a version the author stated: each speaks of the first version that provides a capability, which the table answers. Only the capabilities the table names are checked against the database. A server older than the table's first version is refused whatever the contract requires. A server newer than the last version is treated as the last. The adapter reads the version as the number `server_version_num`, never from display text.

### The client checks its connection, and only that

The runtime keeps the contract's capabilities as the contract lists them. It does not merge the capabilities of its target, adapter, driver or extensions over them.

The target tells the check which capabilities are the database's (`databaseCapabilities` on the SQL runtime target descriptor); signing answers for those. The others must be provided by the connection: the check reads the sets the client's driver and adapter declare, and PostgreSQL's adapter declares none. The PostgreSQL clients run this check. The clients of the other targets do not run it yet.

- **At compile time,** creating a client from a contract whose type is known and whose connection lacks a required capability is a type error that names the capability. A helper that passes on a contract type it does not know yet compiles, and is checked at run time.
- **When the client is created,** the same comparison runs on the values in `contract.json` and logs one warning, `CONTRACT.CAPABILITIES_NOT_PROVIDED`. It is reported as a signature that does not match is reported, and `verifyMarker: false` turns both off.

```text
Your contract requires `sql.interactiveTransactions`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.
```

The client does not read the database's capabilities at connect time. A database changed after it was signed is found by `db verify`.

### A feature the contract declares no dependency on is unavailable

A method or a schema feature that needs a capability the contract does not require is refused. Where the type system can see the need, as with `transaction()`, it is also a type error. Some features need a capability only in some calls and are refused only then: `upsert()` without `sql.insertOnConflictTarget` writes a conflict clause that names no columns, and is refused only when another unique key could collide. Every such refusal has one form, which says the feature is unavailable and how to enable it:

```text
`transaction()` is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. To enable it, add `sql.interactiveTransactions` to your contract's required capabilities.
```

### Projects on a release candidate keep working

A project as the last release candidate left it, with its config, its contract source and its emitted `contract.json` unchanged, keeps type-checking, emitting and running after it upgrades. It gets warnings that say what to change, and no error. Three things make that so, and all three are removed at `8.0`:

- **A missing list gets a default.** The facade uses the list `init` writes, the newest version's and the driver's, and the CLI commands that load the contract's source, `prisma contract emit` among them, warn once (`CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED`) with the exact line and import to add. Loading a contract file outside the CLI, as an application does, prints nothing.
- **Retired capabilities are ignored.** A release candidate's `contract.json` lists flags that nothing read and that this design removed, such as `postgres.jsonAgg`. The PostgreSQL target names them (`retiredCapabilities`), and the client's check skips them, at compile time and when the client is created. A retired flag gates nothing and disappears when the contract is emitted again.
- **A release candidate's contract may call `transaction()`.** No release candidate's contract lists `sql.interactiveTransactions`, because the flag did not exist. A contract that lists a retired flag was emitted by a release candidate, whose clients all offered `transaction()`, so it is allowed.

## Consequences

- **A supported version's list does not change within a major version.** Adding a capability to PostgreSQL 17's list would change what every contract that spreads it requires without its author changing anything, so a database signed before was not checked against it. Where the profile hash covers the capability list ([ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) says what it covers), every such database would also have to be signed again. A feature that needs a newer database can arrive in a minor release only with a new version's list. A test pins each list, and the driver's.
- **All four PostgreSQL lists are equal today.** No feature Prisma supports needs a version above 15. The list is required now because a required input cannot be added after `8.0`.
- **The minimum server version is the oldest supported version, and the table's first row.** `POSTGRES_MIN_SERVER_VERSION` is the oldest entry in the target's list of supported versions (`server-version-range`, which imports nothing, so the `init` entrypoint can read it). The table has one row for each of those versions, and a test checks that its first row is the minimum ([ADR 222](ADR%20222%20-%20Version%20support%20policy.md)).
- **A signature covers only the capabilities the installed table knows.** A key that no row names may be a connection's, so signing does not check it, and the client reports it when it is created. Before `8.0` each key is prefixed by its expected provider, `db.` or `conn.`, and the stored field is renamed `requiredCapabilities`. Signing then refuses a `db.` key its table does not know, and the client checks only `conn.` keys.
- **The kinds of refusal are fixed in the framework.** The data a target returns names its findings: capabilities a version lacks, a server older than supported, a version that could not be read. A target that refuses for another reason, such as MySQL's `sql_mode` or a MongoDB server that is not part of a replica set, needs a new kind and its wording added to the framework.
- **Other targets.** MySQL, MariaDB and SQLite still take their capabilities from the fixed list their adapter declares, which emit writes into the contract. MongoDB's components declare none, so its contracts store none. They follow this design when each is built. A target whose features arrive in patch releases exports a function that returns a version's list in place of a name per version.

## Alternatives considered

- **The author states a version number (`databaseVersion: 17`) and an optional list of connection capabilities with a default.** Built first. The default put capabilities into a contract that its author never wrote, so a message that said "remove it from your contract" pointed at nothing they could see. The number also read as the exact version the database runs, when it is the oldest the contract supports.
- **A default list when none is written, kept for good.** The same hidden requirements, and a default built from the newest version would change every such contract when a newer version is added. A default with a warning is kept only until `8.0`, so that projects on a release candidate do not break.
- **One name for both sides (`capabilities`).** "The contract's capabilities" reads as what the contract can do. Naming the direction is what every dependency manager does.
- **The list in the command settings (`db: { … }`).** The list is what the contract requires, so it belongs where the contract is written.
- **Reading the database's capabilities when the client connects.** The signature is the one check of the database. A second check costs a query at every start, which matters on serverless platforms.
- **Removing `transaction()` from the type of a client whose contract lacks the capability.** Helpers that wrap a client with a contract type they do not know yet stopped compiling.

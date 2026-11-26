# Spec: capabilities by database version

The reasoning, the scenarios and the prior art behind this spec are in [design-notes.md](design-notes.md) and [2026-11-25-capability-prior-art.md](2026-11-25-capability-prior-art.md). This file states what the project delivers. The design is our best effort and strong guidance, not a fixed specification: the purpose in section 1 is fixed, and the mechanisms are open to challenge with evidence.

## 1. Purpose

An application states in its contract which capabilities it requires, and three things are then true:

1. **The requirements describe the user's real environment.** The author writes the list of capabilities the contract requires, from the set a database version provides and the set a connection provides. A feature that needs PostgreSQL 17 is available to a project that requires 17's set and absent, at type-check, from a project that requires 16's.
2. **A signed database provides them.** Signing checks the database against the contract's requirements before it writes the signature. The signature is then the database's promise to satisfy the contract, for every capability the installed table knows, and it is the only check of the database the client makes. A capability the table does not know is reported by the client's check of its stack (point 3).
3. **The assembled stack provides them.** The target, adapter and driver given to the client are checked against the contract at compile time and when the client starts.

Capabilities are dependencies, and the words follow dependency managers: a database version or a connection **provides** a capability, and a contract **requires** it.

Most of this is already what the subsystem docs describe ([Data Contract](../../docs/architecture%20docs/subsystems/1.%20Data%20Contract.md), [Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md), [Runtime & Middleware Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md)). The code does not do it. Writing the list from a version's set is the new part.

## 2. Why before GA

The change is not an addition. Contracts gain or lose capability flags, so profile hashes change and signed databases are signed again. The runtime stops turning on capabilities the contract does not list. The contract's source gains a required list. After `8.0` each of these would need a major version.

It also blocks other GA work: the stored-format work on contract hashes, and the decision on the facade's exported names.

## 3. What a capability flag is

A capability flag is a yes-or-no fact about the environment that a query client reads to decide what it offers or how it writes a query. Adding operations or data types is not a capability; that goes through the operation registry and the codecs.

Each flag is declared by the component that knows the fact:

| Fact | Declared by | Example |
| --- | --- | --- |
| What the database provides, by version | Target | `MERGE … RETURNING` from PostgreSQL 17 |
| What the connection provides | Driver | Interactive transactions |

A connection capability is a fact about the whole path to the database, not only the driver: behind a pooler in transaction mode, the driver can hold a connection and the pooler cannot. The driver's exported set is its usual source. No target has a capability that is a fact about its adapter.

This replaces the recorded position that capabilities are reported by the adapter and not defined by the target.

## 4. Requirements

### 4.1 The contract

- The author writes one list, `requiredCapabilities`, and everything the contract requires is in it. Nothing is implied and there is no default. The list must be present and not empty; that is the only check.
- The target holds a table of which database version provides which capability, and exports each version's set. The driver exports the set its connection provides. The author composes the list from them: `requiredCapabilities: [...postgres17, ...postgresDriver]`. A capability is removed by leaving it out.
- The contract stores capability keys. It never stores a database version.
- The destination is the contract's own source. A contract written in TypeScript states the list in `defineContract`. A contract written in the Prisma schema language states it in the config's contract entry, beside the file path, until the schema language has syntax for it; that entry is a stopgap. The interpreter receives one capability list.
- Syntax in the Prisma schema language is designed before the project closes, and preferably built. When it exists, the config option keeps working until the next major version.
- The flags that extensions declare and nothing reads (`pgvector.cosine`, `postgis.geometry`, `paradedb/bm25`) are removed.
- Before `8.0`, in the pull request after the one that builds the list: the stored field is renamed `requiredCapabilities`, and each key is prefixed by its expected provider, `db.` or `conn.`.

### 4.2 `orm init`

- It writes the whole list, from the newest version's set and the driver's, so a new project's requirements are visible in its own file.

### 4.3 Signing

- The verification shared by `db verify`, `db sign` and the signing in `db migrate` checks that the connected database provides every capability the contract requires that the target's table knows. It signs only if it does. A capability the installed table does not know is checked by the client instead, because signing cannot tell it from one the application's driver provides.
- The adapter reads what it needs from the database: the server version, and settings that change behaviour, such as MySQL's `sql_mode`.
- A failure states the cause in the user's terms, with both remedies. The failure reaches the CLI as data, and the CLI gives no drift advice for it:

  > Your contract requires database capabilities first available in PostgreSQL 17 (sql.mergeReturning), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove them from your contract's required capabilities.

- A database older than the first row of the target's table fails the same check. The separate minimum server version constants go away or become that first row.

### 4.4 The client

- The client takes no version and no capability list. It offers what the contract requires. It stops merging the capabilities of its stack over the contract's.
- A stack that does not provide what the contract requires fails to type-check where the client is created.
- When the client starts, it compares the requirements in `contract.json` with what the stack's components declare, and reports a mismatch the way it reports a signature that does not match, under the same setting:

  > Your contract requires `sql.interactiveTransactions`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.

- A feature whose capability the contract does not require is unavailable, at type-check and at run time, and every such refusal has one form:

  > `upsert()` is unavailable: your contract declares no dependency on `sql.insertOnConflictTarget`. To enable it, add `sql.insertOnConflictTarget` to your contract's required capabilities.
- The client does not read the database's capabilities at connect time. It compares the signature, as today.

### 4.5 Targets

- PostgreSQL is built first and is the only target GA waits for. Its table covers versions 15 to 18.
- MySQL, MariaDB, SQLite and MongoDB follow the same design, checked against each target's code. They are at Early Access.

### 4.6 Records

- The subsystem docs, the rule on capability ownership, and the decision records on the profile hash and on adapter capabilities are updated in place to describe the result.
- The upgrade instructions and the upgrade skill say what a project changes: write the list, emit, and sign again.

## 5. Scenarios

The thirteen scenarios in [design-notes.md](design-notes.md) are the acceptance cases. The project is done when each is handled as the design says, shown by a test or by manual QA against a real database.

### 5.1 Proof that a contract without its version is enough

The contract stores capability keys and not the version its author stated. That holds only if every message a user gets about a database that is too old can still be written in versions. The project is not done until this is shown, for each place a user can meet the problem:

- signing and the commands that change a database;
- starting the application against a database that was never checked, or was checked for another contract;
- a contract whose capabilities the installed PostgreSQL package's table does not know, such as one emitted by a newer release.

For each, the evidence is the real message, produced by a test or by manual QA, and a judgement of whether a user can act on it without knowing what a capability is.

If any of these can only say which capabilities are missing, the contract must store the stated version. That changes the structure of `contract.json`, so it must be decided and built before `8.0`, not after.

**Settled on 2026-11-26: the message needs no stated version.** It says only what the table shows: "Your contract requires database capabilities first available in PostgreSQL 17 (…), but this database runs PostgreSQL 15.4." Signing checks only the capabilities the installed table knows, because the stack that migrates is not the one the application runs on, so it cannot tell an unknown capability from one the application's driver provides. A capability that neither the table nor the client's adapter and driver provides is reported by the client, at compile time and when it starts. The refusal reaches the CLI as data, rendered by the framework ([slice-refusal-as-data.md](slice-refusal-as-data.md)). The remaining evidence is the message at client start against a database that was never checked, or was checked for another contract.

## 6. Out of scope

- How an extension's operation depends on the installed version of a database extension. That belongs to the extension system.
- A profile for a managed service that differs from the version it reports. Signing still catches the difference. Accepting a profile object beside a version value can be added later.
- Detecting the database's capabilities at connect time.

## 7. Known risks

- **The framework domain.** The signing check sits in verification that lives in the framework's tooling. If the check needs a new or changed framework interface, that is raised with the operator before it is built.
- **How the tooling builds the capability list it gives a contract source** has not been read. It decides how much changes outside the facade and the SQL family, and is confirmed first.
- **Hash changes.** Every fixture, example and signed test database changes when the flags move.

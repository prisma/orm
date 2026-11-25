# Plan: capabilities by database version

Delivers [spec.md](spec.md). Each slice is one pull request. The order is the recommended one; the building session may change it with a reason.

## Before the first slice

Confirm two things in the code and record the answers here:

- How the tooling builds the capability list it hands a contract source (`context.capabilities`), and so what must change for a version to select the target's capabilities.
- Whether the signing check can be built on interfaces the framework already has. If it needs a framework change, raise it with the operator before building.

## Slices

1. **Each component declares its own capabilities, and the version selects the target's (PostgreSQL).** The target holds the table of versions. The database flags move from the adapter to the target; the driver declares what the connection provides, including interactive transactions; the adapter declares what it can write. The unread extension flags are removed. `defineContract` and the config's contract entry take the required version and the optional connection capabilities. `orm init` writes the version. Fixtures, examples and their hashes are regenerated. Done when a project on version 16 does not type-check a feature that needs 17, and a project on 17 does.
2. **The client goes by the contract.** The runtime stops merging the stack's capabilities over the contract's. The stack is checked against the contract at compile time and at start, reported as a signature mismatch is. Done when an HTTP driver with a contract that requires interactive transactions fails to type-check and is reported at start.
3. **Signing checks the database.** The shared verification compares what the database provides with what the contract requires, and the error speaks in versions. The minimum server version constants become the first row of the table. Done when signing a PostgreSQL 15 database with a contract for 17 fails with the message in the spec, shown against a real database.
4. **The other targets.** MySQL, MariaDB, SQLite and MongoDB, each checked against its own code. Settings such as `sql_mode` and topology such as a MongoDB replica set are read at signing. GA does not wait for this slice.
5. **Syntax in the Prisma schema language.** The design is required before the project closes. Building it is preferred.
6. **Records and close-out.** The subsystem docs, the capability ownership rule and the decision records are updated in place. The upgrade instructions and the upgrade skill are updated. Each of the thirteen scenarios has its evidence.

Slices 1 to 3 are what GA waits for. Slice 1 changes hashes, so it is coordinated with the stored-format work on contract hashes.

## Must not be lost

- By the end of the project the Prisma schema language syntax is at least designed.

# Plan: capabilities by database version

Delivers [spec.md](spec.md). Each slice is one pull request. The order is the recommended one; the building session may change it with a reason.

## Before the first slice

Confirm two things in the code and record the answers here:

- How the tooling builds the capability list it hands a contract source (`context.capabilities`), and so what must change for a version to select the target's capabilities.
- Whether the signing check can be built on interfaces the framework already has. If it needs a framework change, raise it with the operator before building.

### Answers (2026-11-25, read from the code)

**How the tooling builds the capability list.** The framework builds it from the config's component descriptors, and does so twice:

- `createControlStack` (`packages/1-framework/1-core/framework-components/src/control/control-stack.ts`) merges the `capabilities` of the target, the adapter and the extensions, in that order, later ones winning on the same key. The driver is not included. `askSource` hands the result to the contract source as `context.capabilities`.
- After the source returns, `enrichContract` (`packages/1-framework/3-tooling/cli/src/control-api/contract-enrichment.ts`) merges the same descriptors over the contract's own list. This runs for both authoring routes, so a list a source narrowed would get the descriptors' flags added back.

What follows for the design:

- **The version produces a target descriptor, and the framework stays as it is.** The facade's `defineConfig` resolves the version against the target's table and builds the target descriptor whose `capabilities` are that version's row. This is the design's "a profile is the target as one database version provides it", carried by the interface the framework already merges. No framework code changes. The alternative, a capability list passed around the framework's merge, needs `enrichContract` to stop merging, which is a framework change we do not need.
- **A contract written in TypeScript** gets its version in the facade's `defineContract`, which binds the same version-resolved target. The config of such a project states no version, so its target descriptor declares no database capabilities and the enrichment adds nothing to what the contract already lists.
- **The connection capabilities** cannot come from the driver descriptor at emit, because the control stack leaves the driver out. The facade passes them to the contract source (`prismaContract` gets a capabilities option; `defineContract` gets an input), defaulting to those of the facade's default driver.
- **Correction to the design notes:** `defineContract` has no `capabilities` input today. It was removed, and the PostgreSQL facade also removes `target` and `adapter` from the input and binds its own. The facade's `defineContract` gains `version` and the connection capabilities as new inputs.
- **Correction to the design notes:** the SQL profile hash does not cover capabilities today. `buildSqlContractFromDefinition` passes an empty set, so every PostgreSQL contract has the same profile hash. For a signature to mean "this database was checked for these capabilities", the SQL profile hash must cover the contract's capability list. That is a change to a hash rule. The pull request that fixes the hash rules for Prisma 8 (prisma/orm#31203) makes it, so each rule changes once; this project's slices do not change hash rules. Slice 1 is built on main after #31203 merges, and only changes which capabilities a contract lists.
- **No PostgreSQL flag differs between versions 15 and 18 today.** Every flag the adapter declares holds on 15. The table is built and tested, with rows that are equal at first. The slice's "16 does not type-check a feature that needs 17" is shown in tests with a table that has such a row, until a real feature needs one.
- **Flags nothing reads**, beyond the three extension flags: `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `sql.enums`. They are removed with the extension flags.

**Whether the signing check fits the framework's interfaces.** The check and the refusal to sign do. Two things around it do not:

- The check goes in the PostgreSQL target's schema diff (`diffPostgresSchema`), which the SQL family's `verifySchema` calls. It already receives the contract and the introspected database node, whose `pgVersion` the adapter reads during introspection. `db verify`, `db sign` and the runner behind `db migrate`, `db update` and `db init` all call `verifySchema`, so all refuse. The result type has room for the failure (an issue with its own text, and a result code).
- **The advice the CLI prints** for a failed verification is framework code (`schemaDriftNextActions`), and always offers `db update`, which cannot upgrade a server. A structured error thrown from `verifySchema` would carry its own advice, but the framework's `verifyMigration` catches every throw and keeps only the message. Printing the spec's message with only its two remedies needs one of those two places to change. Raised with the operator.
- **`orm init` writing the probed version** needs a framework change. The probe runs after the files are written and the dependencies installed, because the driver must be installed before it can connect, and the templates of `InitContribution` take no version. Without a change, `init` writes the newest version in the target's table. Raised with the operator.

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

# Deferred: capabilities by database version

Work this project found and did not do. Each item says what is wrong today and what done looks like.

## Docs that still describe capabilities as negotiated when the client connects

ADR 335 decides that a contract lists the capabilities it requires, that signing checks the database, and that the client checks only its connection. These files still say an adapter reports or negotiates capabilities at connect time, or show a PostgreSQL contract or config with no `requiredCapabilities`. Each needs its body edited in place to say what is true now.

- Decision records: ADR 010, 016, 105, 114, 115, 116, 117, 118, 123, 157, 202, 210, 252, 261, 313.
- Subsystem docs: `3. Query Lanes.md`, `6. Ecosystem Extensions & Packs.md`, and the parts of `5. Adapters & Targets.md` outside "Adapter capabilities and discovery". In `5. Adapters & Targets.md` that includes the lines that say extension packs add capability flags, the glossary and startup diagram that show the adapter advertising and negotiating capabilities, and example capabilities that are in no list (`transactionalDDL`, `savepoints`).

## A contract source given no capabilities is not refused

A config built without the PostgreSQL package's `defineConfig` that forgets `postgresContractCapabilities` emits a contract with no database capabilities, and nothing refuses it. Refusing it needs the SQL family to know that a target expects some. Done is a refusal at emit that names the missing call.

## What the ORM client does without interactive transactions

A contract that does not list `sql.interactiveTransactions` gets a refusal from `db.transaction(...)`. The ORM client's own implicit transactions for writes that take several statements, and `connection().transaction()`, are not refused. No driver without interactive transactions exists yet. Done, with the first such driver, is a decision and a refusal or a documented non-atomic behaviour.

## The other databases

MySQL, MariaDB, SQLite and MongoDB contracts take a fixed capability list from their adapter, which also declares `sql.interactiveTransactions` although the driver is the component that knows it. Done is slice 4 of the plan for each.

## `init` writes the newest version, not the server's

`init` writes the newest PostgreSQL version's list into a new project, because `--probe-db` is optional and runs after the files are written and the driver installed. All four versions' lists are equal today. When they differ, a user on an older server gets a refusal at signing that names the capabilities to remove. Done is `init` writing the list for the server's version when `--probe-db` is given, which needs the probe to run before the config is written or the config to be rewritten after it.

## The CLI's general advice after a drift guesses the workflow

After `db verify` or `db sign` finds a database that differs from the contract (a missing table, a wrong column type), the CLI suggests `db update` or changing the contract to describe the database. Both guess how the project changes its database. A project that uses migrations should write a migration, and the database is not always the truth. Done is advice that follows from what the project does, or none where the CLI cannot tell.

## The database refusal travels as a schema issue

Verification reports a database that lacks capabilities as one more issue in its list of schema differences, with its own cause, and the CLI filters it out of the drift output in several places. It is a verdict on the server, not a difference in the schema. Done is a field of its own on the verification result, beside the schema issues, which the CLI and the runner read the same way.

## "Capability" also names an optional family feature

ADR 207 calls an optional method on a family instance a capability (`SchemaViewCapable`, `PslContractInferCapable`), a different concept from the capabilities a contract requires. One user-facing message carries it: `contract infer`'s refusal says "The configured family does not implement the PslContractInferCapable capability". Found in [terminology-review.md](terminology-review.md); outside this project, which is about what a contract requires.

## ADR 065's schema and the subsystem docs' older capability examples

ADR 065's "Capability schema" section and its profile hash formula describe an earlier design: a versioned schema with `schemaVersion` and enum and number values. A contract stores `Record<string, Record<string, boolean>>`, and the profile hash is ADR 004's. `5. Adapters & Targets.md` still lists keys that exist nowhere (`join.lateral`, `index.partial` and others, in its examples after the capability list) and a "Capability stability contract" with reserved namespaces that the code does not have. Done is each describing what the code does, edited in place. Found by the review of this project's documentation; outside what this project changes.

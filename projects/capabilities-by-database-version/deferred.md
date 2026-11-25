# Deferred: capabilities by database version

Work this project found and did not do. Each item says what is wrong today and what done looks like.

## Docs that still describe capabilities as negotiated when the client connects

ADR 335 decides that each capability is declared by the component that knows the fact, that signing checks the database, and that the client checks only its adapter and driver. These files still say an adapter reports or negotiates capabilities at connect time, or show a PostgreSQL contract or config with no `databaseVersion`. Each needs its body edited in place to say what is true now.

- Decision records: ADR 010, 016, 105, 114, 115, 116, 117, 118, 123, 157, 202, 210, 252, 261, 313.
- Subsystem docs: `3. Query Lanes.md`, `6. Ecosystem Extensions & Packs.md`, and the parts of `5. Adapters & Targets.md` outside "Adapter capabilities and discovery".

## The Supabase client's contract is not required to list anything

A config built without the PostgreSQL package's `defineConfig` that forgets `postgresContractCapabilities` emits a contract with no database capabilities, and nothing refuses it. Refusing it needs the SQL family to know that a target expects some. Done is a refusal at emit that names the missing call.

## What the ORM client does without interactive transactions

A contract that does not list `sql.interactiveTransactions` gets a refusal from `db.transaction(...)`. The ORM client's own implicit transactions for writes that take several statements, and `connection().transaction()`, are not refused. No driver without interactive transactions exists yet. Done, with the first such driver, is a decision and a refusal or a documented non-atomic behaviour.

## The other databases

MySQL, MariaDB, SQLite and MongoDB contracts take a fixed capability list from their adapter, which also declares `sql.interactiveTransactions` although the driver is the component that knows it. Done is slice 4 of the plan for each.

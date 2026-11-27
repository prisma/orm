# ADR 331 — Stored files carry a format version, and a reader refuses one it does not know

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Amends:** [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md) and [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md): `migration.json` and ref files carry `formatVersion`

Within Prisma 8, a later release reads every file an earlier release wrote, and the user regenerates nothing after an upgrade. This record is the part of that promise that concerns the files in a user's repository.

## At a glance

Every file Prisma writes into a user's repository and reads back later says which version of its format it is in:

```json
// contract.json, and each copy under migrations/snapshots/<hash>/
{ "formatVersion": 1, "targetFamily": "sql", "target": "postgres", "...": "..." }
```

```json
// migrations/app/20261124T0900_add_phone/migration.json
{ "formatVersion": 1, "from": "6c26…", "to": "6b46…", "providedInvariants": [], "createdAt": "2026-11-24T09:00:00.000Z", "migrationHash": "9d1f…" }
```

```json
// migrations/app/refs/production.json
{ "formatVersion": 1, "hash": "6b46…", "invariants": [] }
```

A developer on `8.3` opens a repository where a teammate on `8.5` has planned a migration that uses something `8.5` added. `8.5` wrote that `migration.json` with `formatVersion: 2`. On `8.3`, every command that reads it stops:

```text
MIGRATION.FORMAT_VERSION_NEWER
The migration file (migration.json) "migrations/app/20270301T1000_add_search/migration.json" was written by a newer release of Prisma
It is in format version 2, and this release of Prisma reads format version 1 only.
Upgrade Prisma to the release that wrote the file, or a later one, and run the command again.
```

Nothing else in the file is interpreted, and nothing is changed in the repository or the database.

## Decision

### Which files

- `contract.json`, and each contract snapshot, which is a copy of one.
- `migration.json`. Its version also covers the `ops.json` beside it: the two files are one migration, and `ops.json` is a bare array with nowhere to put a field.
- Ref files, including an extension space's `head.json`.

The field is `formatVersion`, a positive integer.

The marker and the ledger are database records, not files, and get no format version.

### What a reader does with the version

A reader looks at `formatVersion` before anything else in the file.

- **A version it knows:** it reads the file. A release reads every format version an earlier release in the same major wrote.
- **A version higher than any it knows:** it stops and says the file was written by a newer release of Prisma. It interprets nothing else in the file.
- **No version, or a value that is neither a version it knows nor a higher integer:** it stops, unless the file is one a pre-release wrote (below). The reader does not guess. For a file an extension package ships, it says to upgrade the extension. For a file in the repository that no release wrote, it says to restore the file from version control. A file can be made again only after it is deleted, or for a migration its folder, because every command that reads it refuses it while it is there: the emitted contract is emitted again, a ref is set again, and a migration is planned again only if no database has applied it. A contract snapshot can only be restored, because no command rewrites one.

This holds for every read: a command that changes nothing, the runtime loading `contract.json`, and a contract, migration or ref that an extension package ships inside itself. A command or client entry point that accepts either a contract Prisma built in memory (from the TypeScript builder or by reading a file) or a file's content tells them apart this way: a value with no format version field, whose `storage` is an object Prisma constructed and not parsed JSON, is a built contract. It prints that contract in the current format and reads the result back. Anything else is read as a file. A function that reads a file always expects the file: a serializer's `deserializeContract`, the snapshot writer and an extension's `contractJson` refuse a built contract.

### Files a pre-release wrote

A pre-release of Prisma 8 wrote these files without `formatVersion`: a contract or snapshot has `"schemaVersion": "1"` in its place, and a `migration.json` or ref file has neither field. Only a pre-release wrote these, so they are recognised without guessing. A contract with neither field is refused, because no release wrote it.

A release before `8.0.0` reads such a file as format version 0 and converts it to version 1 in memory. Nothing is written back; the file becomes version 1 the next time a command writes it. Version 0 has a converter and no printer, so no release writes it. `8.0.0` and later do not read version 0: a file without `formatVersion` is refused, with advice to follow the upgrade instructions of each release since the one that wrote it, which rewrite the files. A test fails if a release that is not a pre-release still reads version 0.

Version 0 of a contract, a `migration.json` or a ref means the file as the newest pre-release wrote it. A file from an earlier pre-release first needs the upgrade steps of each release since the one that wrote it; the contract reader names the step for content it no longer accepts. The operations in `ops.json` are the exception, described below: every shape a pre-release wrote is read.

Converting a version 0 ref drops any key a ref does not have, because the pre-releases that wrote it ignored such a key. This is the one place a reader accepts a key no release wrote. The upgrade script drops the same keys and lists each one.

Until `8.0.0` the content of format 1 is not final. A pre-release may still change it, and the upgrade instructions of that release say what a user does. From `8.0.0`, a change to a format is a new format version.

### A reader refuses a field it does not know

A reader refuses a field the format does not define. Because every reader is strict, a release cannot add a field to a format without raising its version.

The rule covers everything Prisma interprets. It stops at content Prisma carries for someone else, where any key is accepted. These are the open places:

- **In a contract:** `meta`; each extension's own section under `extensions`; `capabilities`, a map of flags a later release may add a name to (ADR 335), so a reader meets names it does not know and treats each as its own rules say; `_generated`; the parameters of a generator; the value of a literal default; an index's `options`, which belong to the index type; and the MongoDB documents a contract hands to the database as they are, such as a collection's validator and an index's partial filter. A type's parameters belong to its codec, whose own schema refuses a key it does not define; for a codec the stack registers, that check is made when a command reads a contract, and in the SQL family also when a client builds the codec. The MongoDB client does not use type parameters and does not check them.
- **In a SQL operation:** a step's `params`, which are values handed to the database driver; the operation's `meta`; the entries of a step's `meta` that no reader acts on; and a codec's `typeParams` inside a mark, which belong to the codec. The entries of a step's `meta` that a reader acts on are strict.
- **In a MongoDB operation:** the documents handed to the database as they are, such as a filter, an update and a pipeline; a query plan's `resultShape`; and the entries of a plan's `meta` that no reader acts on, `annotations` among them.

So a release that makes a reader act on something inside one of these, for example a new entry in a step's `meta`, must raise the format version, because an earlier reader would not notice the entry.

A command reads strictly the contracts and snapshots it interprets in that run: the contract a plan starts from and the one it plans to, the contract a database is verified or signed against, the snapshot a ref names when a command starts from or ends at that ref, and the contract a run of `db migrate`, `db update` or `db init` ends at. `migration check` reads strictly every snapshot something will interpret: the one each ref names and the one at each end of a migration graph. A snapshot a command only records or identifies by its hash is not read: the database commands record the snapshot of each migration they apply as it is stored, and `migration status`, `list`, `graph` and `ref set` use hashes only. Whoever interprets such a snapshot later reads it strictly then. Recording is not interpreting: the failure the rule prevents is acting on content that is only partly understood, and a project with a snapshot in a shape no reader of this release reads must still be able to apply its migrations.

A command that cannot read a stored file names the file and the reason, and never reports it as unknown or missing. It refuses when it acts on the file. A command that only lists or checks (`migration list`, `graph`, `status` and `check`) reports the file and goes on with the rest. One command goes on past a file it acts on: `db update`, when the snapshot of the contract the database was last at cannot be read, warns and continues as it does for a database with no recorded origin.

Operations are read strictly by everything that acts on their statements or commands: the runners, the statement preview, and the checks a recorded path gets before it is applied. `migration status`, `list`, `graph` and `check` read the fields every target shares and do not read a target's own fields. For `status`, `list` and `graph` that is all they use. `migration check` is meant to say whether a migration is sound, but it can pass one that `db migrate` then refuses for a target's own field.

### Format 1 of `ops.json` reads every shape a pre-release wrote

From `8.0.0` no release may change a migration's hash, and `ops.json` is covered by that hash. So from `8.0.0` an earlier shape of an operation in a migration can only be read, never rewritten, and format 1 must read it for the whole major. Before `8.0.0` the shapes pre-releases wrote could still have been rewritten by an upgrade script, because the rules that compute a contract's hashes change once before `8.0.0`, and every migration hash with them. They are read instead, because that is small and needs no step from a user.

Where a shape differs from the current one, the reader turns it into the current one before it checks the operation, so nothing after the reader sees an earlier shape. The migration hash is computed from the file as stored.

- SQLite: a `schema` of `"main"` in an operation's target details is dropped. Any other `schema` is refused.
- PostgreSQL and SQLite: a `rowsHoldingValue` mark that has only `enumValue`, `value` and `codecRef` gets its table and column from the operation's target details and its stored value from the check's first parameter. A mark that cannot be completed this way is dropped.
- MongoDB: the `sort` and `returnDocument` of a raw find-and-update command and the `sort` of a raw find-and-delete command are read and applied. A pre-release dropped them when it read the migration, so a migration it applied without them can change a different document when it is applied again.

### What a writer does

A release writes the oldest format version that can hold the data. A file that uses nothing a newer version added is written in the older version, so an earlier release can still read it.

### The format version is not part of the migration hash

The version describes how the JSON is written, not what the migration does. The migration hash leaves `formatVersion` out of its input, as it leaves out `migrationHash`. The same migration written in two format versions has the same hash.

### How the code is arranged

For each version of each kind of file there is one unit of code. The newest version's unit has a parser, which turns a file in that version into the document Prisma works with in memory. An older version needs no parser, because a file in it is converted to the newest version before it is parsed. Every version a release writes has a printer, which writes that document in that version.

- **Reading.** One shared function reads the version number and reports the refusals above. It then converts the document to the newest version, and the caller parses it with the newest version's unit. Every read takes this one path. The contents of a contract differ between families, so each family owns its contract units; the units for `migration.json` and ref files live with the migration tooling.
- **Converting.** Each version after the oldest has a function that turns a document of the version before it into one of its own, and a document is converted one version at a time. Because the shared reader runs the conversions, a read path that holds a file before any family sees it (the CLI's contract reader, the snapshot store, an extension's bundled files) passes on only the newest version. The conversion of a contract from version 0 changes only the version field, which every family's contract has in common, so it lives with the shared reader. A contract version that changes content one family owns needs each family to declare its own contract format, made of the shared steps and its own, and those read paths to take the format from the family.
- **Writing.** While a release writes one version of a file, the writer prints that version. From the second version on, the writer tries the oldest first, and a printer either produces a complete document or reports that its version cannot hold the data; it never leaves something out. A printer that wrongly reports this only makes the writer choose a higher version, which an older release refuses outright, so no release is handed a file it misreads.
- **Operations.** Each family owns the reader of its operations. The SQL family's reader takes from each target a schema for the target's own fields, the step marks only that target reads, and a conversion for the target's earlier shapes. The readers run where operations are acted on. They are not given the file's format version, so the first change to an operation format has to pass it to them.
- **Testing.** For the newest version: print, parse the result, and get the same data back. A saved file of every earlier version still reads.

### What an author outside this repository owes

The rule binds whoever defines a stored shape. A family reads a stored contract through `convertContractDocument`, which reads the version and converts an earlier one, and writes into the contracts it prints the version this release writes, which while there is one written version is `NEWEST_CONTRACT_FORMAT_VERSION`; both are published at `@prisma/orm-framework/contract/format-version`. An author of a SQL target can check its operation reader with `probeUnknownKeys`, which the SQL family publishes: it adds an unknown key at every place of a saved operation and expects a refusal outside the open places. A family's contract parser and operation reader refuse a key they do not define, outside the open places they declare. A SQL target supplies `readOperations` with a schema for its own fields. An extension pack's schemas for its entry kinds, its codecs' parameters and its index options refuse a key they do not define. Nothing in the framework checks this for them.

## Why

- **The version field and the refusal of a higher version have to be in `8.0.0`.** An `8.0.0` reader stays in use for the life of the major, so it must already know how to recognise a file it cannot read. Neither can be added later. The same holds for strictness: a reader that ignores an unknown key in `8.0.0` ignores it for the whole major.
- **A reader is strict because a migration is an instruction to change a database.** Acting on one that is only partly understood is the failure the rule prevents. A reader that skipped unknown fields would apply a migration while ignoring part of it.
- **A writer chooses the oldest version that holds the data so that newer tooling does not force an upgrade on everyone who reads its files.** An extension author who upgrades their tooling does not make every application that uses the extension upgrade, unless the extension uses something new.
- **Pre-release files are read as version 0, not left to the upgrade instructions alone,** so that a pre-release user rewrites nothing for the format version, and so that conversion runs on real files before the first change to a format after `8.0.0` depends on it.

Git treats a repository's format version this way, and Cargo refuses a lock file in a format it does not know and keeps an existing lock file in its old format when nothing needs the new one.

## Consequences

- An earlier release fails clearly on a file it cannot read, instead of reporting a validation error or reading the file wrongly.
- A project whose members are on different releases of the same major keeps working until someone uses a feature that needs a newer format. From then, everyone who reads that file upgrades.
- Adding an optional field to any of these files is a format change. It needs a new version unit, and a saved file of every earlier version must still read.
- A hand-edited file with a stray key is refused, in a contract, a migration or a ref.
- An index's `type` and `options` are checked when a contract is built, not when it is read, so an option an index type does not define is accepted from a stored contract.
- The open places depend on the author of a change knowing that a reader now acts on something inside one. No test finds that.
- `migration check` can pass a migration whose operations `db migrate` then refuses for a target's own field, because the framework loads `ops.json` and reads only the fields every target shares. The refusal names the migration and the operation.

## Alternatives considered

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it.
- **Keep the name `schemaVersion` for the field.** Rejected: "schema" means the database's schema everywhere else in the project.
- **Each addition says whether an older reader may ignore it.** Rejected as too complex: someone would have to judge that correctly for every field ever added. The writing rule serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.
- **Refuse a pre-release file and leave it to the upgrade instructions.** Rejected while pre-releases continue: every pre-release user would rewrite every stored file for a change that adds one field, and the conversion path would first run on real files only after `8.0.0`.
- **Rewrite an earlier shape of an operation with an upgrade script.** Possible before `8.0.0` and not chosen: reading the shapes is small and needs no step from a user. From `8.0.0` it is not possible, because a migration's hash may not change.
- **Read operations strictly when the framework loads `ops.json`.** Not chosen here: the framework would have to ask the family to read each operation, which adds to the framework. It would let `migration check` refuse what `db migrate` refuses and let every refusal name the migration file.
- **A version inside `ops.json`.** Rejected: the file is a bare array, and it is never read apart from its `migration.json`.
- **A format version on the marker and the ledger.** Rejected: they are records Prisma keeps in the database, and their form is identified another way.

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

### What a reader does

A reader looks at `formatVersion` before anything else in the file.

- **A version it knows:** it reads the file. A release reads every format version an earlier release in the same major wrote.
- **A version higher than any it knows:** it stops and says the file was written by a newer release of Prisma. It interprets nothing else in the file.
- **No version, or a value that is neither a version it knows nor a higher integer:** it stops. For a file in the repository it names the upgrade instructions; for a file an extension package ships, it says to upgrade the extension. Only a pre-release of Prisma 8 wrote a file with no version, including a contract that has a `schemaVersion` field in the place of `formatVersion`. The reader does not guess.

This holds for every read: a command that changes nothing, the runtime loading `contract.json`, and a contract, migration or ref that an extension package ships inside itself. A command or client entry point that accepts either a contract Prisma built in memory (from the TypeScript builder or by reading a file) or a file's content tells them apart this way: a value with no format version field, whose `storage` is an object Prisma constructed and not parsed JSON, is a built contract. It prints that contract in the current format and reads the result back. Anything else is read as a file. A function that reads a file always expects the file: a serializer's `deserializeContract`, the snapshot writer and an extension's `contractJson` refuse a built contract.

A reader refuses a field it does not know. Because every reader is strict, a release cannot add a field to a format without raising its version.

The rule covers everything Prisma interprets. It stops at content Prisma carries without interpreting, where any key is accepted:

- in a contract: `meta`, `capabilities`, each extension's own section under `extensions`, the parameters of a type or of a generator, the value of a literal default, an index's `options`, and the MongoDB documents handed to the database as they are, such as a collection's validator and an index's partial filter;
- in a SQL operation: a step's `params`, the operation's `meta`, and the entries of a step's `meta` that no reader acts on;
- in a MongoDB operation: the documents handed to the database as they are, such as a filter, an update and a pipeline.

So a release that makes a reader act on something inside one of these, for example a new entry in a step's `meta`, must raise the format version, because an earlier reader would not notice the entry.

A SQL operation is read strictly by everything that acts on its statements: the runners, the statement preview, and the checks a recorded path gets before it is applied. The commands that only list or compare migrations (`migration status`, `list`, `graph` and `check`) read the fields every target shares and do not read a target's own fields.

### What a writer does

A release writes the oldest format version that can hold the data. A file that uses nothing a newer version added is written in the older version, so an earlier release can still read it.

### The format version is not part of the migration hash

The version describes how the JSON is written, not what the migration does. The migration hash leaves `formatVersion` out of its input, as it leaves out `migrationHash`. The same migration written in two format versions has the same hash.

### How the code is arranged

For each version of each kind of file there is one unit of code: a parser, which turns a file in that version into the document Prisma works with in memory, and a printer, which writes that document in that version. While there is one version, the in-memory document and the version's own shape are the same; a later version adds its own shape where it differs.

- **Reading.** One shared function reads only the version number and reports the two refusals above. The caller then picks the unit for that version. The contents of a contract differ between families, so each family owns its contract units; the units for `migration.json` and ref files live with the migration tooling.
- **Writing.** The writer tries the oldest version first. From the second version on, a printer either produces a complete document or reports that its version cannot hold the data; it never leaves something out. A printer that wrongly reports this only makes the writer choose a higher version, which an older release refuses outright, so no release is handed a file it misreads.
- **Converting.** A unit offers functions that turn a document of an earlier version into its own. Where one exists for the version on disk it is used directly; otherwise the document is converted one version at a time.
- **Testing.** For each version: print, parse the result, and get the same data back. A saved file of every earlier version still reads.

While a file has one version, there is nothing to try in order and nothing to convert; both come into use with the first change to a format, and constrain only the releases after it.

## Why

- **The version field and the refusal of a higher version have to be in `8.0.0`.** An `8.0.0` reader stays in use for the life of the major, so it must already know how to recognise a file it cannot read. Neither can be added later.
- **A reader is strict because a migration is an instruction to change a database.** Acting on one that is only partly understood is the failure the rule prevents. A reader that skipped unknown fields would apply a migration while ignoring part of it.
- **A writer chooses the oldest version that holds the data so that newer tooling does not force an upgrade on everyone who reads its files.** An extension author who upgrades their tooling does not make every application that uses the extension upgrade, unless the extension uses something new.

Git treats a repository's format version this way, and Cargo refuses a lock file in a format it does not know and keeps an existing lock file in its old format when nothing needs the new one.

## Consequences

- An earlier release fails clearly on a file it cannot read, instead of reporting a validation error or reading the file wrongly.
- A project whose members are on different releases of the same major keeps working until someone uses a feature that needs a newer format. From then, everyone who reads that file upgrades.
- Adding an optional field to any of these files is a format change. It needs a new version unit, and a saved file of every earlier version must still read.
- Ref files are strict, so a hand-edited ref with a stray field is refused.

## Alternatives considered

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it.
- **Keep the name `schemaVersion` for the field.** Rejected: "schema" means the database's schema everywhere else in the project.
- **Each addition says whether an older reader may ignore it.** Rejected as too complex: someone would have to judge that correctly for every field ever added. The writing rule serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.
- **A version inside `ops.json`.** Rejected: the file is a bare array, and it is never read apart from its `migration.json`.
- **A format version on the marker and the ledger.** Rejected: they are records Prisma keeps in the database, and their form is identified another way.

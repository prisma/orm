# ADR 331 — Stored files carry a format version, and a reader refuses one it does not know

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**In force from:** the first release candidate after `8.0.0-rc.25`
**Supersedes:** the name `schemaVersion` for the field in `contract.json`, and the shapes of `migration.json` and of a ref file shown in [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md) and [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md), which each gain `formatVersion`

Within Prisma 8, a later release reads every file an earlier release wrote, and the user regenerates nothing after an upgrade. This record is the part of that promise that concerns the files in a user's repository.

## At a glance

Every file Prisma writes into a user's repository and reads back later says which version of its format it is in:

```json
// contract.json, and each copy under migrations/snapshots/<hash>/
{ "formatVersion": 1, "targetFamily": "sql", "target": "postgres", "...": "..." }
```

```json
// migrations/app/20261124T0900_add_phone/migration.json
{ "formatVersion": 1, "from": "6c26…", "to": "6b46…", "migrationHash": "9d1f…", "providedInvariants": [], "createdAt": "2026-11-24T09:00:00.000Z" }
```

```json
// migrations/app/refs/production.json
{ "formatVersion": 1, "hash": "6b46…", "invariants": [] }
```

A developer on `8.3` opens a repository where a teammate on `8.5` has planned a migration that uses something `8.5` added. `8.5` wrote that `migration.json` with `formatVersion: 2`. On `8.3`, every command that reads it stops:

```text
MIGRATION.FORMAT_VERSION_NEWER
The migration file "migrations/app/20270301T1000_add_search/migration.json" was written by a newer release of Prisma
It is in format version 2, and this release of Prisma reads format version 1 only.
Upgrade Prisma to the release that wrote the file, or a later one, and run the command again.
```

Nothing else in the file is interpreted, and nothing is changed in the repository or the database.

## Decision

### Which files

- `contract.json`, and each contract snapshot, which is a copy of one.
- `migration.json`. Its version also covers the `ops.json` beside it: the two files are one migration, and `ops.json` is a bare array with nowhere to put a field.
- Ref files, including an extension space's `head.json`.

The field is `formatVersion`, a positive integer. The contract's earlier `schemaVersion` field is this field under an old name. The name changed because "schema" means the database's schema everywhere else in the project.

The marker and the ledger are database records, not files, and get no format version. How Prisma's own tables change between releases is decided separately.

### What a reader does

A reader looks at `formatVersion` before anything else in the file.

- **A version it knows:** it reads the file. A release reads every format version an earlier release in the same major wrote.
- **A version higher than any it knows:** it stops and says the file was written by a newer release of Prisma. It interprets nothing else in the file.
- **No version:** it stops and names the upgrade instructions. Only a pre-release of Prisma 8 wrote such a file. The reader does not guess.

This holds for every read: a command that changes nothing, the runtime loading `contract.json`, and a contract, migration or ref that an extension package ships inside itself. A command or client entry point that accepts either a contract Prisma built in memory (from the TypeScript builder or by reading a file) or a file's content does not check the built contract; it tells the two apart by storage, which in a built contract is an object Prisma constructed rather than parsed JSON. A function that reads a file always expects the file: a serializer's `deserializeContract`, the snapshot writer and an extension's `contractJson` refuse a built contract.

A reader never skips a field it does not know. A migration is an instruction to change a database, and acting on one that is only partly understood is the failure this rule prevents. Because every reader is strict, a release cannot add a field to a format without raising its version.

### What a writer does

A release writes the oldest format version that can hold the data. A file that uses nothing a newer version added is written in the older version, so an earlier release can still read it. An extension author who upgrades their tooling therefore does not force every application that uses the extension to upgrade, unless the extension uses something new.

### The format version is not part of the migration hash

The version describes how the JSON is written, not what the migration does. The migration hash leaves `formatVersion` out of its input, as it leaves out `migrationHash`. The same migration written in two format versions has the same hash.

### How the code is arranged

For each version of each kind of file there is one unit of code: a parser, which turns a file in that version into the document Prisma works with in memory, and a printer, which writes that document in that version. While there is one version, the in-memory document and the version's own shape are the same; a later version adds its own shape where it differs.

- **Reading.** One shared function reads only the version number and reports the two refusals above. The caller then picks the unit for that version. The contents of a contract differ between families, so each family owns its contract units; the units for `migration.json` and ref files live with the migration tooling.
- **Writing.** The writer tries the oldest version first. A printer either produces a complete document or says it cannot hold the data. It never leaves something out. If the choice errs, it picks a version higher than was needed, which an older release refuses outright; no release is ever handed a file it misreads.
- **Converting.** A unit offers functions that turn a document of an earlier version into its own. Where one exists for the version on disk it is used directly; otherwise the document is converted one version at a time.
- **Testing.** For each version: print, parse the result, and get the same data back.

`8.0.0` has one version of each file, so trying versions in order and converting are not built yet. They arrive with the first change to a format and constrain only later releases. The version field and the refusal of a higher version cannot be added later, because an `8.0.0` reader stays in use for the life of the major.

## Consequences

- An earlier release fails clearly on a file it cannot read, where before it reported a validation error or read the file wrongly.
- A project whose members are on different releases of the same major keeps working until someone uses a feature that needs a newer format. From then, everyone who reads that file upgrades.
- Adding an optional field to any of these files is a format change. It needs a new version unit, and the saved samples of earlier versions must still read.
- Ref files are strict, so a hand-edited ref with a stray field is refused.

## Alternatives considered

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it.
- **Each addition says whether an older reader may ignore it.** Rejected as too complex: someone would have to judge that correctly for every field ever added. The writing rule serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.
- **A version inside `ops.json`.** Rejected: the file is a bare array, and it is never read apart from its `migration.json`.
- **A format version on the marker and the ledger.** Rejected: they are records Prisma keeps in the database, and their form is identified another way.

Git treats a repository's format version this way, and Cargo refuses a lock file in a format it does not know and keeps an existing lock file in its old format when nothing needs the new one.

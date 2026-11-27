# ADR 331 — Stored files carry a format version, and a reader refuses one it does not know

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Amends:** [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md) and [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md): `migration.json` and ref files carry `formatVersion`

From `8.0.0`, a later release of Prisma 8 reads every file an earlier release wrote, and the user regenerates nothing after an upgrade. This record is the part of that promise that concerns the files in a user's repository.

## At a glance

Every file Prisma writes into a user's repository and reads back later says which version of its format it is in:

```json
// contract.json
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

A developer on `8.3` opens a repository where a teammate on `8.5` has planned a migration that uses something `8.5` added. `8.5` wrote that `migration.json` with `formatVersion: 2`. On `8.3`, every command that loads it stops:

```text
✘ [MIGRATION.FORMAT_VERSION_NEWER] The migration file (migration.json) "/home/dev/shop/migrations/app/20270301T1000_add_search/migration.json" was written by a newer release of Prisma
  why: It is in format version 2, and this release of Prisma reads format version 1 only.
→ Upgrade Prisma to the release that wrote the file, or a later one
```

Nothing else in the file is interpreted, and nothing is changed in the repository or the database.

## Decision

There are four rules. The sections after this list say exactly what each one covers.

1. **Each stored file carries `formatVersion`,** a positive integer.
2. **A reader checks the version before anything else, and refuses one it does not read.** This holds for every command that loads the file.
3. **A reader refuses a field the format does not define.** This holds wherever a command interprets the file's content.
4. **A writer writes the oldest version that can hold the data.**

Two more rules cover the files that pre-releases of Prisma 8 wrote, which have no `formatVersion`:

5. **Until `8.0.0`, such a file is read as format version 0 and converted in memory.** `8.0.0` refuses it.
6. **An operation in a shape a pre-release wrote is read for the whole of Prisma 8.**

### Which files

| File | Notes |
| --- | --- |
| `contract.json` | The contract `prisma contract emit` writes |
| A contract snapshot | A copy of a contract under `migrations/snapshots/<storage hash>/`, kept so that a migration's start and end can be read later |
| `migration.json` | Its version also covers the `ops.json` beside it, which holds the migration's operations: the two files are one migration, and `ops.json` is a bare array with nowhere to put a field |
| A ref file | A file under `refs/` that gives a contract a name, such as `production`. An extension's migrations have one too, `head.json`, which names the extension's newest contract |

Two records Prisma keeps in the database get no format version: the marker, which says which contract the database matches, and the ledger, which lists the migrations applied to it. They are not files.

### Rule 2: the version is checked on every load

A reader looks at `formatVersion` before anything else in the file.

| The file has | The reader |
| --- | --- |
| A version it reads | Reads the file |
| A higher version | Stops, and says a newer release of Prisma wrote the file. It interprets nothing else in it |
| No version, or a value that is not a positive integer, such as `"1"` or `0` | Stops, unless the file is one a pre-release wrote (rule 5). It does not guess |

This holds for every command that loads the file, whatever the command then does with it: a command that only lists migrations, the runtime loading `contract.json`, and a contract, migration or ref that an extension package ships inside itself. A command that loads a migration loads the snapshot the migration ends at, so that snapshot's version is checked too.

Some entry points accept either a stored contract or a contract object that Prisma built in memory, for example the object the TypeScript contract builder returns. They tell the two apart this way: a value that has no format version field and whose `storage` is an instance of Prisma's own storage class is a built contract, and anything else is read as a stored file. A function whose job is to read a stored file refuses a built contract.

### Rule 3: a reader refuses a field the format does not define

Because a reader refuses an unknown field, a release cannot add a field to a format without raising its version.

```text
CONTRACT.VALIDATION_FAILED
Contract structural validation failed: domain.namespaces.public.models.Post.unexpected must be removed
```

**Where the rule stops.** It covers everything Prisma interprets. Some content Prisma carries for someone else, and there any key is accepted. These are the open places.

| File | Open places |
| --- | --- |
| A contract or snapshot | `meta`; `_generated`, the notice the emitter adds; each extension's own section under `extensions`; `capabilities`, to which a later release may add a name ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)); a generator's parameters; a literal default's value; an index's `options`, which belong to the index type; and the MongoDB documents handed to the database as they are, such as a collection's validator and an index's partial filter |
| A SQL operation | A step's `params`, which are values handed to the database driver; the operation's `meta`; the entries of a step's `meta` that no reader acts on |
| A MongoDB operation | The documents handed to the database as they are, such as a filter, an update and a pipeline; a query plan's `resultShape`; the entries of a plan's `meta` that no reader acts on |

A release that makes a reader act on something inside an open place, for example a new entry in a step's `meta`, must raise the format version, because an earlier reader would not notice the entry.

A type's parameters are not an open place. They belong to the type: the schema of its codec, or in MongoDB of its data type, refuses a parameter it does not define. A command applies that schema when it reads a contract, for every type the project's configuration registers.

**Which commands read content strictly.** A command reads strictly the content it interprets in that run. Content it only passes on is not read.

| Command | Reads strictly |
| --- | --- |
| `contract emit`, and a client at startup | The contract |
| `migration plan`, `migration new` | The contract, and the snapshot the plan starts from |
| `db migrate`, `db update`, `db init` | The contract the run ends at, in each space; the snapshot a `--to` ref names; every operation before it runs |
| `db sign`, `db verify` | The contract the database is signed or verified against. For `db sign <ref>`, that is the snapshot the ref names when a migration ends at it |
| `migration show` | The contract; the operations it previews |
| `migration check` | The contract; the snapshot each ref names, the one at each space's head, and the one at each leaf of the migration graph |
| `migration status`, `list`, `graph`, `ref set` | No content. They check versions and hashes |

Two cases follow from "only passes on":

- **A database command records the snapshot of each migration it applies without interpreting its content.** Whoever interprets that snapshot later reads it strictly then. So a project that holds an old snapshot whose content this release cannot read still applies its migrations.
- **`migration status`, `list`, `graph` and `check` read only the operation fields every target shares.** A target's own fields are read by the commands that act on the operations: the runners, the statement preview, and the checks `db migrate` runs on the migrations it is about to apply.

**A command that cannot read a file's content** names the file and the reason, and never reports the file as unknown or missing. What it does next depends on what it does with the file:

| The command | On content it cannot read |
| --- | --- |
| Acts on the file | Refuses |
| Only lists (`migration list`, `graph`, `status`) | Warns, and answers from the rest |
| `migration check` | Reports the file as a finding, and checks the rest |
| `db update`, for the snapshot of the contract the database was last at | Warns and plans without it, as it does for a database with no such snapshot recorded |
| `db migrate`, `db update`, `db init`, for the snapshot of a migration they apply, when it is not JSON or does not match its hash | Warn, apply the migration, and record no contract for it |

A format version the reader does not read is never a content problem: rule 2 applies, and every command stops.

**What the refusal tells the user to do.** Restoring the file from version control always comes first. Where a command writes the file again, the advice names it and says what else that command does:

| File | Written again by |
| --- | --- |
| `contract.json` | `prisma contract emit`, which overwrites it without reading it |
| The snapshot at the application's head | Once its folder is deleted: `prisma db migrate --advance-ref db` when a migration ends at the head, which also applies any pending migrations; `prisma db sign` when none does, which also signs the database |
| The snapshot at an extension's head, or an extension's migration | Once its folder is deleted: `prisma contract emit`, from the installed extension |
| Any other snapshot | Nothing. It can only be restored |
| `migration.json` | `node <migration folder>/migration.ts`, only when the file still parses and has its `createdAt`, so the migration keeps its hash. Otherwise, and only for a migration that no database has applied and that no ref depends on, the folder is deleted and the migration planned again with `prisma migration plan --from <hash of the contract it started from>` |
| A ref other than `db` | `prisma migration ref set <name> <hash>` |

No advice leads to a new hash for a migration a database has applied, or to a `db` ref that names a contract the database is not at.

### Rule 4: a writer writes the oldest version that can hold the data

A file that uses nothing a newer version added is written in the older version, so an earlier release can still read it. If `8.5` adds version 2 of `migration.json` for a new kind of migration, a migration planned on `8.5` that does not use it is still written as version 1, and a teammate on `8.3` reads it.

### Rule 5: files a pre-release wrote are version 0 until `8.0.0`

A pre-release of Prisma 8 wrote these files without `formatVersion`: a contract or snapshot has `"schemaVersion": "1"` in its place, and a `migration.json` or ref file has neither field. Only a pre-release wrote these, so they are recognised without guessing. A contract with neither field is refused, because no release wrote it.

- **Before `8.0.0`,** a release reads such a file as format version 0 and converts it to version 1 in memory. Nothing is written back; the file becomes version 1 the next time a command writes it. No release writes version 0.
- **From `8.0.0`,** a file without `formatVersion` is refused, with advice to follow the upgrade instructions of each release since the one that wrote it. Those instructions include a script that rewrites every stored file to version 1, so a pre-release user runs it before upgrading to `8.0.0`. Tests fail if a release that is not a pre-release still reads version 0.

Version 0 of a contract, a `migration.json` or a ref means the file as the newest pre-release wrote it. A file from an earlier pre-release first needs the upgrade steps of each release since the one that wrote it; the contract reader names the step for content it no longer accepts.

One difference from version 1: converting a version 0 ref drops any key a ref does not have, such as a key someone added by hand, because the pre-releases ignored such a key. The upgrade script drops the same keys and lists each one.

Until `8.0.0` the content of format 1 is not final. A pre-release may still change it, and the upgrade instructions of that release say what a user does. From `8.0.0`, a change to a format is a new format version.

### Rule 6: an operation in a shape a pre-release wrote is read for the whole of Prisma 8

From `8.0.0` no release may change a migration's hash, and `ops.json` is covered by that hash. So from `8.0.0` an operation in a migration can only be read, never rewritten, and format 1 of `ops.json` must read every shape that is in a user's repository by then. Pre-releases wrote three that differ from the current one. The reader turns each into the current shape before it checks the operation, so nothing after the reader sees the earlier shape. The migration hash is computed from the file as stored.

| Shape a pre-release wrote | What the reader does |
| --- | --- |
| SQLite: `"schema": "main"` in an operation's target details | Drops it. Any other `schema` is refused |
| SQL: a `rowsHoldingValue` entry in a step's `meta` with only `enumValue`, `value` and `codecRef`. The entry tells the runner to count the rows that still hold an enum value being removed | Fills in the table and column from the operation's target details and the stored value from the check's first parameter, which is where the pre-release runners read them. Where they cannot be filled in, it drops the entry, as those runners ignored it |
| MongoDB: `sort` and `returnDocument` on a raw find-and-update command, `sort` on a raw find-and-delete command | Reads them and passes them to the command. A pre-release wrote them into `ops.json` but dropped them when it read the file back, so it ran the command without them. A migration that carries one, applied to another database by this release, changes the document its author chose |

A contract in a shape an earlier pre-release wrote is not accepted this way. The upgrade instructions of the release that changed the shape rewrite it, in `contract.json` and in every snapshot.

### The format version is not part of the migration hash

The version describes how the JSON is written, not what the migration does. The migration hash leaves `formatVersion` out of its input, as it leaves out `migrationHash`. The same migration written in two format versions has the same hash.

### How the code is arranged

For each version of each kind of file there is one unit of code.

- **The newest version's unit has a parser,** which turns a file in that version into the document Prisma works with in memory, **and a printer,** which writes that document in that version.
- **Each version after the oldest has a converter,** a function that turns a document of the version before it into one of its own.

How they are used:

- **Reading.** One shared function reads the version number and reports the refusals of rule 2. It then converts the document one version at a time to the newest, and the caller parses it with the newest version's parser. Every read takes this one path.
- **Who owns the units.** The contents of a contract differ between families, so each family owns its contract parser and printer. A family is the code shared by databases of one kind, SQL or MongoDB; a target is one database. The units for `migration.json` and ref files live with the migration tooling.
- **Where a contract is converted.** Some paths hold a stored contract before any family sees it: the CLI's contract reader, the snapshot store, an extension's bundled files. The shared function converts for them, so they pass on only the newest version. The one contract converter that exists, from version 0, changes only the version field, which every family's contract has in common, so it lives with the shared function. A contract version that changes content one family owns will need each family to supply its own converter and those paths to take it from the family.
- **Writing.** While a release writes one version of a file, the writer prints that version. From the second version on, the writer tries the oldest first, and a printer either produces a complete document or reports that its version cannot hold the data. A printer that wrongly reports this only makes the writer choose a higher version, which an older release refuses outright, so no release is handed a file it misreads.
- **Operations.** Each family owns the reader of its operations. The SQL family's reader takes from each target a schema for the target's own fields and a conversion for the target's earlier shapes. These readers are not given the file's format version, so the first change to an operation format has to pass it to them.
- **Testing.** For the newest version: print, parse the result, and get the same data back. A saved file of every earlier version still reads.

### What an author outside this repository owes

The rules bind whoever defines a stored shape. Nothing in the framework checks them for an outside author.

| Author of | Owes |
| --- | --- |
| A family | Reads a stored contract through `convertContractDocument`, which checks the version and converts an earlier one. Writes `NEWEST_CONTRACT_FORMAT_VERSION` into the contracts it prints while there is one written version. Its contract parser and its operation reader refuse a key they do not define, outside the open places it declares. Tells a format version error apart with `isFormatVersionError`. All three names are published at `@prisma/orm-framework/contract/format-version` |
| A SQL target | Supplies `readOperations`, with a schema for its own operation fields that refuses a key it does not define. `probeUnknownKeys`, which the SQL family publishes, checks this in a test: it adds an unknown key at every place of a saved operation and expects a refusal outside the open places |
| An extension pack | Its schemas for its entry kinds and its types' parameters refuse a key they do not define. The contract, migrations and refs it ships carry `formatVersion`, which the tools that write them add |

## Why

- **The version field and the refusal of a higher version have to be in `8.0.0`.** An `8.0.0` reader stays in use for the life of the major, so it must already know how to recognise a file it cannot read. Neither can be added later. The same holds for rule 3: a reader that ignores an unknown key in `8.0.0` ignores it for the whole major.
- **A reader is strict because a migration is an instruction to change a database.** Acting on one that is only partly understood is the failure the rules prevent. A reader that skipped unknown fields would apply a migration while ignoring part of it.
- **Content is read strictly only where it is interpreted, because storing a file acts on nothing.** Reading every snapshot strictly before a migration runs would stop a project that holds one old snapshot it cannot repair, and protect nothing.
- **A writer chooses the oldest version that holds the data so that newer tooling does not force an upgrade on everyone who reads its files.** An extension author who upgrades their tooling does not make every application that uses the extension upgrade, unless the extension uses something new.
- **Pre-release files are read as version 0 until `8.0.0`** so that adding the version field costs a pre-release user nothing while pre-releases continue, and so that conversion runs on real files before the first format change after `8.0.0` depends on it. It ends at `8.0.0` so that the promise starts from a clean base: every file an `8.x` release reads carries its version.
- **Operation shapes that pre-releases wrote are read rather than rewritten.** Before `8.0.0` an upgrade script could still rewrite them, because the rules that compute a contract's hashes change once before `8.0.0`, and every migration hash changes with them. Reading the three shapes is small and needs no step from a user, so they are read.

Git treats a repository's format version this way, and Cargo refuses a lock file in a format it does not know and keeps an existing lock file in its old format when nothing needs the new one.

## Consequences

- An earlier release fails clearly on a file it cannot read, instead of reporting a validation error or reading the file wrongly.
- A project whose members are on different releases of the same major keeps working until someone uses a feature that needs a newer format. From then, everyone who reads that file upgrades.
- Adding an optional field to any of these files is a format change. It needs a new version unit, and a saved file of every earlier version must still read.
- A file with a stray key is refused wherever its content is interpreted. Two cases are not refused: a key in a ref a pre-release wrote is dropped, and a key in a snapshot that no command interprets goes unnoticed until one does.
- A pre-release user runs the upgrade script once before `8.0.0`. Until then nothing in their repository has to change for the format version.
- `migration check` can pass a migration whose operations `db migrate` then refuses for a target's own field. The refusal names the migration and the operation.
- An index's `type` and `options` are checked when a contract is built, not when it is read. An index type or option that the index type does not define is accepted from a stored contract.
- The open places depend on the author of a change knowing that a reader now acts on something inside one. No test finds that.
- Nothing tests that an older version's printer never leaves something out, because there is one written version.

## Alternatives considered

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it.
- **Each addition says whether an older reader may ignore it.** Rejected as too complex: someone would have to judge that correctly for every field ever added. Rule 4 serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.
- **Read every snapshot strictly before a migration runs.** Rejected: a project with one old snapshot whose content cannot be read, and which no upgrade step rewrites, could not apply any migration to a new database.
- **Refuse a pre-release file and leave it to the upgrade instructions.** Rejected while pre-releases continue: every pre-release user would rewrite every stored file for a change that adds one field, and conversion would first run on real files only after `8.0.0`. Pre-release users do rewrite their files once before `8.0.0`, for the hash change and for this; what is avoided is one more rewrite now, and a conversion path that has never run.
- **Rewrite an earlier shape of an operation with an upgrade script.** Possible before `8.0.0` and not chosen: reading the shapes is small and needs no step from a user. From `8.0.0` it is not possible, because a migration's hash may not change.
- **Read operations strictly when the framework loads `ops.json`.** Not chosen here: the framework would have to ask the family to read each operation, which adds to the framework. It would let `migration check` refuse what `db migrate` refuses.
- **Keep the name `schemaVersion` for the field.** Rejected: "schema" means the database's schema everywhere else in the project.
- **A version inside `ops.json`.** Rejected: the file is a bare array, and it is never read apart from its `migration.json`.
- **A format version on the marker and the ledger.** Rejected: they are records in a database, which only Prisma reads and writes, not files that a repository carries from one release to the next.

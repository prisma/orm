# ADR 331 — Stored files carry a format version, and a reader refuses one it does not know

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Amends:** [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md) and [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md): `migration.json` and ref files carry `formatVersion`

Any release of Prisma 8 reads every file that an earlier release from `8.0.0` on wrote, so a user who upgrades within Prisma 8 regenerates nothing. This record is the part of that promise that concerns the files in a user's repository.

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

A developer on `8.3` opens a repository where a teammate on `8.5` has planned a migration that uses something `8.5` added. `8.5` wrote that `migration.json` with `formatVersion: 2`. On `8.3`, every command that loads it stops (the output also has a `docs:` line, left out here):

```text
✘ [MIGRATION.FORMAT_VERSION_NEWER] The migration file (migration.json) "/home/dev/shop/migrations/app/20270301T1000_add_search/migration.json" was written by a newer release of Prisma
  why: It is in format version 2, and this release of Prisma reads format version 1 only.
→ Upgrade Prisma to the release that wrote the file, or a later one
```

Nothing else in the file is interpreted, and nothing is changed in the repository or the database. The developer upgrades to the release the teammate is on.

## Decision

Six rules. The first four are permanent. Rule 5 covers the files that pre-releases of Prisma 8 wrote without `formatVersion`, and ends at `8.0.0`. Rule 6 covers the migration operations those pre-releases wrote, and lasts for the whole of Prisma 8.

1. **Each stored file carries `formatVersion`,** a positive integer.
2. **A reader checks the version before anything else, and refuses one it does not read.** This holds for every command that loads the file.
3. **A reader refuses a field the format does not define.** This holds wherever a command interprets the file's content.
4. **A writer writes the oldest version that can hold the data.**
5. **Until `8.0.0`, a file a pre-release wrote is read as format version 0 and converted in memory.** `8.0.0` refuses it.
6. **A migration operation in a shape a pre-release wrote is read for the whole of Prisma 8.** Those shapes are part of what format 1 accepts.

Rules 2 and 3 are two separate checks, and the rest of this record keeps them apart. The **version** is checked on every load. The **content** is checked where it is interpreted.

## Why

- **The version field and the refusal of a higher version have to be in `8.0.0`.** An `8.0.0` reader stays in use for the life of the major, so it must already know how to recognise a file it cannot read. Neither can be added later. The same holds for rule 3: a reader that ignores an unknown key in `8.0.0` ignores it for the whole major.
- **A reader is strict because a migration is an instruction to change a database.** Acting on one that is only partly understood is the failure the rules prevent. A reader that skipped unknown fields would apply a migration while ignoring part of it.
- **Content is checked only where it is interpreted, because recording a file acts on nothing.** A database command records the snapshot of each migration it applies, without using what is in it. A project can hold an old snapshot whose content this release cannot read: one in a shape an earlier pre-release wrote, whose upgrade step was never run, or one damaged by hand. Checking every snapshot's content before a migration runs would stop that project, and protect nothing.
- **A writer chooses the oldest version that holds the data so that newer tooling does not force an upgrade on everyone who reads its files.** An extension author who upgrades their tooling does not make every application that uses the extension upgrade, unless the extension uses something new.
- **Pre-release files are read as version 0 until `8.0.0`** so that adding the version field costs a pre-release user nothing while pre-releases continue, and so that the code that converts an older file is used on real files now, before the first format change after `8.0.0` depends on it. It ends at `8.0.0` so that every file an `8.x` release reads carries its version.
- **Operation shapes that pre-releases wrote are read, by choice.** The alternative was to have the upgrade script rewrite them, which would change the content of migrations that databases have already applied. Reading the three shapes (listed under rule 6) is small, and it leaves applied migrations as they are.

Git treats a repository's format version this way: it refuses to work in a repository whose `core.repositoryformatversion` it does not know. Cargo refuses a lock file in a format it does not know and keeps an existing lock file in its old format when nothing needs the new one.

## The rules in detail

### Terms

- A migration's **operations** are the steps it applies, stored in `ops.json` beside its `migration.json`. A migration written in code has a `migration.ts`, which writes both files when it is run.
- A project's migrations are kept in **spaces**: the application's, under `migrations/app/`, and one for each extension that has migrations of its own.
- A space's **head** is its newest contract: the emitted `contract.json` for the application, and the contract an extension's `refs/head.json` names.
- A **leaf** of a space's migration graph is a contract that no migration starts from.
- **Signing** a database (`prisma db sign`) records in it which contract it matches, without running a migration.
- The **`db` ref** names the contract a database was last brought to. `db migrate`, `db update`, `db init` and `db sign` move it; `--advance-ref <name>` picks the ref a command moves.
- A **family** is the code shared by databases of one kind, SQL or MongoDB. A **target** is one database.

### Rule 1: which files

| File | Notes |
| --- | --- |
| `contract.json` | The contract `prisma contract emit` writes |
| A contract snapshot | A copy of a contract under `migrations/snapshots/<storage hash>/`, kept so that the contract a migration starts from and the one it ends at can be read later |
| `migration.json` | Its version also covers the `ops.json` beside it, which holds the migration's operations: the two files are one migration, and `ops.json` is a bare array with nowhere to put a field |
| A ref file | A file under `refs/` that gives a contract a name |

Two records Prisma keeps in the database get no format version: the marker, which says which contract the database matches, and the ledger, which lists the migrations applied to it. They are not files.

### Rule 2: the version is checked on every load

A reader looks at `formatVersion` before anything else in the file.

| The file has | The reader |
| --- | --- |
| A version it reads | Reads the file |
| A higher version | Stops, and says a newer release of Prisma wrote the file. It interprets nothing else in it |
| No version, or a value that is not a positive integer, such as `"1"` or `0` | Stops, unless the file is one a pre-release wrote (rule 5). It does not guess |

This holds for every command that loads the file, whatever the command then does with it: a command that only lists migrations, the runtime loading `contract.json`, and a contract, migration or ref that an extension package ships inside itself. A command that loads a migration loads the snapshot the migration ends at, so that snapshot's version is checked too.

A file that is not JSON has no version to check. It is a content problem; "When content cannot be read", under rule 3, says what happens. A file that is JSON but not an object is refused by this rule.

The error names the format version, not a release. A user who meets it upgrades to the release their teammate or their extension is on.

**Built contracts.** A client factory and the CLI's control client accept either a stored contract or a contract Prisma built in memory, such as the object the TypeScript contract builder returns:

```ts
postgres({ contract: contractFromJson<Contract>(contractJson), url }) // a stored contract, read from contract.json
postgres({ contract: builtContract, url }) // the object defineContract(...) returned
```

A value with no format version field, whose `storage` is an object Prisma constructed and not plain parsed JSON, is a built contract. The entry point serialises it in the current format and parses the result, so it passes the same checks as a file. Anything else is read as a stored file. A function whose job is to read a stored file, such as a family's `deserializeContract`, refuses a built contract.

### Rule 3: a reader refuses a field the format does not define

Because a reader refuses an unknown field, a release cannot add a field to a format without raising its version. A contract with a stray `"draft": true` on the model `Post` is refused with this reason (a command prints it inside its own error, with the file's path):

```text
Contract structural validation failed: domain.namespaces.public.models.Post.draft must be removed
```

**Where the rule stops.** It covers what Prisma interprets. Some content Prisma carries for someone else, and there any key is accepted. These are the open places.

In a contract or snapshot:

- `meta`, and `_generated`, the notice the emitter adds;
- each extension's own section under `extensions`;
- `capabilities`, to which a later release may add a name ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md));
- the parameters of a generator, which produces a default value such as an id;
- the value of a literal default;
- an index's `options`, which belong to the index type;
- the MongoDB documents handed to the database as they are, such as a collection's validator and an index's partial filter.

In a SQL operation:

- a step's `params`, which are values handed to the database driver;
- the operation's `meta`, and the entries of a step's `meta` that no reader acts on;
- a type's parameters where an entry of a step's `meta` names a type.

In a MongoDB operation:

- the documents handed to the database as they are, such as a filter, an update and a pipeline;
- a query plan's `resultShape`, and the entries of a plan's `meta` that no reader acts on.

A release that makes a reader act on something inside an open place, for example a new entry in a step's `meta`, must raise the format version, because an earlier reader would not notice the entry.

A type's parameters in a contract are not an open place. They belong to the type, and the type's own schema refuses a parameter it does not define: its codec's schema, or, for a MongoDB type whose data type has a schema, that one. A command applies it when it reads a contract, for every type the project's configuration registers. A command skips a type the configuration does not register. A SQL client refuses such a type at startup; a MongoDB client does not use type parameters.

An extension's own section under `extensions` is open to Prisma, which carries it; the extension's own schema is what refuses a key there.

One thing Prisma interprets is not checked when a contract is read: an index's `type`. It is checked, with the index's options, only when a contract is built. So in a stored contract an index's options are open, and when a contract is built they are checked against the index type. Consequences lists the gap.

**Which commands check which content.** A command checks the content it interprets in that run.

| Command | Content it checks |
| --- | --- |
| Every command that loads the project's migrations | `contract.json`, every `migration.json` and every ref file. In `ops.json`, the operation fields every target shares |
| A client at startup | The contract |
| `contract emit` | The contract it builds from the contract source. It does not read the `contract.json` it replaces |
| `migration plan` | Also the snapshot the plan starts from, and each extension's head snapshot |
| `db migrate`, `db update`, `db init` | Also each extension's head snapshot, and every operation in full, before any runs. For `db migrate --to <ref>` and `db update --to <ref>`, the snapshot the ref names, which must be one a migration ends at |
| `db sign`, `db verify` | Also each extension's head snapshot. For `db sign <ref>`, the snapshot the ref names, when a migration ends at it; a ref that names the contract in `contract.json` signs that, and any other is refused |
| `migration show` | Also the operations it previews, in full |
| `migration check` | Also the snapshot each ref names, the one at each space's head, and the one at each leaf |
| `migration ref set` | Also checks the target snapshot against its hash |

Two things are not checked in these runs:

- **The snapshot of a migration that a database command applies.** The command records it in the database without interpreting it. Whoever interprets it later checks it then. So a project that holds an old snapshot whose content this release cannot read still applies its migrations.
- **A target's own fields in an operation, in `migration status`, `list`, `graph` and `check`,** which do not interpret them. They are checked by the commands that act on the operations: the runners, the statement preview of `migration show`, and the checks `db migrate` runs on the migrations it is about to apply.

**When content cannot be read.** The command names the file and the reason, and never reports the file as unknown or missing. What it does next depends on what it does with the file:

| The command | On content it cannot read |
| --- | --- |
| Acts on the file | Refuses |
| Only lists (`migration list`, `graph`, `status`) | Warns, and answers from the rest. `migration status --to` or `--from` refuses when the ref it names cannot be read |
| `migration check` | Reports the file as a finding, and checks the rest. A `contract.json` that is not JSON it refuses |
| `db update`, for the snapshot of the contract the database was last at | Warns and plans without it, as it does for a database with no such snapshot |
| `db migrate`, `db update`, `db init`, for each migration whose snapshot is not JSON, is `null`, or does not match its hash | Warn, and record no contract for that migration when they apply it |

A format version the reader does not read is never handled this way: rule 2 applies, and every command stops.

**What a refusal tells the user to do.** For a snapshot, a `migration.json` and a file no release wrote, restoring the file from version control comes first. One exception: for a file with both `formatVersion` and `schemaVersion`, deleting `schemaVersion` comes first. Where a command writes the file again, the advice names it and says what else that command does.

| File | Written again by |
| --- | --- |
| `contract.json` | `prisma contract emit` |
| The snapshot at the application's head, when a migration ends at the head | Once its folder is deleted: `prisma db migrate --advance-ref db`, which also applies any pending migrations |
| The snapshot at the application's head, when no migration ends there | Once its folder is deleted: `prisma db sign`, which also signs the database |
| The snapshot at an extension's head, or a migration in an extension's space of the project | Once its folder is deleted: `prisma contract emit`, from the installed extension. It also emits `contract.json` |
| Any other snapshot | Nothing. It can only be restored |
| `migration.json` that still parses and has its `createdAt` | `node <migration folder>/migration.ts`, which writes the same migration hash |
| Any other `migration.json` | Nothing that keeps its hash. See the steps below |
| A ref file that cannot be read | The advice is to make the file valid |
| A ref file no release wrote | Deleted and set again with `prisma migration ref set <name> <contract>` |
| A ref other than `db` that names a snapshot which cannot be read | `prisma migration ref set <name> <hash>`, with the hash of a contract the ref should name |
| A file inside an extension's installed package | Upgrading the extension |

A `migration.json` that cannot be rewritten with its hash can only be planned again, and only when no database has applied the migration and no ref names where it or a later migration ends. The user knows which databases a migration has reached; `prisma migration status` against a database shows it. The steps:

1. Delete the migration's folder and the folders of the migrations after it.
2. Plan again from the contract it started from: `prisma migration plan --from <hash>`, where the hash is that of the start snapshot its `migration.ts` imports, or `@empty` when it imports none.
3. Plan the later migrations again the same way.

No advice leads to a new hash for a migration a database has applied.

### Rule 4: a writer writes the oldest version that can hold the data

A file that uses nothing a newer version added is written in the older version, so an earlier release can still read it. If `8.5` adds version 2 of `migration.json` for a new kind of migration, a migration planned on `8.5` that does not use it is still written as version 1, and a teammate on `8.3` reads it.

While a release writes one version of a file, there is nothing to choose.

### Rule 5: a file a pre-release wrote is version 0 until `8.0.0`

A pre-release of Prisma 8 wrote these files without `formatVersion`:

```json
// contract.json and each snapshot: "schemaVersion" in its place
{ "schemaVersion": "1", "targetFamily": "sql", "target": "postgres", "...": "..." }
```

```json
// a ref file; a migration.json likewise has neither field
{ "hash": "6b46…", "invariants": [] }
```

Rule 2 refuses a file with no version because the reader must not guess what wrote it. Here there is nothing to guess about the version: every pre-release wrote these files without `formatVersion`, in exactly this way, and no release from `8.0.0` does. A contract with neither field is refused, because no release wrote that.

- **Before `8.0.0`,** a release reads such a file as format version 0 and converts it to version 1 in memory. Nothing is written back; the file becomes version 1 the next time a command writes it. No release writes version 0.
- **From `8.0.0`,** a file without `formatVersion` is refused, with advice to follow the upgrade instructions. Each release publishes its upgrade instructions in the Prisma 8 skill, and a pre-release user follows those of every release from the one they are on, as for any upgrade. The instructions of the release that introduced `formatVersion` come with a script that rewrites every stored file to version 1; the user runs it with Node from the project root, at any point before upgrading to `8.0.0`. Rewriting adds a field the migration hash leaves out (see below), so no hash changes. Tests fail if a release that is not a pre-release still reads version 0.

Version 0 of a contract, a `migration.json` or a ref means the file as the newest pre-release wrote it. A contract in a shape an earlier pre-release wrote is not converted. The release that changed the shape published an upgrade step whose script rewrites it, in `contract.json` and in every snapshot, and the contract reader's refusal says which step to run for content it no longer accepts.

One difference from version 1: converting a version 0 ref drops any key a ref does not have, such as a key added by hand, because the pre-releases ignored such a key. The upgrade script drops the same keys and lists each one.

Until `8.0.0` the content of format 1 is not final. A pre-release may still change it, and the upgrade instructions of that release say what a user does. From `8.0.0`, a change to a format is a new format version.

### Rule 6: an operation in a shape a pre-release wrote is read for the whole of Prisma 8

`ops.json` is covered by the migration hash, and from `8.0.0` no release may change the hash of a migration. So whatever shapes of operation are in users' repositories at `8.0.0` have to be read for the whole major. Pre-releases wrote three shapes that differ from the current one. They are read rather than rewritten before `8.0.0` (Why gives the reason), so they are part of what format 1 of `ops.json` accepts, and rule 3 does not refuse them. The reader turns each into the current shape before it checks the operation, so nothing after the reader sees the earlier shape. The migration hash is computed from the file as stored.

Two of them as they are stored and as they are read. A SQLite operation written by a pre-release up to `8.0.0-rc.20` names a schema, which the current shape does not have:

```json
"target": { "id": "sqlite", "details": { "schema": "main", "objectType": "table", "name": "user" } }
```

is read as

```json
"target": { "id": "sqlite", "details": { "objectType": "table", "name": "user" } }
```

A step that checks whether rows still hold an enum value being removed carries an entry in its `meta` that tells the runner to count those rows. `8.0.0-rc.21` and `rc.22` wrote it without the column or the value as the database stores it:

```json
"target": { "id": "sqlite", "details": { "objectType": "column", "name": "state", "table": "task" } },
"postcheck": [{ "sql": "…", "params": ["archived"], "meta": { "rowsHoldingValue": { "enumValue": { "enum": "Status", "member": "ARCHIVED" }, "value": "archived" } } }]
```

is read with the entry completed from the operation's target details and the step's first parameter:

```json
"meta": { "rowsHoldingValue": { "enumValue": { "enum": "Status", "member": "ARCHIVED" }, "value": "archived", "table": "task", "column": "state", "storedValue": "archived" } }
```

| Shape a pre-release wrote | What the reader does |
| --- | --- |
| SQLite: `"schema": "main"` in an operation's target details | Drops it. Any other `schema` is refused |
| SQL: a `rowsHoldingValue` entry with only `enumValue`, `value` and `codecRef` | Fills in `table` and `column` from the operation's target details, and `storedValue` from the first of that step's `params`. Where the operation does not have them, it drops the entry, and the runner reports a failed check without the count |
| MongoDB: `sort` and `returnDocument` on a raw find-and-update command, `sort` on a raw find-and-delete command | Reads them and passes them to the command. A pre-release wrote them into `ops.json` but dropped them when it read the file back, so it ran the command without them |

The MongoDB row changes behaviour. A migration that carries a `sort`, applied by a pre-release to one database and by this release to another, can modify a different document on each: the pre-release ignored the sort, and this release follows it.

### The format version is not part of the migration hash

The version describes how the JSON is written, not what the migration does. The migration hash leaves `formatVersion` out of its input, as it leaves out `migrationHash`. The same migration written in two format versions has the same hash.

## How the code is arranged

The code for one version of one kind of file is a unit. It can hold three things:

- a **parser**, which turns a file in that version into the document Prisma works with in memory. Only the newest version has one, because an older file is converted first;
- a **printer**, which writes that document in that version. Every version a release writes has one;
- a **converter**, which turns a document of the version before it into one of its own. Every version after the oldest has one.

Version 0 has no unit: version 1's converter reads it, and nothing writes it.

- **Reading.** One shared function, `readStoredDocument`, reads the version number and reports the refusals of rule 2. It then converts the document one version at a time to the newest, and the caller parses it with the newest version's parser. Every read takes this one path.
- **Who owns the units.** The contents of a contract differ between families, so each family owns its contract parser and printer. The units for `migration.json` and ref files live with the migration tooling.
- **Where a contract is converted today.** Three places hold a stored contract before any family sees it: the CLI's contract reader, the snapshot store, and the loader of an extension's bundled files. The shared function converts for them, so they pass on only the newest version. This works because the one contract converter that exists, from version 0, changes only the version field, which every family's contract has.
- **What the first family-specific contract change needs.** A contract version that changes content one family owns needs a converter from that family, and those three places have to ask the family for it.
- **Writing.** While a release writes one version of a file, the writer prints that version. From the second version on, the writer tries the oldest version's printer first, and a printer either produces a complete document or reports that its version cannot hold the data. A printer that wrongly reports this only makes the writer choose a higher version, which an older release refuses outright, so no release is handed a file it misreads.
- **Operations.** Each family owns the reader of its operations. The SQL family's reader takes from each target, through the target's `readOperations`, a schema for the target's own fields, the entries of a step's `meta` only that target reads, and a conversion for the target's earlier shapes. These readers are not given the file's format version, so the first change to an operation format has to pass it to them.
- **Testing.** For the newest version: print, parse the result, and get the same data back. A saved file of every earlier version still reads.

### What an author outside this repository owes

The rules bind whoever defines a stored shape. Nothing in the framework checks them for an outside author.

| Author of | Owes |
| --- | --- |
| A family | Reads every stored contract it is handed through `convertContractDocument`, which checks the version and converts an earlier one; a document already at the newest version passes through unchanged. Writes `NEWEST_CONTRACT_FORMAT_VERSION` as the `formatVersion` of the contracts it prints. Its contract parser and its operation reader refuse a key they do not define; a place it leaves open is a decision it records for its own users. When it catches errors while reading a file, lets a format version error through, which `isFormatVersionError` recognises, so the user sees that refusal and not a wrapped one. All three names are published at `@prisma/orm-framework/contract/format-version` |
| A SQL target | Supplies `readOperations`, with a schema for its own operation fields that refuses a key it does not define. `probeUnknownKeys`, which the SQL family publishes, checks this in a test: it adds an unknown key at every place of a saved operation and expects a refusal outside the open places |
| An extension pack | Its schemas for the kinds of storage entry it adds and for its types' parameters refuse a key they do not define. The contract, migrations and refs it ships carry `formatVersion`; the commands that write them add it |

A family that comes to have two written contract versions chooses between them by rule 4. Nothing published does that for it yet, because no family has two.

## Consequences

- An earlier release fails clearly on a file it cannot read, instead of reporting a validation error or reading the file wrongly.
- A project whose members are on different releases of the same major keeps working until someone uses a feature that needs a newer format. From then, everyone who reads that file upgrades.
- Adding an optional field to any of these files is a format change. It needs a new version unit, and a saved file of every earlier version must still read.
- A file with a stray key is refused wherever its content is checked. Outside the open places, three cases are not refused: a key in a ref a pre-release wrote is dropped; a key in a snapshot that no command interprets goes unnoticed until one does; and a parameter of a type the configuration does not register is not checked by commands.
- A pre-release user runs the upgrade script once before `8.0.0`. Until then nothing in their repository has to change for the format version.
- A MongoDB migration that passes `sort` or `returnDocument` to a raw find-and-modify command behaves as written from this rule on, which can differ from what a pre-release did with the same file.
- `migration check` can pass a migration whose operations `db migrate` then refuses for a target's own field, because the framework loads `ops.json` and reads only the fields every target shares. The refusal names the migration and the operation.
- An index's `type` and `options` are checked when a contract is built, not when it is read. An index of a type nothing registers, or with an option its type does not define, is accepted from a stored contract.
- The open places depend on the author of a change knowing that a reader now acts on something inside one. No test finds that.
- Nothing tests that an older version's printer never leaves something out, because every file has one written version.

## Alternatives considered

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it.
- **Each addition says whether an older reader may ignore it.** Rejected as too complex: someone would have to judge that correctly for every field ever added. Rule 4 serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.
- **Check the content of every snapshot before a migration runs.** Rejected: a project with one old snapshot whose content cannot be read, and which no upgrade step rewrites, could not apply any migration to a new database.
- **Refuse a pre-release file and leave it to the upgrade script alone.** Rejected while pre-releases continue. The script would have to run at the first pre-release that has the version field, and conversion would first run on real files only after `8.0.0`. Reading version 0 lets a pre-release user run the script at any point before `8.0.0`.
- **Rewrite an earlier shape of an operation with the upgrade script.** Possible before `8.0.0` and not chosen: it changes migrations that databases have applied, for three small shapes that a reader can convert. From `8.0.0` it is not possible, because a migration's hash may not change.
- **Check a target's operation fields when the framework loads `ops.json`.** Not chosen here: the framework would have to ask the family to read each operation, which adds to the framework. Its benefit, given up for now, is that `migration check` would refuse what `db migrate` refuses.
- **Keep the name `schemaVersion` for the field.** Rejected: "schema" means the database's schema everywhere else in the project.
- **A version inside `ops.json`.** Rejected: the file is a bare array, and it is never read apart from its `migration.json`.
- **A format version on the marker and the ledger.** Rejected: they are records in a database, which only Prisma reads and writes, not files that a repository carries from one release to the next.

# Design: later releases read the files and database records of earlier releases

The design for project 2 of the [plan](../plan.md). It holds only what has been agreed. So far that is the part about files: sections 6.1 and 6.2 of the [policy](../spec.md). Section 3 lists what is not yet discussed, including hashes, database records and the runtime marker check. Terms such as storage hash, ref file and marker are defined in section 2 of the policy.

## 1. Format versions

### 1.1 Which files

These files, which Prisma writes into a user's repository and reads back later, each carry the version of their format:

- `contract.json`, and each contract snapshot under `migrations/<space>/snapshots/<hash>/`, which is a copy of one;
- `migration.json`;
- ref files.

The contract's field `schemaVersion` is renamed `formatVersion`.

`ops.json`, which holds a migration's operations, is a bare JSON array with nowhere to put a version. How it is covered is not yet discussed.

### 1.2 What a reader does

A reader of one of these files looks at the format version before anything else in the file.

- **A version it knows:** it reads the file. A release reads every format version that an earlier release in the same major version wrote.
- **A version higher than any it knows:** it stops and says the file was written by a newer release of Prisma. It interprets nothing else in the file and changes nothing.

This holds for every read, including a command that changes nothing and the runtime loading `contract.json`. The policy says an earlier release works with later data "whenever it can interpret it". For these files, "can interpret" means "knows the format version".

A reader of one of these files never skips a field it does not know. A migration is an instruction to change a database, and acting on one that is only partly understood is the failure this rule prevents. Ref file readers skip unknown fields today, and become strict.

This rule is about files. Prisma's own records in the database follow section 6.4 of the policy, which relies on an earlier release being able to ignore a column or field that a later one added.

Git treats a repository's format version this way, and Cargo refuses a lock file in a format it does not know.

### 1.3 What a writer does

A release writes the oldest format version whose printer (section 1.4) accepts the data. A file that uses nothing a newer version added is still written in the older version, so an earlier release can read it. This is how the allowance in the policy, that an earlier release works with later data when it can interpret it, is met in practice.

The effect: an extension author who upgrades their tooling does not force every application that uses the extension to upgrade, unless the extension uses something new.

A later release never rewrites a migration or a contract snapshot in a newer format. A migration's hash covers `migration.json` and `ops.json`, and a snapshot is stored under its storage hash and hashed again on every read, so a rewritten file would read as tampered with. Those files keep the version they were written with for the whole major version. `contract.json` and ref files are written afresh each time, under the rule above.

Cargo does something close: it keeps an existing lock file in its old format when nothing needs the new one.

### 1.4 How it is built

For each version of each kind of file there is one unit of code with three parts: a parser, which reads the file; a representation of the document in memory; and a printer, which writes the file.

- **Reading.** The framework reads only the version number and picks the unit for that version. The contents of a contract differ between database families, so each family owns its units.
- **Writing.** The writer tries the oldest version first. A printer either produces a complete document or says it cannot hold the data. It never leaves something out. If the selection errs, it picks a version higher than was needed, which an older release refuses outright. No release is ever handed a file it misreads.
- **Converting.** A unit offers functions that turn a document of an earlier version into its own. It may offer them for several earlier versions. Where one exists for the version on disk it is used directly; otherwise the document is converted one version at a time.
- **Testing.** For each version: print, parse the result, and get the same data back.

### 1.5 Stages

- **In `8.0.0`:** each file in section 1.1 carries a format version, there is one unit of code for each kind of file, and every reader refuses a higher version. This cannot be added later, because an `8.0.0` reader stays in use for the life of the major version. The writing rule holds without any mechanism, because there is one version.
- **With the first change to a format:** trying the versions in order when writing, and the conversion functions. These constrain only later releases.

## 2. Alternatives rejected

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do; they keep such fields and write them back. Rejected: it would apply a migration while ignoring part of it, and the policy requires a command to stop on a record it cannot interpret.
- **Each addition says whether an older reader may ignore it.** Rejected: too complex. Someone would have to judge that correctly for every field ever added. The writing rule in section 1.3 serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.

## 3. Not yet discussed

- What a reader does with a file that has no format version, or has the old field name, as every file written by a release candidate does.
- How `ops.json` is covered by a format version.
- What the storage hash is computed from, once one contract can be on disk in two format versions.
- How an existing project and database move to the new hashes at `8.0.0`.
- Prisma's own records in the database, and the runtime check of the contract against the marker.
- The saved samples of what `8.0.0` writes, and their tests.

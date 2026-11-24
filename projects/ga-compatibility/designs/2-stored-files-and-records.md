# Design: later releases read the files and database records of earlier releases

The design for project 2 of the [plan](../plan.md). It holds only what has been agreed. It implements sections 6 and 7 of the [policy](../spec.md).

## 1. Format versions

### 1.1 Which files

Every file Prisma writes into a user's repository and reads back later carries the version of its format:

- `contract.json`, and each contract snapshot under `migrations/snapshots/`, which is a copy of one;
- `migration.json`;
- ref files.

The contract's field `schemaVersion` is renamed `formatVersion`.

### 1.2 What a reader does

A reader looks at the format version before anything else in the file.

- **A version it knows:** it reads the file. A release reads every format version that an earlier release in the major wrote.
- **A version higher than any it knows:** it stops and says the file was written by a newer release of Prisma. It interprets nothing else in the file and changes nothing.

A reader never skips a field it does not know. A migration file is an instruction to change a database, and acting on one that is only partly understood is the failure this rule prevents.

Git treats a repository's format version this way, and Cargo treats its lock file this way.

### 1.3 What a writer does

A release writes the oldest format version that can hold the data. A file that uses nothing a newer version added is still written in the older version, so an earlier release can read it. Cargo writes its lock file this way.

The effect: an extension author who upgrades their tooling does not force every application that uses the extension to upgrade, unless the extension uses something new.

A later release never rewrites a migration file or a contract snapshot in a newer format. A migration's own hash covers `migration.json`, so a rewritten file would read as tampered with. Those files keep the version they were written with for the whole major. `contract.json` and ref files are written afresh each time, under the rule above.

### 1.4 How it is built

For each version of each kind of file there is one bundle with three parts: a parser, a representation of the document, and a printer.

- **Reading.** The framework reads only the version number and picks the bundle. The contents of a contract differ between database families, so each family owns its bundles.
- **Writing.** The writer tries the oldest bundle first. A printer either produces a complete document or says it cannot hold the data. It never leaves something out. The worst case is then a version higher than was needed, which an older release refuses outright. No release is ever handed a file it misreads.
- **Converting.** A bundle offers functions that import a document from earlier versions. It may offer imports from several. Where a direct import exists from the version on disk it is used; otherwise the document is converted one version at a time.
- **Testing.** For each version: print, parse the result, and get the same data back.

### 1.5 Stages

- **In `8.0.0`:** every file carries a format version, there is one bundle for each kind of file, and every reader refuses a higher version. This cannot be added later, because an `8.0.0` reader stays in use for the life of the major.
- **With the first change to a format:** the rule for writing the oldest version that fits, and the conversion functions. These constrain only later releases.

## 2. Alternatives rejected

- **A reader skips the fields it does not know**, as Protocol Buffers readers do. Rejected: it would apply a migration while ignoring part of it, and the policy requires a command to stop on a record it cannot interpret.
- **Each addition says whether an older reader may skip it**, as PNG does for each block of data. Rejected: too complex. Someone would have to judge that for every field ever added, to serve a case that is rare, because a project's command-line tool and library normally come from one lockfile.

## 3. Not yet discussed

- What the storage hash is computed from, once one contract can be on disk in two format versions.
- How an existing project and database move to the new hashes at `8.0.0`.
- The runtime marker check.
- The saved samples and their tests.
- How `ops.json`, which is a bare JSON array, is covered by a format version.

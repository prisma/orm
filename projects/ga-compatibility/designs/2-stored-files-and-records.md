# Design: later releases read the files and database records of earlier releases

The design for project 2 of the [plan](../plan.md). It holds only what has been agreed. So far that is the part about files: sections 6.1 and 6.2 of the [policy](../spec.md). Section 5 lists what is not yet discussed, including hashes, database records and the runtime marker check. Terms such as storage hash, ref file and marker are defined in section 2 of the policy.

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

## 2. Hashes

### 2.1 The requirement

Changing a file's format version must not change a hash. A contract written in format version 1 and the same contract written in format version 2 have the same storage hash. If they did not, a release that changed the format would cut every migration off from the one before it and leave every database's marker not matching its contract.

### 2.2 What a hash is computed from

This applies to the storage hash, the profile hash and the execution hash.

A hash is computed from the contract as it is in memory after reading, not from the file as written. The rules that turn the in-memory contract into the input of the hash do not depend on the format version.

Hashing the file as written, by the rules of its format version, was rejected: it breaks the requirement as soon as a format version lays out the `storage` section differently.

### 2.3 Changing the hashing rules

Within a major version, the code that computes a hash may change only in ways that give the same hash for the same contract.

Part of the rules is supplied by a family or a target: which empty values are kept, and how storage entries are ordered. The same guarantee binds them, including a family or target built outside this repository. We state it in the policy and give their authors the test in section 2.4 as a helper they run on their own saved contracts.

One project never holds hashes computed in two ways. Git has the same rule: its plan for moving to a new hash function lists "intermixing objects using multiple hash functions in a single repository" as a non-goal.

A mistake found in the rules after `8.0.0` therefore stays until the next major version. That is accepted: a hash that is stable still identifies a contract, and we do not expect large changes to what a contract holds.

### 2.4 Moving existing projects to the new hashes at `8.0.0`

Taking the format version out of the hash input changes every existing hash once, at `8.0.0`. A project that used a release candidate moves by the upgrade instructions for that release: its files are rewritten, and each database is signed again with `db sign`. No mechanism in the migration system is built for this.

### 2.5 Tests

- **Fixed answers.** A set of saved contracts, each with its expected hashes written in the test. Every release must compute the same hashes.
- **Across format versions.** A contract written in one format version, then converted through each later version, keeps the same hashes.

## 3. The marker in the database

The marker, the record in the user's database of the contract it matches, follows the same pattern as the files. It records the version of its format, from `8.0.0`.

- **Reading.** A command that would change the database reads the version first, and stops if it is higher than any it knows. The check a running application makes is different: it never stops the application (section 7 of the policy), so there a higher version produces a warning.
- **Writing.** A release writes the oldest version that can hold the data. This matters more here than for files, because one database is read by application instances on different releases while a deploy is in progress.
- **Hashing rules.** As for files, a change to the hashing rules comes with a new version, so the version says which rules the marker's hash was computed with.

The ledger gets no version, as the policy says: nothing is decided from it.

This reverses a statement in the decision record on canonicalization, that there is no version field in the stored data and a change to the rules is handled by emitting and signing again.

## 4. Alternatives rejected

- **A reader ignores the fields it does not know**, as Protocol Buffers readers do; they keep such fields and write them back. Rejected: it would apply a migration while ignoring part of it, and the policy requires a command to stop on a record it cannot interpret.
- **Each addition says whether an older reader may ignore it.** Rejected: too complex. Someone would have to judge that correctly for every field ever added. The writing rule in section 1.3 serves the same case, an older release meeting a file from newer tooling, with no judgement for each field.

## 5. Not yet discussed

- What a reader does with a file that has no format version, or has the old field name, as every file written by a release candidate does.
- How `ops.json` is covered by a format version.
- Whether today's hash input is tidied in the one change that every hash goes through at `8.0.0`.
- Whether a marker that cannot be read or decoded warns or stops the query, in the check a running application makes.
- The saved samples of what `8.0.0` writes, and their tests.

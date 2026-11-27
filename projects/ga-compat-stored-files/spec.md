# Later releases read the files and database records of earlier releases

Project 2 of the Prisma 8 compatibility stream. It implements the stored-data and runtime-marker-check parts of the compatibility policy: from `8.0.0`, an application upgrades within Prisma 8 with no change to its code, its generated files or its database. Each pull request carries the code, the checks and the decision record for exactly what it implements, and says from which release it is in force. The design was agreed on 2026-11-24 and is in `projects/ga-compatibility/designs/2-stored-files-and-records.md` on the branch `ga-compatibility`; this spec restates what it requires and records the details it left open.

## Purpose

After an upgrade within Prisma 8, what Prisma wrote into a user's repository and database works as it is. The user regenerates nothing and runs no repair command, and an application never stops serving queries because of those records.

Today none of this is guaranteed. Only `contract.json` carries a format version, and no reader looks at it. The contract's format version is an input to the storage, profile and execution hashes, so a release that changed the format would change every hash. Nothing holds the hashing rules fixed between releases. A running application fails its queries when the marker cannot be read or decoded. No test reads a file or a database record that an earlier release wrote.

## What is built

### 1. Format versions

- `contract.json` (and each contract snapshot, which is a copy of one), `migration.json` and ref files each carry `formatVersion`. The value is the integer `1`.
- The contract's `schemaVersion` field is renamed `formatVersion`.
- `ops.json` is covered by the version in `migration.json`. The two files are one migration.
- Every reader looks at `formatVersion` before anything else in the file.
  - A version it knows: it reads the file.
  - A higher version: it stops and says the file was written by a newer release of Prisma. It interprets nothing else and changes nothing.
  - No version, or the old field name: it stops and names the upgrade instructions. It does not guess.
- No reader skips a field it does not know. Ref file readers, which skip unknown fields today, become strict.
- The code has one unit per version of each kind of file: a parser, the in-memory document and a printer. The framework reads only the version number and picks the unit. The contents of a contract differ between families, so each family owns its contract units. A second version can be added later without rework. Writing "the oldest version that can hold the data" and converting between versions are not built now, because there is one version.

### 2. Hashes

- The storage, profile and execution hashes are computed from the contract in memory, by rules that do not depend on the format version.
- The format version leaves the input of all three hashes.
- The blank fields that are not about storage (the empty profile hash, empty roots and the like) leave the storage hash input. The input is the target, the family and the storage.
- Every existing hash changes once, in one pull request.
- A test holds a set of saved contracts with their expected hashes as literals. A helper lets a family or target built outside this repository run the same test on its own contracts.

### 3. The runtime marker check

- A marker that cannot be read and a marker row that cannot be decoded each produce a warning, and the query runs.
- The check still runs once, before the first use of the database.
- If the database cannot be reached at all, the user's own query fails with its own error.

### 4. Saved samples

- Tests that the current code reads sample files and database records, computes the same hashes and applies saved migrations, on PostgreSQL and MongoDB.
- The samples come from a release candidate now. They are arranged so that they are replaced when `8.0.0` is cut, and the steps to replace them are written down beside them.

### 5. For release-candidate users

- Upgrade instructions for every breaking change, with a script that rewrites the user's files where a deterministic rewrite is possible. After the hash change, each database is signed again with `db sign`.
- No shim reads an old release-candidate file. No migration-system mechanism is built for the move.

## Details the design left open, and what was decided

- **The version is an integer.** The contract's `schemaVersion` was the string `'1'`. "Higher than any it knows" needs an order, and an integer has one without parsing.
- **The migration hash does not cover `formatVersion`.** The design says changing a file's format version must not change a hash. Leaving the field out of the migration hash input also means the pull request that adds the field changes no hash, so hashes change once, in the hash pull request.
- **The MongoDB runtime gains no marker check.** It has none today, and the design changes only the two failing cases of the existing check.
- **The marker's `contract_json` column is a database record, not a stored file.** It follows the rules for Prisma's own tables, which are a separate project.

## Not in this project

- Prisma's own tables in the database (the marker, the ledger and the contract table) and how they are brought up to date. That is project 7 of the stream. The marker and ledger get no format version.
- Reading a file a release candidate wrote, from `8.0.0` on. Until `8.0.0` such a file is read as format version 0 and converted in memory.
- `contract.d.ts`. It is TypeScript and is covered by the API compatibility projects.
- A second format version of any file.

## Contract impact

`contract.json` changes: `schemaVersion: "1"` becomes `formatVersion: 1`, and `storageHash`, `profileHash` and `executionHash` take new values. No contract entity or kind is added. The framework domain gains no concept: the contract already has a format version and the hashes already exist. Framework files change in the contract foundation package (hashing and canonicalization), the emitter, and the migration file readers.

## Adapter impact

The SQL and MongoDB families each own their contract format unit. The SQL runtime's marker check changes for PostgreSQL, MySQL and SQLite, which share it. Committed contracts, snapshots, migrations and ref files change for every target.

## Failure states

- A command that meets a file with a higher or missing format version stops before it writes to the database or to any file.
- The upgrade scripts rewrite files in place. A script reports every file it cannot rewrite and leaves that file untouched, and running a script twice gives the same result as running it once.

## Decision records

- The record on the storage and profile hashes and the record on canonicalization list the format version as a hash input and handle a rule change by emit and sign. A new record states the hash inputs and that the rules are fixed for the major, and supersedes those parts.
- A new record states the format version rules for stored files.
- The record on the marker says a failed read fails the call. A new record states that the check only warns, and supersedes that part.

## Definition of done

Beyond the repository's standing definition of done:

- The four parts above are merged to `main`.
- `8.0.0-rc` users have upgrade instructions and scripts for every breaking change, and `pnpm check:upgrade-coverage` passes.
- Fixtures, examples and committed migrations are regenerated.
- The decision records above are written and the old ones marked.
- Manual QA has run the commands a user runs (`contract emit`, `migration plan`, `db migrate`, `db sign`, `db verify`, and an application query) against a file with a higher version, a file with no version, an upgraded release-candidate project, and a marker that cannot be read.

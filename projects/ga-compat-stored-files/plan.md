# Plan: later releases read the files and database records of earlier releases

The spec is [spec.md](spec.md). Four pull requests, then a close-out. The stream has no tracker tickets, so each pull request is named here by what it does.

## Status

| Part | State |
| --- | --- |
| 1. Format versions | Merged (prisma/orm#31200) |
| 2. Hashes | Merged (prisma/orm#31203) |
| 3. The runtime marker check | Merged (prisma/orm#31198) |
| 4. Saved samples | Built on branch `ga-compat-samples` with sets from `8.0.0-rc.26`; to be written again from a release that includes parts 1 and 2 |

## Order

1. Format versions.
2. Hashes. After 1, because both rewrite every committed contract and migration, and the second upgrade script starts from the first one's output.
3. The runtime marker check. Independent of 1 and 2; built at the same time as 1.
4. Saved samples. After 2, because the samples must be in the final format with the final hashes.

## 1. Format versions

**What changes for a user.** `contract.json`, each snapshot, `migration.json` and each ref file carry `formatVersion: 1`. A file with a higher version is refused with "written by a newer release of Prisma". A file a pre-release wrote, with no version or with `schemaVersion`, is read as version 0 until `8.0.0`. A file no release wrote is refused with advice that works for that kind of file. A ref file with an unknown field is refused. No hash changes.

**How.**

- One shared check in the contract foundation package: given a parsed JSON document and the kind of file, it returns the known version or throws one of two structured errors (newer release; no version). It reads nothing but `formatVersion`.
- Contract: each family's base serializer calls the check first, then hands the document to the unit for that version (`parse`, the in-memory contract, `print`). The emitter writes through the family's printer for version 1. The JSON schemas and `readContractEnvelope` follow the rename.
- The framework paths that read a contract without the family serializer call the same check first: `readContractEnvelope`, the snapshot store's two readers, the extension self-consistency check and `contractSpaceFromJson`. `buildReadAggregate` stops swallowing a format version error.
- `migration.json` and ref files: one unit per version in the migration tooling package, each with a parser, the document type and a printer. All readers and writers go through them, including the head-ref reader and the three places that build migration metadata. The ref unit rejects unknown fields.
- The migration hash input leaves out `formatVersion`, as it leaves out `migrationHash`.
- A round-trip test per unit: print, parse, same data.
- Upgrade instructions for applications and for extensions, with one script: rename the field in every `contract.json` and snapshot, add the field to every `migration.json` and ref file. The script changes no hash and is safe to run twice.
- The repository's own files: `pnpm fixtures:emit` for what it reaches, the script for the rest. Fixtures of earlier upgrade scripts stay as they are.
- A decision record: stored files carry a format version; the reading rule and the writing rule. Docs that name `schemaVersion` follow the rename.
- Every reader refuses a key the format does not define: the contract validators of both families and of each target's entry kinds, the MongoDB operation reader, and a reader of SQL operations in the SQL family, to which each SQL target supplies its own fields. Format 1 of `ops.json` reads every shape a pre-release wrote, converted to the current shape by the reader, because `ops.json` is covered by the migration hash. The slice is in [slices/strict-readers/spec.md](slices/strict-readers/spec.md).
- Files a pre-release wrote are read as format version 0 and converted in memory, until `8.0.0`. The slice is in [slices/read-rc-files/spec.md](slices/read-rc-files/spec.md). The hash pull request adds what depends on the new hashes: the hash script accepts version 0 files, and the saved release-candidate project is checked against hashes computed from its contracts.

**Checks.** Tests first. Locally: only the touched test files, the touched packages' typecheck and lint, `pnpm lint:deps`, `pnpm check:upgrade-coverage`. Repository-wide work (`pnpm build`, whole-repo typecheck, `pnpm fixtures:check`, any test suite) runs in CI, not on this machine, which many sessions share.

## 2. Hashes

**What changes for a user.** Every storage, profile and execution hash takes a new value, once. Release-candidate users run a script on their files and `prisma db sign` on each database. Extension authors run the script and republish.

**How.**

- Hash input: the storage hash covers the target, the family and the storage; the profile hash the target, the family and the capabilities; the execution hash the target, the family and the execution section. No format version and no blank fields.
- The canonicalization used for hashing takes no format version.
- A fixed-answers test: saved contracts for PostgreSQL, MySQL, SQLite and MongoDB with their hashes as literals.
- A public helper that runs the same test on contracts the caller supplies, for a family or target built elsewhere.
- Upgrade instructions with a script modelled on the one for value objects in storage: recompute hashes, rename snapshot folders, rewrite `from`, `to` and `migrationHash`, refs, `migration.ts` and `contract.d.ts`; then `prisma db sign`.
- The repository's own files, as in 1.
- A decision record: what each hash covers, and that the rules do not change within a major. It supersedes the hash inputs in the record on storage and profile hashes and the emit-and-sign handling in the record on canonicalization.

## 3. The runtime marker check

**What changes for a user.** A marker that cannot be read, or a marker row that cannot be decoded, logs a warning and the query runs. The check still runs once.

**How.**

- `verifyMarker` in the SQL runtime catches a failed read and a failed decode and logs `CONTRACT.MARKER_READ_FAILED` or `CONTRACT.MARKER_ROW_CORRUPT` as a warning. A failed check counts as the one check; it is not tried again.
- Tests for both cases, and for an unreachable database, where the user's query fails with the driver's error.
- A decision record: the check only warns. It supersedes the read-failure paragraph in the record on the marker.
- The open pull request that retries a failed marker read is closed if it is redundant.

## 4. Saved samples

**What changes for a user.** Nothing. From here a change that stops the current code reading what a release wrote fails a test.

**How.**

- A sample set per database (PostgreSQL and MongoDB): `contract.json`, snapshots, migrations, ref files, and a dump of the marker and ledger records, written by a release candidate that includes 1 and 2.
- Tests: the current code reads every file, computes the hashes recorded in them, applies the migrations to an empty database, and reads the saved records.
- A written procedure, beside the samples, to replace them when `8.0.0` is cut.

## Close-out

Final review against the spec, migrate anything long-lived to `docs/`, delete this folder.

## Follow-ups found on the way

Recorded in [deferred.md](deferred.md).

---
changes:
  - id: contract-hash-inputs
    summary: |
      Every storage, profile and execution hash takes a new value, once: each now covers only the target, the family and its own section of the contract, and the rules that compute them do not change again within Prisma 8. Run the colocated script on the project: it rewrites every hash in the emitted contract, `contract.d.ts`, the snapshot directories, each `migration.json` and `ops.json`, each ref file and each `migration.ts`. Then run `prisma db sign` against every database the project uses (`prisma db sign --force` where the change policy permits only migrations), and `prisma contract emit`.
    script: ./scripts/contract-hash-inputs/contract-hash-inputs.ts
---

# A contract's hashes cover only what the contract means

## `contract-hash-inputs`

A contract has three hashes: the storage hash (`storage.storageHash`), which names the database schema the contract describes; the profile hash (`profileHash`); and the execution hash (`execution.executionHash`). Until this release each covered its own section inside a stand-in contract with a fixed `schemaVersion` and blank fields. Now each covers only the target, the family and its own section. So every hash in your project changes once, and from `8.0.0` the rules that compute them do not change within the major version.

The storage hash names a contract everywhere Prisma refers to one: the snapshot directories under `migrations/snapshots/<hash>/`, the `from` and `to` of each `migration.json` and the query plans of a data transform in its `ops.json` (and so its `migrationHash`), the `hash` of each ref file, the snapshot imports and hash literals of each `migration.ts`, and the marker Prisma writes in each database. All of them must move to the new hashes together.

### 1. Run the script

Run the upgrade step for the stored-file format version (`stored-files-format-version`) first: this script refuses a file without `formatVersion`. Commit your work, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <path-to-this-guide>/scripts/contract-hash-inputs/contract-hash-inputs.ts
```

Node 24 or later runs the TypeScript script directly. It reads and writes files only and needs no database. It walks the project, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot, and finds the same files the format version script does: every contract (any `*.json` file with `targetFamily` and `storage`, so the emitted `contract.json` and each snapshot), every `migration.json` with an `ops.json` beside it, and every ref file.

First it checks every contract: each stored hash, and each snapshot directory's name, must be the hash the old rules or the new rules give the contract's content. A storage hash that matches neither means the file was edited by hand or comes from another release. The script then changes no file, names each such file, and exits 1. Restore the file from version control, or emit it again, and run the script again. It does the same for a `migration.json` whose `migrationHash` does not match the migration, and for a file without `formatVersion`. Two kinds of snapshot are accepted although a stored hash does not match. An earlier release may have written a snapshot's profile or execution hash by other rules, and no version of the file has the right one; `prisma db sign <contract reference>` copies a snapshot's profile hash into the database marker, so the script gives such a snapshot the hashes its content gives, before any database is signed, and lists it. And the upgrade steps that renamed MongoDB indexes and field storage names rewrote snapshots in place and kept their storage hashes, because markers, the ledger and migrations name a snapshot by its hash; such a MongoDB snapshot, whose directory name and stored hash agree, takes the new hash of its content, every file that names it follows, and the script lists it.

Then it computes each contract's new hashes and rewrites, keeping every other byte of each file:

- the storage, profile and execution hash in every contract, and the same hashes in the `contract.d.ts` beside it;
- the name of each snapshot directory, `snapshots/<old>/` to `snapshots/<new>/`;
- `from` and `to` in every `migration.json`, each old storage hash in the `ops.json` beside it (a data transform's query plans carry the storage hash of the contract they were built for), and its `migrationHash`, which covers both (the rule for the migration hash is unchanged);
- `hash` in every ref file;
- each old storage hash in every `migration.ts`, which names its snapshots in its imports.

It prints each file it rewrote, each directory it renamed and each hash it replaced. A second run changes nothing. A run that stops partway, for example on a full disk, leaves each file either as it was or rewritten, and running the script again finishes the upgrade.

The script exits 1 without changing that file when it cannot finish one:

- A `migration.json` or ref file names a storage hash that no contract or snapshot in the project has, so the script cannot tell its new value. Prisma copies an extension's migrations into `migrations/<extension>/`, without a snapshot of every contract in between. For a migration there, delete its folder: after you upgrade the extension, `prisma contract emit` writes it again from the extension's new version, with the new hashes, and the script accepts it from then on, because those migrations lead to the extension's head, which already has its new hash. Restore anything else from version control, or set a ref again with `prisma migration ref set` after the upgrade.
- A contract file that is not a snapshot, and whose storage hash no migration, ref or snapshot names, such as a hand-made test fixture, has a hash its content does not give. The script leaves it alone and prints the hashes its content gives; set them, or emit it again if Prisma writes it. The rest of the project is still upgraded.
- A `contract.json` has neither `formatVersion` nor `schemaVersion`, so no release of Prisma wrote it. The script leaves it alone.
- A `contract.d.ts` names a hash that is not one of its contract's. Emit the contract again with `prisma contract emit` (or, for a snapshot, restore both files from version control) and run the script again.

### 2. Upgrade every extension with Prisma

An extension package bundles a contract and migrations with its hashes, and this release checks them when it loads the extension. An extension built for an earlier release fails to load with `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`, whose message names the extension. Upgrade each extension to its version for this release in the same change.

### 3. Sign every database

Each database records the storage and profile hash of the contract it was last moved to, in its marker. That is the old hash, so run `prisma db sign` against every database the project uses: development, staging, production and any other. `db sign` checks that the database's schema matches the contract and then writes the new hashes into the marker; it changes no table. Run it after the script and after upgrading Prisma and the extensions, with this release.

If you skip it, the database stays usable, but the commands that compare it with the project see a contract they do not know:

- `prisma db migrate` stops before it changes anything, with `MIGRATION.MARKER_MISMATCH`: "The database is at a contract that is not in the migration graph". Its advice to run `db update` does not apply here; run `db sign`.
- `prisma migration status` warns with `MIGRATION.MARKER_NOT_IN_HISTORY`: "Database was updated outside the migration system".
- `prisma db verify` fails with `CONTRACT.MARKER_MISMATCH`: "Contract storageHash does not match database marker".
- At runtime, queries still run. A SQL client that is given a `log` option logs one `CONTRACT.MARKER_MISMATCH` warning; a MongoDB client does not check the marker.

A database whose change policy permits only migrations refuses `db sign`, with "This database's change policy permits only migrations". For such a database, usually production, put these two lines in your deploy script for this one release, in place of `prisma db migrate`:

```sh
prisma db sign --force
prisma db migrate
```

Remove the `--force` line after the release is deployed. `--force` overrides only the change policy's refusal: `db sign` changes no schema, still checks that the database matches the contract of the application and of each extension before it writes a marker, and leaves the database's policies as they were.

After the upgrade, `prisma migration status` shows none of the migrations applied before it as applied. The database's ledger records each applied migration by its `migrationHash`, the ledger keeps the old values, and the script gave every migration a new one. `prisma migration log` likewise lists the earlier migrations with their old hashes. No command decides anything from the ledger: `db migrate` decides what to apply from the marker, which `db sign` moved to the new hash. The ledger is otherwise read only to explain a marker that is outside the migration graph, should that happen later. Migrations applied after the upgrade show as applied.

### 4. Emit the contract

Run `prisma contract emit` and commit the result. It writes the emitted contract with the hashes the script wrote, and the files Prisma keeps for each extension under `migrations/<extension>/`.

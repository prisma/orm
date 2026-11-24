---
changes:
  - id: contract-hash-inputs
    summary: |
      Every storage, profile and execution hash takes a new value, once: each now covers only the target, the family and its own section of the contract, and the rules that compute them do not change again within Prisma 8. An extension bundles its contract, migrations, head ref and snapshots with the old hashes, and this release refuses to load it. Run the colocated script on the extension package, rebuild, and publish a new version.
    script: ./scripts/contract-hash-inputs/contract-hash-inputs.ts
---

# A contract's hashes cover only what the contract means

## `contract-hash-inputs`

A contract has three hashes: the storage hash (`storage.storageHash`), the profile hash (`profileHash`) and the execution hash (`execution.executionHash`). Until this release each covered its own section inside a stand-in contract with a fixed `schemaVersion` and blank fields. Now each covers only the target, the family and its own section. So every hash changes once, and from `8.0.0` the rules that compute them do not change within the major version.

An extension's package carries these hashes: its emitted `src/contract.json` and `contract.d.ts`, `migrations/refs/head.json`, the `from`, `to` and `migrationHash` of each `migration.json`, the snapshots under `migrations/snapshots/<hash>/` and the `migration.ts` that import them. When an application loads the extension, this release recomputes the hash of the bundled contract and compares it with the head ref. An extension published for an earlier release therefore fails to load with `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`, which names the extension.

Run the upgrade step for the stored-file format version (`stored-files-format-version`) first: this script refuses a file without `formatVersion`. Commit your work, then run the script from the extension package's root:

```sh
node <path-to-this-guide>/scripts/contract-hash-inputs/contract-hash-inputs.ts
```

Node 24 or later runs the TypeScript script directly. It reads and writes files only. It first checks that each stored storage hash, and each snapshot directory's name, is the hash the old rules or the new rules give the contract's content, and that each `migrationHash` matches its migration. If one does not, the file was edited by hand or comes from another release: the script changes no file, names each such file, and exits 1. Otherwise it rewrites every hash listed above, renames each snapshot directory to its new hash, and recomputes each `migrationHash`, keeping every other byte of each file. It prints what it changed; a second run changes nothing. A snapshot's profile or execution hash may have been written by an earlier release's rules, and no command reads those two hashes from a snapshot: the script gives such a snapshot the hashes its content gives and lists it.

Then build the package and run its tests, and publish a new version. An application must upgrade the extension together with Prisma: an older version of the extension does not load in this release, and this version does not load in an earlier one.

Signing each database with `prisma db sign` is the application's step. An extension space's marker moves to the new head hash with the rest of the database.

A family or target built outside Prisma can check that its own contracts keep their hashes within the major with `assertContractHashes`, from `@prisma/orm-framework/contract/hashing`; its README shows how.

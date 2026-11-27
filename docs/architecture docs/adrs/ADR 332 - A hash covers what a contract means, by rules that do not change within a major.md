# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)

## At a glance

A team on Prisma `8.0.0` emits a contract and migrates its production database. Later it upgrades to `8.4` and changes nothing else. `prisma contract emit` writes the same `storageHash`, `profileHash` and `executionHash` as before. The database still matches the contract, `prisma db verify` passes, and none of the team's migration files needs to change.

That holds because each hash is computed from a small, fixed input, by rules that do not change between `8.0.0` and the last `8.x` release. The storage hash, for example, is the SHA-256 of this, with `storage` in its family's normal form (see Terms) and every key sorted, as [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md) describes:

```json
{
  "storage": { "...": "the contract's storage section" },
  "target": "postgres",
  "targetFamily": "sql"
}
```

## Terms

- A **family** is a kind of database Prisma supports, such as `sql` or `mongo`. A **target** is one database within a family, such as `postgres`. A contract names both, as `targetFamily` and `target`.
- A family's **normal form** of `storage` leaves out the fields the family defines as defaults and orders the lists whose order means nothing to the database. It is what Prisma writes into `contract.json` and what it hashes ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- A **capability** is something a database version or a connection provides that a contract may rely on, such as `sql.returning` ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)). The contract's `capabilities` section lists every capability it requires.
- A **ref file** gives a contract a name, such as `production`, by its storage hash.
- A **snapshot** is a copy of a contract saved under `migrations/snapshots/<storage hash>/`, for each contract a migration starts or ends at and each contract a ref names.
- A migration names the contracts it starts and ends at by their storage hashes. One migration follows another when it starts at the hash the other ends at.
- A database's **marker** is a record Prisma keeps in the database. It holds the storage hash and the profile hash of the contract the database was last brought to. To **sign** a database is to check that it matches a contract and write that contract's hashes into the marker, with `prisma db sign`.
- A database's **ledger** records each migration applied to it, by its **migration hash**, a hash of the migration's own files.

## Decision

**Each hash covers three inputs.**

| Hash | Covers | Tells Prisma |
| --- | --- | --- |
| Storage hash | `targetFamily`, `target`, and `storage` in its normal form | Which contract a database matches; where each migration starts and ends; the name of each snapshot |
| Profile hash | `targetFamily`, `target`, `capabilities` | Which capabilities the contract requires of the database and the connection |
| Execution hash | `targetFamily`, `target`, `execution` | Which defaults the client applies when it writes rows, such as an `id` the client generates |

Nothing else in the file enters a hash, not even the file's `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)).

**The rules that compute them do not change within a major version.** For the same contract source and configuration, every release of the major writes the same `storage`, `capabilities` and `execution`, and computes the same three hashes from them. This binds Prisma's families and targets, and any family or target built outside this repository, for the whole of Prisma's major version.

**What a contract's `capabilities` section lists, and the rule that the capability lists it is built from do not change within a major version, belong to [ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md).** This record says only that the profile hash covers that section.

## Why

Prisma records these hashes in the user's files and in the database: in `contract.json`, in each migration's start and end, in the name of each snapshot, in each ref file, and in the marker. Suppose a release computed a different hash for the same contract. The user's next `contract emit` would write a hash that no migration ends at, no snapshot is named by and no marker records. Prisma would report the database as not matching, and would find no migration path from the database to the contract. The user could repair that only by hand, in every project and every database.

Each hash covers only what it identifies, so that nothing else can move it. A hash that also covered how the file is laid out, or sections it does not describe, would change whenever those did.

## How it is held

- **The hashing rules.** Each family keeps saved contracts and their expected hashes, written as literals, in `hash-rules.fixed-answers.test.ts` beside its normal form. Every release must compute those hashes.
- **What a family writes.** The repository emits its fixtures and examples again in CI and compares them with the committed files (`pnpm fixtures:check`). A change to what a family writes therefore shows in the pull request's diff, where review catches it.
- **Format versions.** Prisma checks a stored contract by reading it, converting an earlier format version to the newest layout, and hashing it again; it compares the result with the hash the contract is stored under (a snapshot's directory name, or an extension's head ref). So a later format version within the major may change how the file is laid out, but not what `storage`, `capabilities` and `execution` hold once converted.
- **A family or target built outside this repository** runs the first check with the function Prisma publishes. It saves a few `contract.json` files it emitted, covering every field its normal form leaves out or orders, writes down their hashes, and calls:

  ```ts
  import { normalizeSqlStorage } from '@prisma/orm-family-sql/contract/normal-form';
  import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

  assertContractHashes({
    contracts: [
      {
        name: 'a table with every kind of index',
        contract: savedContract, // a parsed contract.json the target emitted
        storageHash: 'b04c6ddd…', // each hash as 64 lowercase hexadecimal digits
        profileHash: '833bc812…',
        executionHash: 'b0582e3d…',
      },
    ],
    normalizeStorage: normalizeSqlStorage, // a SQL target passes its family's normal form
  });
  ```

  It throws `CONTRACT.HASH_MISMATCH`, naming each contract and hash that differs.

## Consequences

- **An upgrade within a major changes no hash,** so it needs no change to a user's files or databases.
- **A contract's hashes change when its author changes the contract.** A new column gives a new storage hash and arrives with a migration, which writes the new hashes into the marker when it is applied. A change to the capabilities the contract lists gives a new profile hash and no migration, so the author signs each database again.
- **Some fixes wait for the next major,** because each would change hashes already recorded:
  - a mistake in the hashing rules, including one that gives two different contracts the same hash;
  - a family naming a new default to leave out, or writing different `storage` for an existing contract source.
- **The execution hash is recorded only in files:** `contract.json`, `contract.d.ts`, and their snapshot copies, which `contract emit` does not rewrite. It is frozen with the others so that an upgrade leaves no file holding a value a new emit would not write.
- **A project whose hashes were computed by other rules,** such as one created by a Prisma 8 pre-release, cannot be brought to these rules by the migration system, which never changes a recorded hash. The upgrade instructions for moving from a pre-release do it: a script rewrites the hashes in the project's files, and each database is signed again with `prisma db sign`.
- **`prisma db sign --force` exists for that step.** A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)), and `--force` overrides that one refusal. It changes no schema, still checks that the database matches the contract before it writes the marker, and leaves the database's policies as they were. No error or advice offers the flag; the upgrade instructions do.
- **After that step, the ledger still names the old migration hashes.** The script changed the storage hashes inside each migration's files, and so each migration's hash; it cannot change the ledger, which lives in each database.
  - `prisma migration status` counts a migration as applied only when its hash is in the ledger, so it permanently shows the earlier migrations as not applied.
  - `prisma db migrate` decides what to apply from the marker, not the ledger, so it applies none of them again.
  - `prisma migration log` still lists the ledger, and `db migrate` reads it to explain a marker that is outside the known migrations.

## Alternatives considered

- **Compute each hash from the whole contract with every other section emptied, and with the file's format version included.** Rejected: renaming the format version field, or adding any top-level section to the contract, would change every hash, although neither changes what the contract means.
- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** Rejected: the framework cannot know which of those values are defaults. Where the list is incomplete, two different contracts share a hash and the written contract loses what its author wrote ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- **Hash the file as written, by the rules of its format version.** Rejected: the hash would change as soon as a later format version laid out `storage` differently.
- **Record which version of the hashing rules produced a hash, and support several.** Rejected: a project would hold hashes computed in two ways, and every comparison would have to compute the hash again by the older rules, which every later release would have to keep.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: every user would run it in every project and sign every database again, for an upgrade that changed nothing they wrote.

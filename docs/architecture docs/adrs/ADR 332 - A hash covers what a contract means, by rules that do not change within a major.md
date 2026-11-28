# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)

## At a glance

A contract's storage hash identifies the database it describes. Storage hashes appear in five kinds of place, in the project and in the database:

```text
prisma/contract.json                                     "storageHash": "6a0532b8…"
migrations/app/20261124T0900_add_phone/migration.json    "from": "09807bbe…", "to": "6a0532b8…"
migrations/snapshots/6a0532b8…/contract.json             a copy of the contract, saved under its hash
migrations/app/refs/production.json                      "hash": "6a0532b8…"
the database's marker                                    storage hash 6a0532b8…
```

Migrations are chained by it: one starts at the hash where the previous one ends. The database's **marker**, a record Prisma keeps in the database, says which contract the database matches. If a release of Prisma computed a different hash for the same contract, every one of those places would stop agreeing at once, and the user could repair that only by hand.

So the hash is computed from a small, fixed input. The storage hash is the SHA-256 of this, with its keys sorted:

```json
{
  "storage": { "...": "the contract's storage section, in its family's normal form" },
  "target": "postgres",
  "targetFamily": "sql"
}
```

and the rules that compute it do not change from `8.0.0` to the last `8.x` release. With [the compatibility policy](../../oss/versioning.md#what-stays-compatible), which keeps what a release writes for a source the same within a major, a team that upgrades within Prisma 8 and changes nothing else gets the same hashes, its database still matches, and none of its files changes.

## Decision

**1. Each hash covers the family, the target, and one section of the contract.**

| Hash | Covers | Tells Prisma |
| --- | --- | --- |
| Storage hash | `targetFamily`, `target`, and `storage` in its family's normal form | Which contract a database matches; where each migration starts and ends; the name of each saved copy |
| Profile hash | `targetFamily`, `target`, and the capabilities in `capabilities` that are on | Which features the contract requires of the database and the connection, such as `RETURNING` |
| Execution hash | `targetFamily`, `target`, `execution` | Which defaults the client applies when it writes rows, such as an `id` it generates |

A **family** is a kind of database Prisma supports (SQL or MongoDB), and a **target** is one database in it (such as PostgreSQL). Both are in every hash, so the same section written for two targets gives two hashes. The family's **normal form** of `storage` leaves out the fields the family defines as defaults and orders the lists whose order means nothing; [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md) gives the full computation. Nothing else in the file enters a hash, not even its `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)).

**2. Within a major version, the rules that compute the hashes do not change.** Given the same `storage`, `capabilities` and `execution`, every release of the major computes the same three hashes. The rules include the framework's steps and each family's normal form, and they bind families and targets built outside this repository too.

What is frozen is the step from a contract to its hashes, not what a release writes for a contract source. A release that writes different `storage` for a source, for example to fix how it reads a Prisma schema, gives that contract a new storage hash; [the compatibility policy](../../oss/versioning.md#what-stays-compatible), not this record, says when a release may do that.

A later format version within the major may change how a stored file is laid out, but not what its sections hold once converted to the newest layout. Prisma checks a stored contract by converting it and then hashing it, so a layout change that altered the sections would change its hash.

**3. What the `capabilities` section lists belongs to [ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md).** This record says only that the profile hash covers it. A flag that is off counts as absent, so a list that writes it as `false` and one that leaves it out have the same hash.

## Why

**Why freeze the rules.** The listing above is the reason. A changed rule changes the hash of every existing contract, so the user's next `contract emit` would write a hash that no migration ends at, no saved copy is named by and no marker records. Prisma would report every database as not matching, and would find no migration path from any database to its contract.

**Why each hash covers only its own section.** A hash that also covered other parts of the file would change whenever they did. If the storage hash covered the file's format version, the first change to the file format would change every storage hash; if it covered `meta`, adding a field there would. A hash that covers exactly what it identifies changes only when that does.

## How the freeze is held

- **The rules.** Each family keeps saved contracts and their expected hashes, written as literals, in `hash-rules.fixed-answers.test.ts`. Every release must compute those hashes. Changing an expected hash there is changing the rules.
- **What a release writes.** CI emits the repository's fixtures and examples again and compares them with the committed files (`pnpm fixtures:check`). A change to what a release writes for an unchanged source shows in the pull request's diff: if the hashes moved and the sections did not, the rules changed; if the sections moved, the compatibility policy decides.
- **Families and targets built outside this repository** run the same test with a function Prisma publishes. They emit a few contracts that use every default their normal form leaves out and every list it orders, write down the hashes, and check them in their own test suite:

  ```ts
  import { normalizeSqlStorage } from '@prisma/orm-family-sql/contract/normal-form';
  import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

  assertContractHashes({
    contracts: [
      {
        name: 'a table with every kind of index',
        contract: savedContract, // a parsed contract.json the target emitted
        storageHash: 'b04c6ddd…', // 64 lowercase hexadecimal digits
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
- **A contract's hashes change when its author changes the contract.** A new column gives a new storage hash and arrives with a migration, which writes the new hashes into the marker when it is applied. A change to the capabilities a contract lists gives a new profile hash and no migration, so the author signs each database again with `prisma db sign`, which checks the database and writes the marker, or runs `prisma db update` where the database allows it.
- **Some fixes wait for the next major,** because each would change hashes already recorded: a mistake in the hashing rules, even one that gives two different contracts the same hash; and a family starting to leave out a field that existing contracts write. A field added for a new feature, which no existing contract holds, may have its default left out from the start.
- **The execution hash is recorded only in files,** never in a database, and nothing compares it apart from the fixed-hash test. It is frozen with the others so that an upgrade leaves no file holding a value a new emit would not write.
- **Moving a project from one set of hash rules to another is outside the migration system,** which never changes a recorded hash. When it happens, at a major version, the upgrade instructions do it: a script rewrites the hashes in the project's files, and each database is signed again. `prisma db sign --force` exists for this. A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)); `--force` overrides that one refusal, still checks that the database matches the contract, changes no schema and keeps the database's policies. No error or advice offers it; only upgrade instructions do.
- **After such a move, a database's ledger keeps the old migration hashes.** The ledger is the database's record of each migration applied to it, by the migration's own hash, and a migration's hash covers the storage hashes it starts and ends at. `prisma migration status` matches the ledger against the files, so it no longer shows the earlier migrations as applied. Nothing else decides anything from the ledger: `prisma db migrate` works from the marker, so it applies nothing again and refuses nothing.

## Alternatives considered

- **Compute each hash from the whole contract with every other section emptied, and with the format version included.** Rejected: renaming the format version field, or adding any top-level section, would change every hash, although neither changes what the contract means.
- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** Rejected: the framework cannot know which of those values are defaults. Where the list is incomplete, two different contracts share a hash and the written contract loses what its author wrote ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- **Hash the file as written, by the rules of its format version.** Rejected: the hash would change as soon as a later format version laid out `storage` differently.
- **Record which version of the rules produced a hash, and support several.** Rejected: a project would hold hashes computed two ways, and every comparison would have to compute the hash again by the older rules, which every later release would have to keep.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: every user would run it in every project and sign every database again, for an upgrade that changed nothing they wrote.
- **Have `prisma db migrate` write the marker when only the profile hash differs.** Rejected: a deploy that applies nothing would then change what a production database's marker records. Signing is the step that records a new profile hash when nothing is applied, and it stays a step someone chooses to run.

# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)

## At a glance

A team on Prisma `8.0.0` emits a contract and migrates its production database. Later it upgrades to `8.4` and changes nothing else. `prisma contract emit` writes the same `storageHash`, `profileHash` and `executionHash` as before, so:

- the database still matches the contract, and `prisma db verify` passes;
- every migration still starts where the one before it ends;
- every saved copy of a contract still matches its name.

That holds because each hash is computed from a small, fixed input, by rules that do not change between `8.0.0` and the last `8.x`. The storage hash, for example, is the SHA-256 of exactly this, with its keys sorted ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md) gives the full rules):

```json
{
  "storage": { "...": "the contract's storage section" },
  "target": "postgres",
  "targetFamily": "sql"
}
```

## Terms

- A **family** is a kind of database Prisma supports, such as `sql` or `mongo`. A **target** is one database within a family, such as `postgres` or `sqlite`. A contract names both, as `targetFamily` and `target`.
- A **snapshot** is a copy of a contract that a migration starts or ends at, saved under `migrations/snapshots/<storage hash>/`.
- A **ref file** gives a contract a name, such as `production`, by its storage hash.
- A database's **marker** is a row Prisma keeps in the database. It records the storage hash and the profile hash of the contract the database was last migrated to or signed with. To **sign** a database is to check that it matches a contract and write that contract's hashes into the marker, with `prisma db sign`.
- A database's **ledger** records each migration applied to it, by its **migration hash**: a hash of the migration's own files, which include the storage hashes of the contracts it starts and ends at.

## Decision

### What each hash covers

| Hash | Covers | Tells Prisma |
| --- | --- | --- |
| Storage hash | `targetFamily`, `target`, `storage` | Which contract a database matches; where each migration starts and ends; the name of each snapshot |
| Profile hash | `targetFamily`, `target`, `capabilities` | Which capabilities the contract requires of the database and the connection |
| Execution hash | `targetFamily`, `target`, `execution` | Which defaults the client applies when it writes rows, such as an `id` the client generates |

Nothing else in the file enters a hash. In particular the file's `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)) does not, so the same contract written in two format versions has the same hashes. When Prisma checks a hash against a stored contract, such as a snapshot or the contract an extension package ships, it reads the file, converts an earlier format version to the newest layout, computes the hash again from the sections, and compares the result with the hash the file records.

Two contracts that require different capabilities have different profile hashes. So the profile hash in a database's marker identifies the capabilities the database was signed for.

How a section becomes the text that is hashed is in [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md). In short: the family puts `storage` into its normal form, leaving out the fields it defines as defaults and ordering the lists whose order means nothing to the database; the framework sorts the keys and prints the result. Values the family carries without knowing what they mean, such as a type's parameters or an index's options, which belong to a codec, a target or an extension, are hashed exactly as written.

### The rules do not change within a major

Within a major version, a release may change the code that computes a hash only in ways that give the same hash for the same contract. That includes each family's normal form: for the same contract source and configuration, a family writes the same `storage` in every release of the major.

A test holds this. Each family keeps saved contracts and their expected hashes, written as literals, and every release must compute those hashes. A family or target built outside this repository is bound in the same way and runs the same test with the function Prisma publishes:

```ts
import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

assertContractHashes({
  contracts: [
    {
      name: 'a table with every kind of index',
      contract: savedContract, // a parsed contract.json your target emitted
      storageHash: 'b04c6ddd…',
      profileHash: '833bc812…',
    },
  ],
  normalizeStorage: myFamilySerializer.normalizeStorage,
});
```

It throws `CONTRACT.HASH_MISMATCH`, naming each contract and hash that differs.

A contract's hashes change when the user changes the contract: a new column gives a new storage hash. That change arrives with a migration the user plans, which moves the marker when it is applied. What does not happen is a hash changing because the user upgraded Prisma.

A mistake found in the rules after `8.0.0` stays until the next major. Fixing it would change the hashes recorded in every user's files and databases, which is the change this decision rules out. A stable hash with a known flaw still identifies a contract.

### The capability list does not change within a major

From `8.0.0`, an unchanged contract source with the same configuration requires the same capabilities in every release of the major, so its profile hash does not change.

- On PostgreSQL the author writes the list in the contract ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)), from lists Prisma publishes: one per supported PostgreSQL version, such as `postgres16`, and one for the driver. Each published list is fixed within the major. When `8.3` adds support for a newer PostgreSQL version, it adds that version's list; a contract written with `postgres16` keeps the `postgres16` list.
- On the other targets the contract takes the adapter's fixed list when it is emitted. That list is bound in the same way.

This binds every component that publishes a capability list, inside or outside this repository. It may change a published list only in a major release: a Prisma major for Prisma's own components, and a major release of the component itself for one built outside. The cost is that a feature needing a capability that an already supported database version has always offered waits for the next major. PostgreSQL has tests that pin each version's list and the driver's as literals; a target without such tests relies on review.

Before `8.0.0`, a PostgreSQL contract that lists no capabilities gets a default list, the newest supported version's and the driver's, and that default grows when a newer version is added (ADR 335). From `8.0.0` there is no default.

## Why

Prisma records these hashes in the user's files and in the database: in `contract.json`, in each migration's start and end, in the name of each snapshot, in each ref file, and in the marker. If a release computed a different hash for the same contract:

- every migration would seem to start at a contract no earlier migration ends at;
- every snapshot would seem to have been edited;
- every database's marker would stop matching its contract.

The user could repair that only by hand, in every project and every database.

Each hash covers only what it identifies, so that nothing else can move it. A hash that also covered how the file is laid out, or sections it does not describe, would change whenever those did.

The capability list is frozen for a reason of its own. A marker's profile hash changes only when a command writes the marker:

1. `prisma db sign` writes it.
2. `prisma db update` writes it on every run.
3. `prisma db migrate` writes it only when it applies a migration.

Deploys usually run `prisma db migrate`. A capability change brings no migration, so `db migrate` would report the database as up to date and leave the marker as it was. `prisma db verify` would then fail on every database, and the client would report the marker as not matching. A project that deploys with `db update` would not see this, because that command writes the marker every time.

## Consequences

- An upgrade within a major changes no hash, so it needs no change to a user's files or databases.
- A mistake in the rules, and adding a capability to a supported database version's list, both wait for the next major.
- A family or target built outside this repository carries the same obligation for its part of the rules, and has the same test to hold it.
- A project whose hashes were computed by other rules, such as one created by a Prisma 8 pre-release, cannot be brought to these rules by the migration system, which never changes a recorded hash. The upgrade instructions published for the pre-release do it: a script rewrites the hashes in the project's files, and each database is signed again with `prisma db sign`.
- `prisma db sign --force` exists for that step. A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)), and `--force` overrides that one refusal. It changes no schema, still checks that the database matches the contract before it writes the marker, and leaves the database's policies as they were. No error or advice offers the flag; the upgrade instructions do.
- After that step the ledger still names the old migration hashes. `prisma migration status` matches the ledger against the files, so it shows none of the earlier migrations as applied. Nothing else reads the ledger: `prisma db migrate` decides what to apply from the marker, so it applies nothing again and refuses nothing.

## Alternatives considered

- **Compute each hash from a copy of the whole contract with every other section blank, and with the file's format version in it.** Rejected: the first change to the file format, or to any blank section of that copy, would change every hash.
- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** Rejected: the framework cannot know which of those values are defaults. Each one that is not has to be found and listed, and where the list is incomplete two different contracts share a hash and the written contract loses what its author wrote ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- **Hash the file as written, by the rules of its format version.** Rejected: the hash would change as soon as a later format version laid out `storage` differently.
- **Record which version of the hashing rules produced a hash, and support several.** Rejected: a project would hold hashes computed in two ways, and every comparison would have to convert one into the other.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: an upgrade within a major must need no change to a user's files or databases.
- **Let a minor release add a capability to the list of an existing contract, and have users sign every database again.** Rejected for the same reason.
- **Have `prisma db migrate` write the marker when only the profile hash differs.** Rejected: `db migrate` would then change a production database's marker when it has nothing to apply, and a Prisma upgrade alone would change every database's marker at the next deploy, which is what the freeze exists to prevent.

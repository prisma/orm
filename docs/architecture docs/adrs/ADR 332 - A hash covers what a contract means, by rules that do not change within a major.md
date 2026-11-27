# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)

## At a glance

A team on Prisma `8.0.0` emits a contract and migrates its production database. Later it upgrades to `8.4` and changes nothing else. `prisma contract emit` writes the same `storageHash`, `profileHash` and `executionHash` as before. So the database still matches the contract, `prisma db verify` passes, and none of the team's migration files needs to change.

That holds because each hash is computed from a small, fixed input, by rules that do not change between `8.0.0` and the last `8.x` release. The storage hash, for example, is the SHA-256 of this, once the family has put `storage` into its normal form and the keys are sorted ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md) gives the full rules):

```json
{
  "storage": { "...": "the contract's storage section" },
  "target": "postgres",
  "targetFamily": "sql"
}
```

## Terms

- A **family** is a kind of database Prisma supports, such as `sql` or `mongo`. A **target** is one database within a family, such as `postgres` or `sqlite`. A contract names both, as `targetFamily` and `target`. A family puts `storage` into its **normal form** by leaving out the fields it defines as defaults and ordering the lists whose order means nothing to the database.
- A **capability** is something a database version or a connection provides that a contract may rely on, such as `sql.returning` or `sql.interactiveTransactions` ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)).
- A **snapshot** is a copy of a contract saved under `migrations/snapshots/<storage hash>/`, kept for each contract a migration starts or ends at and for each contract a ref names. A migration names the contracts it starts and ends at by their storage hashes, so migrations connect where one ends at the hash the next starts at.
- A **ref file** gives a contract a name, such as `production`, by its storage hash.
- A database's **marker** is a record Prisma keeps in the database (a row on SQL, a document on MongoDB). It holds the storage hash and the profile hash of the contract the database was last brought to. To **sign** a database is to check that it matches a contract and write that contract's hashes into the marker, with `prisma db sign`.
- A database's **ledger** records each migration applied to it, by its **migration hash**: a hash of the migration's own files, which include the storage hashes it starts and ends at.

## Decision

### What each hash covers

| Hash | Covers | Tells Prisma |
| --- | --- | --- |
| Storage hash | `targetFamily`, `target`, `storage` | Which contract a database matches; where each migration starts and ends; the name of each snapshot |
| Profile hash | `targetFamily`, `target`, `capabilities` | Which capabilities the contract requires of the database and the connection |
| Execution hash | `targetFamily`, `target`, `execution` | Which defaults the client applies when it writes rows, such as an `id` the client generates. It is checked when a contract is emitted and read, and is recorded in no database |

Nothing else in the file enters a hash. In particular the file's `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)) does not, so the same contract written in two format versions has the same hashes.

Prisma checks a stored contract's storage hash by computing it again. It reads the file, converts an earlier format version to the newest layout, computes the hash from the sections, and compares it with the hash the contract is stored under: a snapshot's directory name, or, for the contract an extension package ships with its own migrations, the extension's head ref.

Two contracts that require different capabilities have different profile hashes. So the profile hash in a database's marker identifies the capabilities the database was signed for.

How a section becomes the text that is hashed is in [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md). In short:

1. The family puts `storage` into its normal form.
2. The framework removes each namespace's `kind`, sorts every key, prints the result and hashes it.
3. Data the family carries without knowing what it means, such as a column type's parameters or an index's options, is hashed as written, apart from that key sort. The only exceptions are an empty set of type parameters and an empty set of SQL index options, which are left out as a whole.

### The rules do not change within a major

Within a major version, a release may change the code that computes a hash only in ways that give the same hash for the same contract. That includes each family's normal form, and what each family writes into `storage`: for the same contract source and configuration, a family writes the same `storage` in every release of the major.

A test holds this. Each family keeps saved contracts and their expected hashes, written as literals, in `hash-rules.fixed-answers.test.ts`, and every release must compute those hashes. A family or target built outside this repository is bound in the same way, and runs the same test with the function Prisma publishes. It saves a few `contract.json` files it emitted, writes down their hashes, and calls:

```ts
import { normalizeSqlStorage } from '@prisma/orm-family-sql/contract/normal-form';
import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

assertContractHashes({
  contracts: [
    {
      name: 'a table with every kind of index',
      contract: savedContract, // a parsed contract.json the target emitted
      storageHash: 'b04c6ddd…',
      profileHash: '833bc812…',
      executionHash: 'b0582e3d…',
    },
  ],
  normalizeStorage: normalizeSqlStorage, // a SQL target passes its family's normal form
});
```

It throws `CONTRACT.HASH_MISMATCH`, naming each contract and hash that differs.

A contract's hashes change when its author changes the contract: a new column gives a new storage hash. That change arrives with a migration the author plans, which writes the new hashes into the marker when it is applied. What does not happen is a hash changing because the user upgraded Prisma.

### The capability list does not change within a major

From `8.0.0`, an unchanged contract source with the same configuration requires the same capabilities in every release of the major, so its profile hash does not change.

- **On PostgreSQL** the author writes the list in the contract ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)), from lists Prisma publishes: one per supported PostgreSQL version, such as `postgres16`, and one for the driver, `postgresDriver`. Each published list is fixed within the major. When a minor release adds support for a newer PostgreSQL version, it adds that version's list; a contract written with `postgres16` keeps the `postgres16` list. Before `8.0.0`, a PostgreSQL contract that lists no capabilities gets a default, the newest supported version's list and the driver's, and that default grows when a newer version is added. From `8.0.0` there is no default.
- **On the other targets** the contract takes the adapter's fixed list when it is emitted. That list is bound in the same way. On MongoDB the list is empty.

This binds every component that publishes a capability list, inside or outside this repository. It may change a published list only in its own major release: a Prisma major for Prisma's own components, and a major release of the component itself for one built outside. A user who upgrades such a component across its major gets a new profile hash and signs each database again, as for any change of major.

A capability that an already supported database version has always offered, but that Prisma learns to use only in a minor release, cannot join that version's list until the next major. A minor release can still offer it as a new, separately named list that an author adds to the contract. That changes only the profile hash of the contracts whose authors chose it, and they sign their databases as for any change to the capability list.

PostgreSQL has tests that pin each version's list and the driver's as literals. A target without such tests relies on review.

## Why

Prisma records these hashes in the user's files and in the database: in `contract.json`, in each migration's start and end, in the name of each snapshot, in each ref file, and in the marker. If a release computed a different hash for the same contract:

- every migration would seem to start at a contract no earlier migration ends at;
- every snapshot would seem to have been edited;
- every database's marker would stop matching its contract.

The user could repair that only by hand, in every project and every database.

Each hash covers only what it identifies, so that nothing else can move it. A hash that also covered how the file is laid out, or sections it does not describe, would change whenever those did.

The capability list needs its own freeze, because it can change while the hashing rules stay the same: a release that added a capability to `postgres16` would change the profile hash of every contract that uses that list. No migration would repair the marker, because a marker's profile hash changes only when a command writes the marker:

1. `prisma db sign` writes it.
2. `prisma db init` writes it when it sets up a database.
3. `prisma db update` writes it on every run.
4. `prisma db migrate` writes it only when it applies a migration.

Deploys usually run `prisma db migrate`. A capability change brings no migration, so `db migrate` would report the database as up to date and leave the marker as it was. `prisma db verify` would then fail on every database, and the client would warn that the marker does not match. A project that deploys with `db update` would not see this, because that command writes the marker every time.

## Consequences

- An upgrade within a major changes no hash, so it needs no change to a user's files or databases.
- Some fixes wait for the next major, because each would change hashes already recorded:
  - a mistake in the hashing rules, including one that gives two different contracts the same hash;
  - a family naming a new default to leave out, or changing what it writes into `storage` for an existing contract source;
  - adding a capability to a supported database version's published list.
- A family or target built outside this repository carries the same obligation for its part of the rules, and has the same test to hold it.
- A project whose hashes were computed by other rules, such as one created by a Prisma 8 pre-release, cannot be brought to these rules by the migration system, which never changes a recorded hash. The upgrade instructions for moving from a pre-release do it: a script rewrites the hashes in the project's files, and each database is signed again with `prisma db sign`.
- `prisma db sign --force` exists for that step:
  - A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)), and `--force` overrides that one refusal.
  - It changes no schema, and it still checks that the database matches the contract before it writes the marker.
  - It leaves the database's policies as they were.
  - No error or advice offers the flag; the upgrade instructions do.
- After that step the ledger still names the old migration hashes, because the script changed the storage hashes inside each migration's files, and so each migration's own hash. `prisma migration status` counts a migration as applied only when its hash is in the ledger, so it shows none of the earlier migrations as applied, for good. No command decides what to do from the ledger: `prisma db migrate` decides what to apply from the marker, so it applies nothing again and refuses nothing. `prisma migration log` still lists the ledger, and `db migrate` reads it only to explain a marker that is outside the migration graph.

## Alternatives considered

- **Compute each hash from a stand-in for the whole contract, with every other section empty and the file's format version included.** Rejected: renaming the format version field, or adding any top-level section to the contract, would change every hash, although neither changes what the contract means.
- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** Rejected: the framework cannot know which of those values are defaults. Each one that is not has to be found and listed, and where the list is incomplete two different contracts share a hash and the written contract loses what its author wrote ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- **Hash the file as written, by the rules of its format version.** Rejected: the hash would change as soon as a later format version laid out `storage` differently.
- **Record which version of the hashing rules produced a hash, and support several.** Rejected: a project would hold hashes computed in two ways, and every comparison would have to compute the hash again by the older rules, which every later release would have to keep.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: every user would run it in every project and sign every database again, for an upgrade that changed nothing they wrote.
- **Let a minor release add a capability to an existing published list, and have users sign every database again.** Rejected for the same reason: the change reaches every contract that uses the list, whether or not its author wants the capability. A new, separately named list reaches only the authors who choose it.
- **Have `prisma db migrate` write the marker when only the profile hash differs.** Rejected: `db migrate` would then change a production database's marker when it has nothing to apply, so a Prisma upgrade alone would change every database's marker at the next deploy, which is what the freeze exists to prevent.

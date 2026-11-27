# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md), and in [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md) the statement that a change to the canonicalization rules is handled by emitting and signing again

## At a glance

The storage hash of a contract is the SHA-256 of exactly this, canonicalized:

```json
{
  "storage": { "...": "the contract's storage section" },
  "target": "postgres",
  "targetFamily": "sql"
}
```

The profile hash covers `target`, `targetFamily` and the contract's `capabilities`; the execution hash covers `target`, `targetFamily` and `execution`. Nothing else enters any of them.

A team on `8.0.0` emits a contract and migrates a database. On `8.4`, with the same contract source and the same configuration, `prisma contract emit` writes the same `storageHash` and the same `profileHash`, the database's marker still matches, and every migration still connects to the one before it.

## Decision

### What each hash covers

| Hash | Covers | Identifies |
| --- | --- | --- |
| Storage hash | `targetFamily`, `target`, `storage` | Which contract a database matches; the ends of each migration; the name of each snapshot |
| Profile hash | `targetFamily`, `target`, `capabilities` | The capabilities a contract requires |
| Execution hash | `targetFamily`, `target`, `execution` | The execution defaults a contract carries |

In every family the profile hash covers the contract's capability list, its `capabilities` section, which `prisma contract emit` fills from the configured target, adapter and extensions. Two contracts that list different capabilities have different profile hashes, so the profile hash a database's marker records names the capabilities the database was signed for.

A hash covers the sections named above and nothing else in the file, so the file's `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)) is not an input. Where a hash is checked against a stored contract, such as a snapshot or the contract an extension package ships, the stored section is put into the family's normal form and hashed; for a file this release wrote, that is the section as written. A later format version that lays a section out differently has to convert the stored section to the newest layout before it is hashed, so that the same contract written in two format versions has the same hashes.

The framework sorts the keys of the input and encodes it; it leaves out no value. Before that, the family puts `storage` into its normal form with one function, which leaves out only the fields the family names as its own defaults and orders the storage entries ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)). The same function is applied when the section is written, so the hash input and the written section are one form. A value the family does not own, such as a type's parameters or an index's options, is hashed exactly as given, so two contracts that differ in one have different hashes. A namespace's `kind` is left out of the storage hash.

### The rules do not change within a major

Within a major version, the code that computes a hash may change only in ways that give the same hash for the same contract. A test holds a set of saved contracts with their expected hashes written as literals, and every release must compute the same hashes.

The part of the rules a family or target supplies is bound by the same guarantee, including a family or target built outside this repository. Its author runs the same test on their own saved contracts with the helper the contract package publishes beside the hash functions.

One project never holds hashes computed in two ways. A mistake found in the rules after `8.0.0` therefore stays until the next major. That is accepted: a hash that is stable still identifies a contract.

A release that writes different `storage` content for a contract produces a different storage hash. That is a change to the content, not to the rules, and is allowed: it arrives with a migration, which moves the database's marker.

### The capability list does not change within a major

Within a major version, the capability list Prisma writes for an unchanged contract source and the same configuration does not change either, so the profile hash of an unchanged contract does not change. A release may add a capability only to a list that no existing contract was emitted with. Once a configuration can state a database version (the work on capabilities by database version adds this), a version value that a release accepts gives the same list for the rest of the major.

This binds every component that declares capabilities, inside or outside this repository: a target, an adapter, an extension or a driver. A component that adds a capability on a database version already supported changes the list of every contract that uses it, so that change ships only in a major release: a Prisma major for Prisma's own components, and a major release of the component itself for one built outside this repository. This is the cost of the rule. For example, the Postgres adapter gained three flags in November 2026 (`insertOnConflictTarget`, `jsonAggWithoutTruncation` and `outerReferencesInDerivedTables`); after `8.0.0`, each of them would have waited for a major.

The reason is that a marker's profile hash moves only when a command writes the marker: `prisma db sign`, `prisma db update`, which writes it on every run, and `prisma db migrate` when it applies a migration. Deploys run `prisma db migrate`, and a capability change arrives with no migration, so `prisma db migrate` reports the database as up to date and leaves the marker as it is, `prisma db verify` then fails on every signed database, and the runtime reports the marker as mismatched.

What will hold the rule is a test in each target that pins, as literals, the capability list each supported database version gives, and fails with a message that a change to it needs a major. The work on capabilities by database version is to add that test.

## Why

Prisma records these hashes in the user's files and database: in `contract.json`, in each migration's `from` and `to`, in the name of each snapshot, in each ref file, and in the database's marker. If a release computed a different hash for the same contract, every migration would be cut off from the one before it, every snapshot would read as tampered with, and every database's marker would stop matching its contract. A user could only repair that by hand.

The inputs this record removes did not describe what the hash identifies. The format version describes how the JSON is written. The empty profile hash, roots, domain, extensions and meta were blank fields of a stand-in contract, so a change to that stand-in would have changed every hash.

## Moving to these rules

Removing those inputs changed every existing hash once, before `8.0.0`. A project that used a release candidate moves by the upgrade instructions for that release: a script rewrites the hashes in its files, and each database is signed again with `prisma db sign`. No mechanism in the migration system is built for this.

Each database is first brought to the newest contract with the release it is on, and the upgrade ships in a deploy of its own, which runs `prisma db sign --no-advance-ref` and then `prisma db migrate` for each database that already existed. A database still behind when that deploy reaches it can be signed at the last migration it applied only when its application space alone is behind; a database behind on an extension's migrations is first brought up to date with the previous release. A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)). For it, `prisma db sign --force` overrides that one refusal. It changes no schema, still checks that the database satisfies the contract before it writes the marker, and leaves the database's policies as they were. No error or advice offers the flag; the upgrade instructions do.

The database's ledger keeps the migration hashes it recorded, and every migration hash changes with the hashes it covers. After the move, `migration status` therefore marks no earlier migration as applied. Nothing is applied or refused because of the ledger, so nothing else is affected.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** This was the rule before. Rejected: the framework cannot know which of those values are defaults, the list of exceptions grew with each one found, and where it was incomplete two different contracts shared a hash and the written contract lost what its author wrote.

- **Hash the file as written, by the rules of its format version.** Rejected: it changes the hash as soon as a later format version lays out `storage` differently.
- **Record which version of the hashing rules produced a hash, and support several.** Rejected: a project would hold hashes computed in two ways, and every comparison would have to convert one into the other. Git's plan for a new hash function lists mixing objects hashed two ways in one repository as a non-goal.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: an upgrade within a major must need no change to a user's files or database.
- **Let a minor release add a capability to the list of an existing contract, and have users sign every database again.** Rejected for the same reason: such an upgrade changes every database's marker. Having `prisma db migrate` write the marker when only the profile hash differs was not chosen either: `db migrate` would then write the marker when it has nothing to apply, so upgrading Prisma alone would change every database's marker in the next deploy.

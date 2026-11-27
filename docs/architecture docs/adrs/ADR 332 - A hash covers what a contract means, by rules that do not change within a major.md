# ADR 332 — A hash covers what a contract means, by rules that do not change within a major

**Status:** Accepted
**Date:** 2026-11-24
**Domain:** Contract & Schema, Migration System
**Supersedes:** the lists of hash inputs in [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) ("What contributes to storageHash" and "What contributes to profileHash"), the profile hash inputs in [ADR 031](ADR%20031%20-%20Adapter%20capability%20discovery%20%26%20negotiation.md), [ADR 065](ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md) and [ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)

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

In every family the profile hash covers the contract's `capabilities` section: the capabilities the contract requires of the database and the connection. Two contracts that require different capabilities have different profile hashes, so the profile hash a database's marker records names the capabilities the database was signed for.

A hash covers the sections named above and nothing else in the file, so the file's `formatVersion` ([ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md)) is not an input. Where a hash is checked against a stored contract, such as a snapshot or the contract an extension package ships, the stored section is put into the family's normal form and hashed. A stored section in an earlier format version that lays it out differently is first converted to the newest layout, so that the same contract written in two format versions has the same hashes.

The framework sorts the keys of the input and encodes it. It leaves out no value except the section's own `storageHash`, which each caller removes, and each namespace's `kind`, which it removes itself. Before that, the family puts `storage` into its normal form with one function, `normalizeStorage` on the family's contract serializer (`normalizeSqlStorage`, `normalizeMongoStorage`), which leaves out only the fields the family names as its own defaults and orders the lists whose order means nothing ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)). The same function is applied when the section is written. The contents of a value the family does not own, such as a type's parameters or an index's options, are hashed exactly as given, so two contracts that differ inside one have different hashes; only an empty one is left out as a whole.

### The rules do not change within a major

Within a major version, the code that computes a hash may change only in ways that give the same hash for the same contract. Each family has a test that holds saved contracts to expected hashes written as literals, and every release must compute the same hashes.

The part of the rules a family or target supplies is bound by the same guarantee, including a family or target built outside this repository. Its author runs the same test on their own saved contracts with `assertContractHashes`, published at `@prisma/orm-framework/contract/hashing`. It takes the saved contracts, the hashes expected and the family's `normalizeStorage`.

One project never holds hashes computed in two ways. A mistake found in the rules after `8.0.0` therefore stays until the next major. That is accepted: a hash that is stable still identifies a contract.

A release that writes different `storage` content for a contract produces a different storage hash. That is a change to the content, not to the rules, and is allowed: it arrives with a migration, which moves the database's marker.

### The capability list does not change within a major

Within a major version, the capability list Prisma writes for an unchanged contract source and the same configuration does not change either, so the profile hash of an unchanged contract does not change. A release may add a capability only to a list that no existing contract was emitted with.

This binds every component that declares capabilities, inside or outside this repository: a target, an adapter, an extension or a driver. A component that adds a capability on a database version already supported changes the list of every contract that uses it, so that change ships only in a major release: a Prisma major for Prisma's own components, and a major release of the component itself for one built outside this repository. This is the cost of the rule: a feature that needs a new capability flag on a database version already supported waits for the next major, even when the database has always offered it.

## Why

Prisma records these hashes in the user's files and database: in `contract.json`, in each migration's `from` and `to`, in the name of each snapshot, in each ref file, and in the database's marker. If a release computed a different hash for the same contract, every migration would be cut off from the one before it, every snapshot would read as tampered with, and every database's marker would stop matching its contract. A user could only repair that by hand.

The capability list is frozen because a marker's profile hash moves only when a command writes the marker: `prisma db sign`, `prisma db update`, which writes it on every run, and `prisma db migrate` when it applies a migration. Deploys run `prisma db migrate`, and a capability change arrives with no migration, so `prisma db migrate` reports the database as up to date and leaves the marker as it is, `prisma db verify` then fails on every signed database, and the runtime reports the marker as mismatched.

Each hash covers only what it identifies, so that nothing else can move it. A hash that also covered how the file is written, or parts of the contract it does not describe, would change whenever those did.

## Consequences

- An upgrade within a major changes no hash, so it needs no change to a user's files or databases.
- A mistake in the rules, and a capability a supported database version lacks in its list, both wait for the next major. No test pins a target's whole capability list, so a change to one is caught by review.
- A family or target built outside this repository carries the same obligation for its part of the rules, and has the same test to hold it.
- A project whose hashes were computed by other rules, such as one created by a Prisma 8 pre-release, cannot be moved by the migration system, which has no mechanism for changing a hash. The upgrade instructions move it: a script rewrites the hashes in its files, and each database is signed again with `prisma db sign`.
- `prisma db sign --force` exists for that move. A database whose change policy allows only migrations refuses `db sign` ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)), and `--force` overrides that one refusal. It changes no schema, still checks that the database satisfies the contract before it writes the marker, and leaves the database's policies as they were. No error or advice offers the flag; the upgrade instructions do.
- A database's ledger keeps the migration hashes it recorded. A migration hash covers the storage hashes of its ends, so after such a move `migration status` marks no earlier migration as applied. Nothing is applied or refused because of the ledger.

## Alternatives considered

- **Compute each hash from a copy of the whole contract with every other section blank, and with the file's format version in it.** Rejected: the first change to the file format, or to any blank section of that copy, would change every hash.
- **Have the framework leave out every `false`, empty array and empty object, with a list of paths where they are kept.** Rejected: the framework cannot know which of those values are defaults, so each one that is not has to be found and listed, and where the list is incomplete two different contracts share a hash and the written contract loses what its author wrote ([ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)).
- **Hash the file as written, by the rules of its format version.** Rejected: it changes the hash as soon as a later format version lays out `storage` differently.
- **Record which version of the hashing rules produced a hash, and support several.** Rejected: a project would hold hashes computed in two ways, and every comparison would have to convert one into the other. Git's plan for a new hash function lists mixing objects hashed two ways in one repository as a non-goal.
- **Let the rules change in a minor release, with a command that rewrites hashes.** Rejected: an upgrade within a major must need no change to a user's files or database.
- **Let a minor release add a capability to the list of an existing contract, and have users sign every database again.** Rejected for the same reason: such an upgrade changes every database's marker. Having `prisma db migrate` write the marker when only the profile hash differs was not chosen either: `db migrate` would then write the marker when it has nothing to apply, so upgrading Prisma alone would change every database's marker in the next deploy.

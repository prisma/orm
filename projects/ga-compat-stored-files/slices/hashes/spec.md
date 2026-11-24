# Slice: a hash covers what a contract means, by rules fixed for the major

One pull request. Part of the project in [../../spec.md](../../spec.md), section 2. It follows the format-versions pull request, and is built on its branch.

## What a user sees after it merges

- Every storage, profile and execution hash takes a new value, once. Each is computed from the contract in memory:
  - the storage hash from the target, the family and the storage;
  - the profile hash from the target, the family and the capabilities;
  - the execution hash from the target, the family and the execution section.
- Nothing else enters a hash: no format version, no empty profile hash, roots, domain, extensions or meta. The rules for empty values and storage order that a family or target supplies are unchanged.
- A release-candidate user first deploys every pending migration with the release they are on, then upgrades Prisma in a release of its own: one script from the upgrade instructions rewrites every hash in their files, and that release's deploy runs `prisma db sign` (with `--force` where the database's change policy allows only migrations) and then `prisma db migrate`. An extension author runs the script on the extension package and publishes it again.
- From `8.0.0` the hash rules do not change within the major. A test with saved contracts and their hashes as literals holds them fixed, and a published helper lets a family or target built outside this repository run the same test on its own contracts.

## What it must not do

- Change any rule of canonicalization other than the envelope above. Dropping defaults, the family's `shouldPreserveEmpty` and `sortStorage`, and the removal of namespace `kind` stay as they are.
- Change the migration hash rules. A migration hash changes only because the `from` and `to` hashes it covers change.
- Hash the file as written. Every hash is computed from the contract after reading.
- Add a framework concept beyond the helper. The hashes already exist; the helper is a test of them.

## Done when

- A fixed-answers test holds saved contracts for PostgreSQL, MySQL, SQLite and MongoDB, each with its expected storage, profile and, where present, execution hash as literals.
- The helper is exported from a published package, documented in its README, and used by that test.
- The upgrade script rewrites, for an application and for an extension package: `storageHash`, `profileHash` and `executionHash` in every `contract.json` and `contract.d.ts`; snapshot folder names and the snapshots inside them; `from`, `to` and `migrationHash` in every `migration.json`; the `hash` in every ref file; snapshot paths and hash literals in every `migration.ts`. It refuses a contract that a migration, ref or snapshot depends on whose stored hash does not match its content under the old rules (except the MongoDB snapshots ADR 317 allows), and changes nothing in that case; any other such contract is reported and left alone. A run that is interrupted is finished by running it again. It is safe to run twice.
- The upgrade instructions give the order above, the two deploy lines, how to sign a database that is behind, what a user sees if they skip the signing, and that `migration status` marks no earlier migration as applied afterwards.
- `prisma db sign --force` overrides only the change policy's refusal of `db sign`, and no error or advice offers it.
- Every committed file in the repository, outside frozen history, carries the new hashes; `pnpm fixtures:check` passes in CI.
- A decision record states what each hash covers and that the rules do not change within a major. It supersedes the hash inputs in the record on the storage and profile hashes, and the "re-emit and re-sign" handling of a rule change in the record on canonicalization. The glossary and the docs that list hash inputs follow.
- `/drive-code-review` on the final commit has no open finding. Manual QA has upgraded a release-candidate project with the script and `db sign`, then run `migration status`, `db verify`, `db migrate` and a query on PostgreSQL and MongoDB.

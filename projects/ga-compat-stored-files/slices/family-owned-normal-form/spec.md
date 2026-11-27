# Slice: the framework hashes what a family gives it, and drops nothing

Part of the hash pull request (prisma/orm#31203), because it changes hash inputs and must land before the rules freeze. Part of the project in [../../spec.md](../../spec.md).

## Why

The framework's canonicalizer drops every `false`, `[]` and `{}` it finds in a contract, unless the path is on an exception list. The same walk runs when `contract.json` is written and when a hash is computed. The framework does not know what the values mean, so it drops values that are not defaults:

- A type's parameters: `{ "strict": false, "length": 3 }` and `{ "length": 3 }` get one storage hash.
- A PostgreSQL index's options: `{ "fastupdate": false }` is written as `{}`, so the migration creates the index without `WITH (fastupdate = false)`.
- A MongoDB partial filter: `{ "isAdmin": false }` is written as `{}`, a filter that matches every document.
- A generator's parameters, a clustered collection with no name, storage engine options, an extension pack's own entries, and object members of a value set.

The full list, with a colliding pair for each, is in the research note `wip/ga-compat/dropped-values-finding.md` (not committed); the cases above are its content.

Two contracts that require different databases must not share a hash, and a written contract must not lose what its author wrote. After `8.0.0` the rules cannot change within the major, so this is fixed now, while every hash changes anyway.

## What is built

- **The framework canonicalizer drops nothing.** It sorts keys, applies the top-level order, and encodes. It has no path lists and no knowledge of any field. `shouldPreserveEmpty`, the framework's own required-path patterns, and the hard-coded `generated`, `onDelete`, `onUpdate` and `_generated` rules leave the framework.
- **Each family owns the normal form of its content,** through one function (`normalizeStorage`) that the framework applies when it writes `storage` and when it hashes it, so the two cannot differ. A family leaves out a field only where the family itself defines that the absent field and the value mean the same. It names each such field; nothing is dropped by the shape of its value. The fields a family leaves out today for that reason keep being left out, so written contracts do not gain noise: `many: false`, empty `checks`, a foreign key's `index: false`, `onDelete` and `onUpdate` of `noAction`, `generated: false`, MongoDB index and collation booleans that are `false`, empty `required` and `properties` in a derived MongoDB validator, and the like.
- **Data a family does not own is kept exactly as given,** in the file and in the hash: a type's parameters, an index's options, a MongoDB partial filter expression, clustered index and storage engine options, change stream options, a generator's parameters, the members of a value set, and every field of an entry an extension pack defines.
- **Capabilities:** a flag that is off is left out by the code that builds the capability list, not by the canonicalizer.
- **One form for the file and the hash.** A value is in the hash input exactly when it is in the written section. The PostgreSQL policy's `permissive: false`, kept in the file and left out of the hash today, is in both.
- **The storage ordering a family applies** is part of that same function. The framework does not know what it orders.
- **The upgrade script** (`contract-hash-inputs`, app and extension copies) computes the new hashes by the new rules. Its old-rule half is unchanged.
- **The frozen-hash test keeps its literals:** a file written by the earlier rule is already in the new normal form, so its hash is the same. The hashes that change are those of contracts holding a value the earlier rule dropped.
- **Upgrade instructions:** a project whose source holds such a value gets a new storage hash from `prisma contract emit` after the script, and the database was built without the value. The instructions say how to tell, and that the change ships as a migration.

Tidying the family's code into one coherent mechanism is not part of this slice. After `8.0.0` it is a refactor that must give the same output.

## Tests

- For each defect above: the two contracts of the colliding pair have different hashes, and the written contract holds the value as given. Each test fails before the change.
- A contract with each family-owned default written and left out hashes the same and writes the same file.
- A contract read from its file and written again is byte-identical.
- The hash of a contract written in TypeScript equals the hash of the same contract written in the Prisma schema language, for the existing parity fixtures.
- The upgrade script's new hashes equal the hashes the release computes, on the saved release-candidate fixture.

## Done when

- The tests above pass.
- No `false`, `[]` or `{}` is dropped anywhere except by a rule a family or the capability builder names.
- ADR 010 and ADR 332 describe the split: the framework sorts and encodes; a family owns its normal form, under the same freeze.
- `/drive-code-review` on the final commit has no open finding.

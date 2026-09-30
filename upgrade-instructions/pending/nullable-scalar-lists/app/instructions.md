---
changes:
  - id: reemit-explicit-list-cardinality
    summary: Re-emit contracts with explicit scalar cardinality and nested list element nullability.
  - id: refresh-historical-list-contracts
    summary: Refresh historical contract snapshots and their migration references together.
---

## Re-emit contracts with explicit cardinality

Re-run contract emission from each application's original PSL or TypeScript authoring source using its existing Prisma configuration (`pnpm exec prisma contract emit`, with `--config` where needed). Replace both `contract.json` and `contract.d.ts`, including contracts for composed spaces. Do not patch just the generated declarations or copy old hashes into newly emitted JSON. Applications without lists also need re-emission: every domain `ContractField` now has explicit `many: false` for non-list fields.

For hand-authored contract objects, replace a list's `many: true` with `many: { elementNullable: false }` to preserve its existing strict-element meaning, and set `many: false` on non-list domain fields. Native SQL array columns use the same descriptor; non-array storage columns use `many: false`. If adopting an intermediate representation with a sibling `elementNullable`, move that property into the `many` descriptor and remove the sibling. The old boolean-list and sibling-property representations are rejected. Do not change relation cardinality or mark JSON-backed value-object storage as a native SQL array.

Keep `nullable` unchanged: it describes the whole value, not list elements. Existing `String[]` and `String[]?` declarations and `.many()` calls retain non-null elements. Only when nullable elements are intended, use `String?[]` / `String?[]?` or `.many({ elementsNullable: true })` / `.many({ elementsNullable: true }).nullable()`. The authoring option is plural `elementsNullable`; the emitted descriptor uses singular `elementNullable`. Generated types distinguish `ReadonlyArray<T | null>` from `ReadonlyArray<T> | null`.

Keep explicit `.noCheck('elementNotNull')` / `@noCheck(elementNotNull)` waivers on strict lists. They waive enforcement without permitting null in the declared element type. Do not infer nullable elements from a waiver or replace waivers during this representation upgrade. If intentionally changing a list to nullable elements, remove that now-inapplicable waiver and review the resulting PostgreSQL check-constraint change or MongoDB validator change separately.

## Refresh historical snapshots consistently

Inventory every stored contract pair, not only the current application contract: include migration snapshots, fixture migration chains, composed-space snapshots, and any generated contracts imported by application tooling. Re-emit each historical state from its own authoring source and configuration, preserving that state's extensions, storage mappings, defaults, and explicit waivers. Do not emit today's schema over every historical snapshot.

Use the project's snapshot-store and migration-generation tooling to write each emitted JSON/declaration pair and update its references. The new native-list representation can change contract hashes even when existing strict-list DDL is unchanged. When a hash changes, create the corresponding content-addressed snapshot entry and update imports of both JSON and declarations, migration start/end contract hashes, and dependent migration metadata consistently. Process predecessor states before successors, including all branches and composed-space dependencies; regenerate derived migration identifiers and parent references where the tooling requires it. Preserve the recorded operations unless a separate reviewed schema change is intended.

Do not blanket-replace hexadecimal filenames, rename snapshot directories without updating references, edit hash fields by hand, or delete snapshots still referenced by a migration. Check that every reference resolves and that every stored JSON/declaration pair describes the same historical state. If the original source or a complete reference mapping is unavailable, stop and recover it rather than guessing.

For already-applied migrations, retain the original history and reconcile the database's recorded migration identities and contract markers through the project's supported migration procedure before deploying newly emitted contracts. Do not rewrite applied history or reset a database merely to satisfy the new hashes. Rehearse the transition on a disposable database and verify both the migration graph and database contract verification; a clean typecheck alone cannot establish consistency.

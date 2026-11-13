## Dispatch plan

Slice spec: `projects/nested-mutations/slices/nested-variant-creates/spec.md`. Branch `nested-mutation-variant-creates`, on top of `nested-mutation-docs`. Six dispatches, sequential, in two stacked PRs: dispatches 1–3 are PR 1 (variant creates), dispatches 4–6 are PR 2 (variant scoping of the other operations, branch created from PR 1's head when dispatch 3 is accepted). Tests are written before the implementation in every dispatch that changes source. Each behaviour follows the top-level `variant()` collection; a top-level behaviour that looks wrong is reported to the orchestrator, not copied or fixed.

### PR 1 — variant creates

### Dispatch 1: `variant()` on the mutator and creates of a variant stored in the base table

- **Outcome:** `t.variant(value)` exists on the relation mutator of a polymorphic target, typed as the collection's `variant()`, and returns a mutator whose only method is `create` (one row or an array) taking `VariantCreateInput` with the nested-create relaxation of parent-link foreign keys. `t.create` on a polymorphic target takes `never`. At runtime, `variant()` is built from the related collection's `variant()` (same errors for an undeclared value and a second call), the create descriptor carries the variant value, and the translation writes a variant stored in the base table as one `Insert` with the discriminator set and the variant's fields mapped, on 1:N, 1:1, N:1 and M:N, in `create()` and `update()`. Covered by type tests (positive and negative), graph tests in printed form per layout, and integration tests on Postgres and SQLite that read the stored rows back.
- **Builds on:** The spec's chosen design; slice `filtered-many-writes`' mutator and translation; `createRowOf` with `variantValue`.
- **Hands to:** The variant mutator type and runtime, the `variant` field on the create descriptor, and a translation that passes it to `createRowOf`; polymorphism fixtures that have a polymorphic target on every relation layout the integration tests need (N:1 and M:N to `Task` added if missing, with regenerated emitted fixtures and the SQLite counterpart).
- **Focus:** `src/types.ts`, `src/relation-mutator.ts`, the create branches of `src/mutation-graph/nested-mutations.ts`, the polymorphism fixtures. A variant stored in its own table is refused with a clear error in this dispatch only, until dispatch 2.

### Dispatch 2: creates of a variant stored in its own table

- **Outcome:** `t.variant(v).create(…)` for a variant stored in its own table writes, per row, an `Insert` into the base table and an `Insert` into the variant table that reads the key through `PayloadData`, with the parent link on the base `Insert` per layout (1:N and 1:1 from the parent; N:1 into the parent; M:N into the junction `Insert`), in `create()` and `update()`, one row and an array. The variant table is aliased by the related collection's table scope, the rows are split by the function top level uses (shared, not copied), and a contract without `returning` refuses it as `createAll()` on such a variant does. Covered by graph tests per layout and integration tests on Postgres and SQLite that read back both tables, including a two-row array and a failure in a later operation that rolls back both rows.
- **Builds on:** Dispatch 1's descriptor and fixtures.
- **Hands to:** Variant creates complete on both storage layouts and every relation layout; the dispatch-1 refusal removed.
- **Focus:** The translation and `src/mutation-graph/storage-rows.ts` / `collection-graphs.ts` where the top-level variant chain is built. Relation callbacks inside a variant create behave as at top level; no change to that.

### Dispatch 3: docs and upgrade entry for PR 1

- **Outcome:** The `sql-orm-client` README and the user-facing query docs describe `t.variant(v).create(…)` on both storage layouts and that `t.create` on a polymorphic target needs `variant()`. An `upgrade-instructions/pending/` entry tells app authors to replace `t.create(…)` on a polymorphic target with `t.variant(v).create(…)`. `pnpm check:upgrade-coverage`, `pnpm lint`, `pnpm typecheck`, the package tests and the polymorphism and nested-mutation integration tests on both targets pass.
- **Builds on:** Dispatch 2's finished surface.
- **Hands to:** PR 1 ready for review and the owner's go-ahead to push.
- **Focus:** Docs describe behaviour, not implementation; no `projects/` paths in long-lived files.

### PR 2 — variant scoping of the other operations

### Dispatch 4: `connect` and `disconnect` on a variant

- **Outcome:** The variant mutator has `connect` on every layout and `disconnect` on 1:N, 1:1 and M:N, each limited to rows of the variant with the condition the variant collection builds (discriminator `eq`, or `pk IN (subquery over the variant table)`). `connect` to a row of another variant behaves as `connect` to a missing row on that layout (`ORM.RELATION_ROW_MISSING` on N:1 and M:N; nothing linked and no error on 1:N and 1:1); `disconnect` leaves a related row of another variant linked. `disconnect` on N:1 takes `never` on the variant mutator. Covered by type tests, graph tests, and integration tests on Postgres and SQLite for both storage layouts.
- **Builds on:** Dispatch 1's variant mutator and descriptor field (the descriptor for `connect`/`disconnect` gains the same field).
- **Hands to:** Variant `connect` and `disconnect`; the N:1 `disconnect` slot left for the rebase onto `single-row-writes`.
- **Focus:** `addParentOwned`, `addChildOwned`, `addJunctionOwned`, `addFindAndAssert`, `requiredCriterion`.

### Dispatch 5: `where`, `updateAll`, `deleteAll` on a variant

- **Outcome:** `t.variant(v).where(w).updateAll(data)`, `.deleteAll()`, and both without `where`, on 1:N and M:N, act only on related rows of the variant, on both storage layouts. The `where` callback receives the variant-aware accessor, so variant fields can be filtered and `updateAll` data takes the variant's fields, as `db.Task.variant(v).where(…).updateAll(…)` does. The existing rejections hold. Covered by type tests, graph tests, and integration tests on Postgres and SQLite where a related row of another variant matches the filter and is unchanged.
- **Builds on:** Dispatch 4.
- **Hands to:** The variant mutator mirrors the variant collection for every operation the mutator has.
- **Focus:** `FilteredRelationMutator` types, the descriptor state, `addFilteredWrite`; how `countMutationWhere` reaches the nested filtered writes for a variant in its own table.

### Dispatch 6: docs for PR 2

- **Outcome:** README and query docs describe the scoping of `connect`, `disconnect`, `where`, `updateAll` and `deleteAll` on a variant and that N:1 `disconnect` is not available on a variant. The pending upgrade entry still holds. The same gates as dispatch 3 pass.
- **Builds on:** Dispatch 5.
- **Hands to:** PR 2 ready for review. After a rebase onto `single-row-writes`, an extra dispatch adds N:1 `disconnect` on a variant on that slice's conditional unlink (slice-DoD).
- **Focus:** Docs only.

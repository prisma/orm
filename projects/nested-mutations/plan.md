# nested-mutations — Plan

**Spec:** `projects/nested-mutations/spec.md`
**Linear Project:** none; the project is not tracked in Linear, by decision of the project owner

## At a glance

Four slices. Three have no dependency on each other and can be built in parallel: filtered many-row writes with array returns, the conflict options on nested `create`, and the `hasOne` uniqueness rule in TypeScript authoring. The fourth, nested `upsert`, builds on two of them. Each slice ports the upstream tests that its operations make portable.

## Composition

### Stack (deliver in order)

1. **Slice `filtered-many-writes`** — `projects/nested-mutations/slices/filtered-many-writes/` — PR [#30634](https://github.com/prisma/orm/pull/30634) (source, tests, docs) and a stacked ports PR from `nested-mutations-ports`
   - **Outcome:** Inside `update()`, a relation callback can return `r.where(w).updateAll(data)` and `r.where(w).deleteAll()`, with `where` optional, on one-to-many and many-to-many relations; and a relation callback can return an array of operations, applied in order, in both `create()` and `update()`. Only rows related to the parent are changed or deleted.
   - **Builds on:** None.
   - **Hands to:** A relation callback that accepts an array, and a mutator with a `where` step, in the types and the executor. Slice 2 adds `upsert` as another operation alongside these and uses the array form in its ports.
   - **Focus:** The array return, `where`, `updateAll`, `deleteAll`; their rejection on to-one relations and in `create()`; many-to-many `deleteAll` deleting target rows only. Ports: `nested_update_many_inside_update.rs` (8), `nested_delete_many_inside_update.rs` (6), `unchecked_nested_update_many.rs` (4), `top_level_mutations/delete_many.rs` › nested (1), `prisma_8265.rs` (1), `filter_unwrap.rs` (1, its non-ported entry removed), and `create_then_disconnect` from the combining suite. Ledger entries that cite a missing nested `updateMany`/`deleteMany` are rewritten. `upsert` and the conflict options are other slices.

2. **Slice `nested-upsert`** — `projects/nested-mutations/slices/nested-upsert/`
   - **Outcome:** Inside `update()`, a relation callback can return `r.upsert({ create, update, conflictOn? })`. On a to-one relation it updates the linked row or creates and links one. On a to-many relation it finds the row by conflict columns and updates it only if it is related to the parent; a conflicting unrelated row raises `ORM.NESTED_UPSERT_CONFLICT`. Works on Postgres and SQLite.
   - **Builds on:** Slice 1's array return and mutator shape; slice `has-one-unique`'s guarantee that a `1:1` relation with the key on the child has a unique foreign key.
   - **Hands to:** Project close-out. Nothing downstream consumes it.
   - **Focus:** The condition on the insert conflict action in the SQL AST and its rendering in the Postgres and SQLite adapters; the executor paths for the three relation layouts; the new error code and its entry in the error reference; rejection in `create()` and on inheritance variants. Ports: `nested_upsert_inside_update.rs` (5), `byoid.rs` (2), `multi_field_uniq_mutation.rs` (1), `non_embed_updated_at_should_change.rs` (1), `ref_actions/on_update/set_null.rs` (1), `sharding/relations.rs` (1), `create_then_upsert` from the combining suite, and the three relation-key files that mix `upsert` with `updateMany`/`deleteMany` (`compound_pk_rel_field.rs`, `single_pk_rel_field.rs`, `compound_uniq_rel_field.rs`, 12 tests). The `optimistic-concurrency-control` ledger entry is rewritten to name only `increment`.

### Parallel group A (independent of the stack and group B)

- **Slice `create-on-conflict`** — `projects/nested-mutations/slices/create-on-conflict/`
  - **Outcome:** Nested `create` takes `{ onConflict: 'skip' | 'connect', conflictOn? }` in `create()` and `update()`. `'skip'` leaves out colliding rows on one-to-many relations. `'connect'` links the existing row on every relation layout and leaves its other fields unchanged.
  - **Builds on:** None.
  - **Hands to:** Project close-out. Nothing downstream consumes it.
  - **Focus:** The options argument on nested `create` and its types; `'skip'` rejected on to-one and many-to-many; both values rejected on inheritance variants; `'connect'` not offered on top-level `createAll`; the one-statement insert that returns the row on conflict, and the link written after it per layout. Ports: `nested_create_many.rs` (5, with the `skipDuplicates` non-ported entry removed), `nested_connect_or_create.rs` (6), `prisma_11731.rs` (2), `if_node_siblig_dep_regression.rs` (1), `nested_pagination.rs` (3), `prisma_27452.rs` (1). No SQL AST change is expected: both conflict actions it needs exist today.

### Parallel group B (independent of group A; slice 2 of the stack depends on it)

- **Slice `has-one-unique`** — `projects/nested-mutations/slices/has-one-unique/`
  - **Outcome:** TypeScript contract authoring rejects a `hasOne` relation whose `by` fields are not covered by a unique constraint on the child model, with an error naming the relation and the fields, as PSL authoring already does. PSL-authored and TypeScript-authored contracts agree on what a valid `1:1` relation is.
  - **Builds on:** None.
  - **Hands to:** The guarantee slice `nested-upsert` relies on to use the child's foreign key as a conflict target.
  - **Focus:** The rule in `packages/2-sql/2-authoring/contract-ts`; the in-repo contracts that break under it (`test/e2e/framework/test/sqlite/fixtures/contract.ts`, `test/integration/test/sql-builder/fixtures/contract.ts`, `contract-no-pgvector.ts`, and the package's own tests) and their regenerated fixtures; the upgrade-instructions entry for app authors. The contract validator is not changed.

## Dependencies (external)

- [ ] **`port-all-tests` project** — owns the port corpus, its checklists and its ledgers, which every slice here edits. It is in progress; edits to the same checklist files from that project and this one can collide.
- [ ] **Pinned upstream sources** — ports are written from `prisma/prisma-engines` at `e922089b` and `prisma/prisma` at `a6d01554`. Neither is vendored in the repo; each slice needs a checkout.
- [ ] **Release** — the affected packages are internal (`@internal/sql-orm-client`, `@internal/sql-contract-ts`, `@internal/sql-relational-core`, all at `8.0.0-rc.14`). Users get each slice with the first published release after it merges; which version that is has not been decided.

## Sequencing rationale

- `nested-upsert` waits for `has-one-unique` because of the spec's transitional-shape constraint: the uniqueness rule merges before, or together with, the to-one upsert that depends on it. Shipping the rule separately keeps a breaking authoring change out of an ORM feature PR.
- `nested-upsert` waits for `filtered-many-writes` for two reasons: its `create_then_upsert` port needs the array return, and the three relation-key files it ports also use `updateMany` and `deleteMany`.
- `create-on-conflict` and `filtered-many-writes` have no dependency on each other, but both change the relation mutator's types and the same executor file, so the second one to merge will have to rebase over the first.
- `nested-upsert` is the largest slice: it spans the SQL AST, two adapters and the ORM, plus about 24 ports. If its slice plan shows the PR is too large to review in one sitting, the natural cut is to move the 12 relation-key ports into a follow-up slice, which would make five slices.

# nested-mutations — Plan

**Spec:** `projects/nested-mutations/spec.md`
**Design record:** `projects/nested-mutations/mutation-graph.md`
**Linear Project:** none; the project is not tracked in Linear, by decision of the project owner

## At a glance

Seven slices in two stages. Stage 1 (three slices, in order) moves every write method of the collection onto the mutation graph with no new behaviour, and removes the nested-write executor. Stage 2 (four slices) adds the project's operations as entries in the graph's translation. `has-one-unique` does not touch the ORM client and can be built at any time.

Seven is more than the one to four slices a project should have. Stage 1 could be a project of its own; it is kept here because the project owner asked for the graph to be worked into this project.

PR [#30634](https://github.com/prisma/orm/pull/30634), the first build of `filtered-many-writes` on the executor, is closed without merging. Its mutator types, integration tests and docs are reused in slice 4. PR [#30642](https://github.com/prisma/orm/pull/30642), its ports, is rebased onto slice 4.

## Composition

### Stage 1 — stack (deliver in order)

1. **Slice `graph-core`** — `projects/nested-mutations/slices/graph-core/`
   - **Outcome:** The mutation graph exists (node classes, edge classes, the graph with `add` and `replace`, the `peephole()` hook, a printed text form, the runner), and `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount` called without relation callbacks run through it. Every integration test on main passes unedited on Postgres and SQLite.
   - **Builds on:** None.
   - **Hands to:** `Find`, `Update`, `Delete`, `FilterData`, the runner's rules (dependency order, skip on empty source, collect or stream, transaction when more than one statement, caller's selection returned by the result node, includes loaded afterwards), and the printed form graph tests assert against.
   - **Focus:** The smallest graphs: one node for the bulk methods, `Find` then a write for the single-row methods. `update()` with relation callbacks still goes to the executor in this slice. No `State` nodes yet: no graph here has two nodes on one table that need an order the data edges do not give.

2. **Slice `graph-creates`** — `projects/nested-mutations/slices/graph-creates/`
   - **Outcome:** `create`, `createAll`, `createAndCount` and `upsert` called without relation callbacks run through the graph, including variants stored in the base table and variants stored in their own table. Every integration test on main passes unedited on Postgres and SQLite.
   - **Builds on:** Slice 1's graph and runner.
   - **Hands to:** `Insert` with its conflict clause, `PayloadData`, `Merge`, and variant creates as graph translation, which slice 3 uses when a nested call creates a variant.
   - **Focus:** `#executeMtiCreate` is replaced: base insert, variant insert with a data edge for the key, `Merge` as the result, base-then-variant order and the returned row as main's tests pin them. An `Insert` node is one statement with one or many rows; the translation decides the batching and creates several nodes when the rows cannot go into one statement. How the rows of several nodes are combined into the result, in input order, is part of this slice's design. `create()` with relation callbacks still goes to the executor in this slice.

3. **Slice `graph-nested`** — `projects/nested-mutations/slices/graph-nested/`
   - **Outcome:** `create()` and `update()` with relation callbacks run through the graph: nested `create`, `connect` and `disconnect` on the three relation layouts are entries in one translation. `mutation-executor.ts` and the branch on relation callbacks are removed. Every integration test on main passes on Postgres and SQLite, unedited except for the three decided behaviour changes.
   - **Builds on:** Slices 1 and 2: every node and edge class, and the plain `create` and `update` graphs the nested nodes attach to.
   - **Hands to:** The translation table (operation by relation layout), `Assert`, `State` nodes with the ordering rules of the design record (D4, D5), and input rejected while the graph is built. Stage 2 slices add rows to that table.
   - **Focus:** One translation entry per operation and layout, each with a graph test. Nested calls gain what plain calls have: annotations on every statement, variant handling, the selection returned by the write with no reload. Junction `connect` takes its decided behaviour here: a conflict clause where the junction has a key over exactly its link columns, a plain insert otherwise, no duplicate check, no wrapped error; `ORM.RELATION_LINK_DUPLICATE` is removed, with the error reference and an upgrade entry. The contract validator gains a minimum length of 1 on a relation's link-column lists, and the executor's guards for empty lists are not carried into the graph. A relation field that is not a callback is rejected with `ORM.RELATION_MUTATION_INVALID`. Invalid nested input is rejected while the graph is built, including when the filter matches no row; a test on main that asserts `null` for that case is edited.

### Stage 2 — after stage 1

4. **Slice `filtered-many-writes`** — `projects/nested-mutations/slices/filtered-many-writes/` (slice spec exists; its dispatch plan is for the executor and is rewritten when the slice is picked up)
   - **Outcome:** Inside `update()`, a relation callback can return `r.where(w).updateAll(data)` and `r.where(w).deleteAll()`, with `where` optional, on one-to-many and many-to-many relations; a relation callback can return an array of operations, applied in order, in both `create()` and `update()`. Only rows related to the parent are changed or deleted.
   - **Builds on:** Slice 3's translation table and state rules.
   - **Hands to:** The array return and the mutator's `where` step; the peephole that inlines a junction `Find` as `IN (SELECT ...)`. Slice 7 adds `upsert` beside these and uses the array form in its ports.
   - **Focus:** Translation entries for `updateAll` and `deleteAll`; the inlining peephole, which ships in this slice because many-to-many `updateAll` and `deleteAll` are not usable without it; the row-value form of `IN` for composite keys, added to the SQL AST and both adapters. Reused from #30634: the mutator types for these operations, the integration tests, the README and error-reference text, the upgrade entry. Ports: the 22 tests the slice spec lists, from #30642.

5. **Slice `create-on-conflict`** — `projects/nested-mutations/slices/create-on-conflict/`
   - **Outcome:** Nested `create` takes `{ onConflict: 'skip' | 'connect', conflictOn? }` in `create()` and `update()`. `'skip'` leaves out colliding rows on one-to-many relations. `'connect'` links the existing row on every relation layout and leaves its other fields unchanged.
   - **Builds on:** Slice 3's translation table. Independent of slice 4.
   - **Hands to:** Project close-out. Nothing downstream consumes it.
   - **Focus:** The options argument on nested `create` and its types; `'skip'` rejected on to-one and many-to-many; both values rejected on inheritance variants; `'connect'` not offered on top-level `createAll`; the `Insert` that returns the row on conflict, and the link written from it per layout by a data edge. Ports: `nested_create_many.rs` (5, with the `skipDuplicates` non-ported entry removed), `nested_connect_or_create.rs` (6), `prisma_11731.rs` (2), `if_node_siblig_dep_regression.rs` (1), `nested_pagination.rs` (3), `prisma_27452.rs` (1).

6. **Slice `has-one-unique`** — `projects/nested-mutations/slices/has-one-unique/` (independent of every other slice; can be built during stage 1)
   - **Outcome:** TypeScript contract authoring rejects a `hasOne` relation whose `by` fields are not covered by a unique constraint on the child model, with an error naming the relation and the fields, as PSL authoring already does.
   - **Builds on:** None.
   - **Hands to:** The guarantee slice 7 relies on to use the child's foreign key as a conflict target.
   - **Focus:** The rule in `packages/2-sql/2-authoring/contract-ts`; the in-repo contracts that break under it (`test/e2e/framework/test/sqlite/fixtures/contract.ts`, `test/integration/test/sql-builder/fixtures/contract.ts`, `contract-no-pgvector.ts`, and the package's own tests) and their regenerated fixtures; the upgrade-instructions entry for app authors. The contract validator is not changed.

7. **Slice `nested-upsert`** — `projects/nested-mutations/slices/nested-upsert/`
   - **Outcome:** Inside `update()`, a relation callback can return `r.upsert({ create, update, conflictOn? })`. On a to-one relation it updates the linked row or creates and links one. On a to-many relation it finds the row by conflict columns and updates it only if it is related to the parent; a conflicting unrelated row raises `ORM.NESTED_UPSERT_CONFLICT`. Works on Postgres and SQLite.
   - **Builds on:** Slice 4's array return and mutator shape; slice 6's unique foreign key on `1:1` relations.
   - **Hands to:** Project close-out. Nothing downstream consumes it.
   - **Focus:** The condition on the insert conflict action in the SQL AST and its rendering in both adapters; translation entries for the three layouts, with `Assert` on the `Insert` raising the new error; rejection in `create()` and on inheritance variants. The slice's design checks the to-one case against the rule that the graph has no conditional nodes (design record D6). Ports: `nested_upsert_inside_update.rs` (5), `byoid.rs` (2), `multi_field_uniq_mutation.rs` (1), `non_embed_updated_at_should_change.rs` (1), `ref_actions/on_update/set_null.rs` (1), `sharding/relations.rs` (1), `create_then_upsert` from the combining suite, and the three relation-key files that mix `upsert` with `updateMany`/`deleteMany` (12 tests). The two matrix suites among these use the `_fixture/` directory the slice 4 ports share. The `optimistic-concurrency-control` ledger entry is rewritten to name only `increment`.

## Dependencies (external)

- [ ] **`port-all-tests` project** — owns the port corpus, its checklists and its ledgers, which slices 4, 5 and 7 edit. Edits to the same checklist files from that project and this one can collide.
- [ ] **Pinned upstream sources** — ports are written from `prisma/prisma-engines` at `e922089b` and `prisma/prisma` at `a6d01554`. Neither is vendored in the repo; each porting slice needs a checkout.
- [ ] **Integration suite** — it runs in the merge queue, not on pull requests, and this account cannot start the workflow by hand. Stage 1's bar is that suite, so each stage 1 slice runs `pnpm test:integration` locally on both targets before its PR opens.
- [ ] **Other work on `collection.ts`** — stage 1 rewrites the write half of a 3,385-line file on main. Any other branch that edits its write methods conflicts with slices 1 to 3.

## Sequencing rationale

- Stage 1 is cut by write method, so that after each slice a method is wholly on the graph or wholly on main's code, and each PR is one reviewable change: the graph with its simplest users, then inserts and variants, then relations and the removal of the executor.
- `graph-nested` comes last in stage 1 because nested nodes attach to the plain `create` and `update` graphs, and because removing the executor needs every method that calls it to have moved.
- Stage 2 waits for stage 1 because each feature is a row in the translation table that slice 3 delivers. Building features on the executor is what PR #30634 did.
- `filtered-many-writes` is first in stage 2: most of it is already written and tested against behaviour, its ports exist, and `nested-upsert` needs its array return.
- `create-on-conflict` and `filtered-many-writes` have no dependency on each other; both add rows to the same translation table and change the mutator's types, so the second to merge rebases over the first.
- `nested-upsert` waits for `has-one-unique` because of the spec's constraint that the uniqueness rule merges before, or together with, the to-one upsert that depends on it.
- `nested-upsert` is the largest stage 2 slice. If its slice plan shows the PR is too large for one review, the 12 relation-key ports move into a follow-up slice.

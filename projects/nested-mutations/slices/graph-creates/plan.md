## Dispatch plan

Slice spec: `projects/nested-mutations/slices/graph-creates/spec.md`. Three dispatches, sequential. Tests first in each.

### Dispatch 1: the new node and edge classes

- **Outcome:** `Insert`, `InsertChunked`, `CrossJoin`, `UnionAll`, `PayloadData` and `Rows` exist under `src/mutation-graph/`, one file per class, with unit tests of each `execute` and `output` against a fake `Run`, and the test printer prints them. Nothing outside the directory uses them yet.
- **Builds on:** Slice `graph-core`'s graph, runner and node base.
- **Hands to:** The classes dispatch 2's builders compose.
- **Focus:** The class contracts in the slice spec. `CrossJoin` and `UnionAll` have no statement: their `execute` returns rows built from their inputs, and they return storage rows like every node. If the runner's handling of a node without a statement needs a change, it is made here and reported.

### Dispatch 2: create, createAll, createAndCount, upsert without variants in their own table

- **Outcome:** The four methods build their graphs with `createGraph` / `upsertGraph` and run them, for every collection that is not a variant stored in its own table. Includes end in a `Find`. Every existing test of these methods passes.
- **Builds on:** Dispatch 1's classes.
- **Hands to:** The builders, to which dispatch 3 adds the variant chain.
- **Focus:** Batching through `InsertChunked`, `onConflict: 'skip'`, `upsert`'s conflict clause including the nothing-to-update form, create defaults, annotations. The variant path still calls `#executeMtiCreate` in this dispatch.

### Dispatch 3: variants stored in their own table, and the slice gates

- **Outcome:** `create` and `createAll` on a variant stored in its own table build the chain of `Insert`, `Insert` with `PayloadData`, `CrossJoin`, joined by `UnionAll` for several rows; `#executeMtiCreate` and every helper nothing calls are removed. Full gates pass: package tests, typecheck, lint, `lint:deps`, `check:upgrade-coverage`, the scoped integration run.
- **Builds on:** Dispatch 2's builders.
- **Hands to:** The slice ready for its PR, stacked on `mutation-graph-core`.
- **Focus:** The combined row must equal main's (`mapPolymorphicRow` over the base row and the variant row with its columns renamed as main renames them). Report what main does for `select` and `include` here.

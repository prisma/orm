## Dispatch plan

Slice spec: `projects/nested-mutations/slices/graph-core/spec.md`. Three dispatches, sequential. Tests are written before the implementation in every dispatch.

### Dispatch 1: the graph data structure

- **Outcome:** `src/mutation-graph/` holds the node classes `Find`, `Update`, `Delete`, the edge classes `After` and `IntoWhere`, the graph (`add`, `replace`, `inputsOf`, `usersOf`, result), the `peephole` hook called by `add` with the rule that an `Update` setting nothing is removed, and the function that prints a graph as text. Unit tests cover each, and nothing outside the directory uses it yet.
- **Builds on:** The slice spec's chosen design.
- **Hands to:** The classes and the printed form that dispatch 2's runner and graph tests use.
- **Focus:** Data structure only: no execution, no compile calls, no change to `collection.ts`. Nodes are frozen and hold static content only. What "removed" means for a result node that is an `Update` setting nothing is defined here (the graph's result becomes empty), because dispatch 2 depends on it.

### Dispatch 2: the runner and the four bulk methods

- **Outcome:** A runner executes a graph as the slice spec describes, and `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` build a graph and call it. Every existing unit, type and integration test of those four methods passes on Postgres and SQLite, with statement-level unit tests rewritten as the slice spec allows.
- **Builds on:** Dispatch 1's classes and printed form.
- **Hands to:** The runner with all its rules except skip-on-empty-source in real use: dependency order, derived returned columns, collect or stream, annotations on every statement, transaction when more than one statement. Dispatch 3 adds the first graphs with a data edge.
- **Focus:** One-node graphs, plus `Find` then `Delete` joined by `After` for `deleteAll()` with includes. The runner is written for the general case and tested with hand-built graphs, including a two-node graph with `IntoWhere` and an empty source, even though no method builds one yet.

### Dispatch 3: the two single-row methods, and the slice gates

- **Outcome:** `update()` without relation callbacks and `delete()` build `Find` then `Update` or `Delete` joined by `IntoWhere` and run through the runner; the private helpers of `collection.ts` that nothing calls any more are removed. The full gates pass: package tests, typecheck, lint, `pnpm lint:deps`, `pnpm test:integration` on both targets, `pnpm check:upgrade-coverage` with a pending entry of `changes: []`.
- **Builds on:** Dispatch 2's runner.
- **Hands to:** The slice ready for its PR: six methods on the graph, the executor and the create and upsert methods untouched.
- **Focus:** The `Find` that carries the collection's read state and returns the identity columns; `null` when no row matches or after `limit(0)`; `ORM.ROW_IDENTITY_MISSING` raised while the graph is built. `update()` with relation callbacks still calls the executor.

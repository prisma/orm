# Slice: graph-core

Parent project `projects/nested-mutations/`. First slice of stage 1. It delivers the mutation graph and moves the six update and delete methods of the collection onto it, with no change in what a caller gets back.

## At a glance

After this slice, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount`, called without relation callbacks, each build a mutation graph and hand it to one runner. `update()` with relation callbacks, and every create and upsert method, keep main's code.

The graphs are the smallest ones the design has:

```
updateAll(data)                 deleteAll() with includes        update(data)
  n1 Update user set … where …    n1 Find   user where …           n1 Find   user where … (first row)
  result: n1 rows                 n2 Delete user where … <- After n1   n2 Update user set … <- FilterData n1 (id->id)
                                  result: n1 rows                  result: n2 first row
```

## Chosen design

The design is in [`../../mutation-graph.md`](../../mutation-graph.md) and the rules in the project spec § How it is built. This slice builds the parts of it that its six methods use, and nothing else.

### What is built

| Part | In this slice | Later |
| --- | --- | --- |
| Node classes | `Find`, `Update`, `Delete` | `Insert`, `Merge` (slice 2); `Assert`, `State` (slice 3) |
| Edge classes | `FilterData`; `After` through `graph.after` | `PayloadData` (slice 2); the table-state edge (slice 3) |
| Graph | `add(node, inputs)`, `after(from, to)`, `replace(id, next)`, edges into and out of a position, the result | |
| Peephole | the `peephole(graph)` hook called by `add`; one rule: an `Update` that sets nothing is removed | the inlining rule (slice 4) |
| Printed form | one function that prints a graph as text, in the form shown above | |
| Runner | one function that executes a graph | |

### Rules the code follows

- **Location.** A directory `src/mutation-graph/` in `packages/3-extensions/sql-orm-client`. One file per concern (nodes, edges, graph, printed form, runner); no file re-exports another.
- **A node holds its statement as SQL AST** (`Find` a `SelectAst`, `Update` an `UpdateAst`, `Delete` a `DeleteAst`), built by the graph builder. It holds nothing that comes from another node and nothing about what it returns; the runner applies edges and derived columns with the AST's `withWhere` and `withReturning`. Nodes are frozen; `peephole` returns the node itself or a replacement.
- **The graph is a bidirectional adjacency list with stable positions** (design record D10a). `add` returns the node's position; an edge is one object with `from` and `to` as positions, listed at both of its nodes, and for `FilterData` a list of `[sourceColumn, targetColumn]` pairs; a removed node leaves its slot empty.
- **The graph names its result**: a node, a form (rows, first row, or count), and the caller's selection and includes.
- **Edges resolve data, nodes execute** (design record D2b, D9). An edge class has `output(sourceRow)`; a node class is generic over its input slots and has `execute(inputs, run)`; `graph.add(node, inputs)` is typed by the node. `execute` receives `null` for an absent edge and otherwise a list with one output per source row, empty when the source had none, and decides itself what an empty list means. Adding a data edge makes its source return the columns the edge reads. Order-only edges are added with `graph.after(from, to)`.
- **The runner** is a loop over the nodes in position order: resolve each input edge by calling `output` for every row of its source, call `execute`, keep what it returns. Besides that it:
  - collects a node's row stream when another node reads from it, and passes the result node's stream through otherwise;
  - turns the result node's storage rows into the caller's rows in a step described by the graph's result (model and variant, selected fields, includes loaded by the existing read code);
  - puts the caller's annotations on every statement;
  - opens a transaction through the existing mutation scope when the graph has more than one node.
- **The collection methods only build a graph and call the runner.** Argument checks that exist today (`assertLockCompatible`, `assertBulkWriteIgnoresNothing`, `assertReturningCapability`, `assertModelFieldNames`, unknown-field refusal, update defaults) keep running at the same point relative to the first statement.
- **No relation knowledge anywhere in this slice.** There is no translation table yet; it arrives with the first relation operation in slice 3.

### The `Find` of the single-row methods

`update()` and `delete()` choose their row the way `first()` does: the collection's order, offset, cursor, `distinct` and `distinctOn` decide which row it is, and `limit(0)` means no row. So the graph builder compiles that read state into the `Find` node's `SelectAst` with the existing select compiler. The row it returns is identified by the table's identity columns (primary key or a unique constraint); a table with neither is refused with `ORM.ROW_IDENTITY_MISSING`, as today, while the graph is built.

## Coherence rationale

One reviewer reads this as: a small data structure with its tests, a runner with its tests, and six method bodies that shrink to "build a graph, run it". Each method is wholly on the graph or wholly untouched. Nothing a caller can observe changes, so there is no behaviour to review beyond the existing integration suite passing.

## Scope

**In:**

- `src/mutation-graph/` as described above, with unit tests for the graph, the peephole rule, the printed form and the runner.
- The bodies of `update` (the branch without relation callbacks), `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount` in `src/collection.ts`, and the private helpers only they use (`#updateAllWithAnnotations`, `#deleteAllWithAnnotations`, `#executeDeleteReturning`, `#executeDeleteReturningWithIncludes`, `#findFirstMatchingRowIdentityWhere` if nothing else uses it afterwards).
- Unit tests of those methods that assert statements or statement counts: rewritten to assert behaviour, or the printed graph, or removed when an integration test covers the same thing.
- A pending upgrade-instructions entry with `changes: []`.

**Deliberately out:**

- `update()` with relation callbacks, `mutation-executor.ts`, `create*`, `upsert`. If `upsert` calls a helper this slice changes, the helper keeps a form `upsert` can still call; `upsert` itself is not moved.
- `Insert`, `PayloadData`, `Merge`, `Assert`, `State`, any translation of relation operations.
- Reads: `first`, `all`, includes. They are called, not changed.
- Package README and user docs: nothing a user can observe changes.

## Pre-investigated edge cases

| Case | Behaviour that must hold |
| --- | --- |
| `updateAll({})`, `updateAndCount({})`, `update({})` | No update statement. `updateAll` yields no rows, `updateAndCount` resolves `0`. For `update({})`, keep what main returns today. This is the peephole rule. |
| `deleteAll()` with includes | The rows are read with their includes first and collected, then the delete runs, in one transaction; the read rows are the result. `Find` then `Delete` joined by `After`. |
| `updateAll` / `update` with includes | The write returns identity columns and the rows are loaded by the existing read code (`dispatchMutationRows` does this today). |
| `update()` / `delete()` matching no row, or after `limit(0)` | Resolves `null`; the write is skipped. |
| A caller-supplied transaction | The runner uses it and does not open another. |
| Variant collections | `updateAndCount` and `deleteAndCount` pass the variant to the compile functions today; the nodes carry what those functions need. |
| Update defaults (`applyUpdateDefaults`) | Applied to the values before the `Update` node is built, and not when nothing is set. |

## Slice-specific done conditions

- [ ] Every test under `test/integration/test/sql-orm-client/` and the port corpus passes on Postgres and SQLite with no edit to any test file there.
- [ ] No statement is executed by the six methods except through the runner.
- [ ] Each graph the six methods build has a unit test that asserts its printed form.

## Differences from main found during the build

None changes a result an integration test asserts. Each follows from a decided rule or from building the graph before the first statement.

| Difference | Cause |
| --- | --- |
| The matching read of `update()` / `delete()`, the read of `deleteAll()` with includes, and the reload read of a write with includes carry the caller's annotations | Annotations go on every statement of a call |
| `updateAndCount({})` runs the `configure` callback before resolving `0` | The graph is built after annotations are collected, as `updateAll({})` already did |
| `update()` maps fields and applies update defaults before the matching read, so a default generator runs even when no row matches | The graph is built before the first statement |
| `update()` / `delete()` after `limit(0)` open no transaction; `update({})` runs its matching read outside a transaction and selects all columns | A graph with no node or one node needs no transaction; a `Find` nobody reads from has no derived columns |

Left for slice `graph-nested`: the runner refuses a node that reads from the result node, because the result's rows are mapped to field names by the existing dispatch code. Nested writes need the parent's write to be both the result and a source.

Gate not run locally: the whole `pnpm test:integration` suite is refused by a hook in this environment. The directories that reach the ORM's write methods were run instead (`test/sql-orm-client`, `test/ports`, `test/temporal-defaults`, `test/value-objects`, `test/cross-package`, the namespaced-accessors test): 451 files, 2,518 passed, 88 expected failures, none failed.

## Open questions

None.

## References

- Project spec: [`../../spec.md`](../../spec.md); design record: [`../../mutation-graph.md`](../../mutation-graph.md).
- Code on main: `packages/3-extensions/sql-orm-client/src/collection.ts` (`update` to `deleteAndCount`), `src/collection-mutation-dispatch.ts`, `src/query-plan-mutations.ts`, `src/mutation-executor.ts` (`withMutationScope`).

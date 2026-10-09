# Slice: graph-core

Parent project `projects/nested-mutations/`. First slice of stage 1. It delivers the mutation graph and moves the six update and delete methods of the collection onto it, with no change in what a caller gets back.

## At a glance

After this slice, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount`, called without relation callbacks, each build a mutation graph and hand it to one runner. `update()` with relation callbacks, and every create and upsert method, keep main's code.

The graphs are the smallest ones the design has:

```
updateAll(data)                 deleteAll() with includes        update(data)
  n1 Update user set … where …    n1 Find   user where …           n1 Find   user where … (first row)
  result: n1 rows                 n2 Delete user where … <- After n1   n2 Update user set … <- IntoWhere n1 (id->id)
                                  result: n1 rows                  result: n2 first row
```

## Chosen design

The design is in [`../../mutation-graph.md`](../../mutation-graph.md) and the rules in the project spec § How it is built. This slice builds the parts of it that its six methods use, and nothing else.

### What is built

| Part | In this slice | Later |
| --- | --- | --- |
| Node classes | `Find`, `Update`, `Delete` | `Insert`, `Merge` (slice 2); `Assert`, `State` (slice 3) |
| Edge classes | `After`, `IntoWhere` | `IntoValues` (slice 2) |
| Graph | `add(node, ...inputs)`, `replace(old, next)`, `inputsOf(node)`, `usersOf(node)`, the result | |
| Peephole | the `peephole(graph)` hook called by `add`; one rule: an `Update` that sets nothing is removed | the inlining rule (slice 4) |
| Printed form | one function that prints a graph as text, in the form shown above | |
| Runner | one function that executes a graph | |

### Rules the code follows

- **Location.** A directory `src/mutation-graph/` in `packages/3-extensions/sql-orm-client`. One file per concern (nodes, edges, graph, printed form, runner); no file re-exports another.
- **Nodes hold static content only.** A node names its table and holds its `where` as a list of SQL AST expressions, and for `Update` the values to set. It holds nothing that comes from another node and nothing about what it returns. Nodes are frozen; `peephole` returns the node itself or a replacement.
- **Edges are objects held by the graph**, each with `from`, `to`, and for `IntoWhere` a list of `[sourceColumn, targetColumn]` pairs.
- **The graph names its result**: a node, a form (rows, first row, or count), and the caller's selection and includes.
- **The runner** takes a graph, the runtime, the execution context and the caller's annotations, and:
  - executes nodes one at a time in dependency order;
  - skips a node whose `IntoWhere` source produced no row, and treats it as empty;
  - derives the columns a node returns from the edges that read from it, plus the caller's selection when it is the result;
  - collects a node another node reads from; hands the result node to the existing dispatch functions (`dispatchMutationRows`, `dispatchCollectionRows`), so a bulk method still streams and includes are loaded by the existing read code;
  - puts the caller's annotations on every statement;
  - opens a transaction through the existing mutation scope when the graph will execute more than one statement, and executes a single statement directly.
- **The collection methods only build a graph and call the runner.** Argument checks that exist today (`assertLockCompatible`, `assertBulkWriteIgnoresNothing`, `assertReturningCapability`, `assertModelFieldNames`, unknown-field refusal, update defaults) keep running at the same point relative to the first statement.
- **No relation knowledge anywhere in this slice.** There is no translation table yet; it arrives with the first relation operation in slice 3.

### The `Find` of the single-row methods

`update()` and `delete()` choose their row the way `first()` does: the collection's order, offset, cursor, `distinct` and `distinctOn` decide which row it is, and `limit(0)` means no row. So the `Find` node carries that read state as well as `where`, and the runner compiles it with the existing select compiler. The row it returns is identified by the table's identity columns (primary key or a unique constraint); a table with neither is refused with `ORM.ROW_IDENTITY_MISSING`, as today, while the graph is built.

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
- `Insert`, `IntoValues`, `Merge`, `Assert`, `State`, any translation of relation operations.
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

## Open questions

None.

## References

- Project spec: [`../../spec.md`](../../spec.md); design record: [`../../mutation-graph.md`](../../mutation-graph.md).
- Code on main: `packages/3-extensions/sql-orm-client/src/collection.ts` (`update` to `deleteAndCount`), `src/collection-mutation-dispatch.ts`, `src/query-plan-mutations.ts`, `src/mutation-executor.ts` (`withMutationScope`).

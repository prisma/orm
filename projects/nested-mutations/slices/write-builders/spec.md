# Slice: write-builders

Parent project `projects/nested-mutations/`. First slice of stage 2, stacked on `graph-nested` (branch `mutation-graph-write-builders` on top of `mutation-graph-nested`, #30734). After it, every write of the collection is built from one builder per kind of statement for a model, called the same way at top level and when nested, and no builder branches on the contract's `returning` capability.

## At a glance

`createAll()` of two posts, as every builder writes it, whatever the database:

```
n1 Insert   posts 2 rows
n2 FindByKeys posts by (id) <- Rows n1
result: n2
```

On a database with `RETURNING`, a rule collapses the read-back into the write as `n2` is added, so the graph that runs is:

```
n1 Insert posts 2 rows returning (id, title)
result: n1
```

On a database without it, the graph stays as the builder wrote it: `n1` runs without `RETURNING` and gives the keys of the rows it wrote from its own values, and `n2` reads the rows by them.

## Chosen design

The design is in [`../../mutation-graph.md`](../../mutation-graph.md) and the slice entry of [`../../plan.md`](../../plan.md). This slice adds:

| Part | Added |
| --- | --- |
| Builders | One per kind of statement for a model: insert rows, update rows, delete rows, find rows. A nested call is the top-level call plus edges from the parent (`PayloadData` for values, `FilterData` to limit to the parent's rows). Every write builder adds a read-back of the rows it writes: an insert is followed by a `FindByKeys` of the inserted rows by their identity; an update is preceded by a `Find` of the rows it will change and followed by a `Find` of them by key, with the new values of any key column it sets; a delete is preceded by a `Find` of the rows it deletes. Builders take no `returns` argument and do not read the `returning` capability. |
| `create()` | One path: always the relation translation, which with no relation operations is one insert and its read-back. `createGraph` and the branch on relation operations in `create()` go. |
| Adding a node with its inputs | `graph.add(node, inputs)` adds a node together with the edges it reads, and returns the id of the node that stands for it once the rules have run, which is the write's id when a rule collapsed the node into the write. The `addFilterDataEdge`/`addPayloadDataEdge`/`addRowsEdge`/`addRequiresEdge` methods stay for edges added to a node that already exists. |
| Peephole rules | Run by the graph as each node is added (decided 2026-11-10). One rule per pattern: a read-back `Find`/`FindByKeys` whose only input is a write it reads back, without includes, on a contract with `returning`, is not added; the write gets its columns in `RETURNING` and the add returns the write's id. A read-back with includes is added as it is, since includes are not part of `RETURNING`. |
| Moving readers | A graph operation that points every edge from one node at another, for a rule that replaces a node other nodes already read. |
| Removing unread `Find` nodes | Design record D7a: after the graph is built and before it runs, a `Find` or `FindByKeys` that is not the result and that no node reads is removed, and the step repeats until none is left. A count call's read-back is never read, so it is removed with the `Find` before it that only it read. |
| `Insert` without `RETURNING` | `Insert` and `InsertChunked` run without `RETURNING` on a database that lacks it, and give the columns other nodes read from them from their own values: the key values in their rows, those the `PayloadData` edges give, and, for a one-row insert, the value the database generated for an auto-increment key, decoded from the `insertId` the driver reports (decided 2026-11-10). A node nobody reads from returns the affected count. `InsertReportingKeys` is removed. |
| Checking a node before anything runs | Before it runs the first node, the runner asks every node whether it can run; an `Insert` without `RETURNING` that is read from refuses when its rows cannot give the columns read from it, with `writtenKeys`' errors. The check runs after unread `Find` nodes are removed, so a count call's insert is never refused. `Run` carries the execution context, which an `Insert` needs for the capability, the auto-increment columns and the key's codec. |
| Read-back without an order | The read-back has no `ORDER BY`: no order is promised for the rows a write returns (decided 2026-11-09). `FindByKeys` keeps its 500-key chunks and its check that it found a row for every key. |
| One identity check | `requireIdentityColumns` and `readBackIdentity` become one check with one error. |

Rules for the translation, unchanged from `graph-nested` except where a part above says otherwise:

- Nested child `connect`/`disconnect` and junction `disconnect` use the update and delete builders.
- The parent's write in `update()` reads back the updated row whenever a later node or the result reads it; on a database with `RETURNING` the rule collapses that read-back into the `Update`, as on `graph-nested`.

## Coherence rationale

Every later stage 2 slice adds rows to the translation that build inserts, updates, deletes and finds of a related model. Without this slice each of them would add a fifth way of creating rows and a further pair of `RETURNING`/no-`RETURNING` branches. The read-back redesign is part of the same change because the remaining duplications are the read-back branches themselves: `readsBack`, `addReadBack`, `addFindOfWrittenRows`, the `InsertReportingKeys`/`FindByKeys` pairs written in three builders, and `Translation.readsBack`.

## Scope

**In:** the parts above; unit tests for the add-with-inputs operation, each rule, moving readers, the removal step, the node check and `Insert` without `RETURNING`; printed graphs of every write method on a contract with and without `returning`.

**Out:** new behaviour for callers beyond the decided changes listed here; any rule other than the read-back collapse; arrays of operations and `updateAll`/`deleteAll` in relation callbacks (slice `filtered-many-writes`).

## Pre-investigated edge cases

| Case | Behaviour that must hold |
| --- | --- |
| `createAll()` without `RETURNING`, rows in a different order than their keys | The rows come back, in any order. `without-returning-sqlite.test.ts` "createAll() returns the rows in the order it was given them, not in key order" and "reads back more rows than one statement takes, in the order it was given them" assert order on main; they change to assert the set of rows (decided 2026-11-09). |
| `createAndCount()`, `updateAndCount()`, `deleteAndCount()` | Return the count as on main; their read-backs are removed before the graph runs. |
| `createAndCount()` of several rows with a generated key, without `RETURNING` | Allowed, as on main (its error text tells callers to use it): its read-back is removed, so nothing reads from the insert and the check does not refuse it. |
| `update()` whose parent write reads back into child operations, without `RETURNING` | Children read the keys from the read-back, as on `graph-nested`. |
| `upsert()` without `RETURNING` | Reads its row back by the create's values for the conflict columns, with main's refusals. |

## Slice-specific done conditions

- [ ] No builder takes a `returns` argument or reads the `returning` capability; `readsBack` and `Translation.readsBack` do not exist.
- [ ] Every integration test passes on Postgres, SQLite and MySQL, unedited except for the two order assertions above.
- [ ] Tests assert effects and printed graphs, never generated SQL.

## Open questions

None.

## References

- [`../../mutation-graph.md`](../../mutation-graph.md) — design records, including D7a.
- [`../../plan.md`](../../plan.md) — slice entry and the duplications it lists.
- Code: `packages/3-extensions/sql-orm-client/src/mutation-graph/collection-graphs.ts`, `nested-mutations.ts`, `model-statements.ts`, `graph.ts`, `insert-reporting-keys.ts`, `find-by-keys.ts`; `src/written-keys.ts`.

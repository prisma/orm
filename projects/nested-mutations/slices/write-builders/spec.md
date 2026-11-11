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
| Builders | One per kind of statement for a model: insert rows, update rows, delete rows, find rows. A nested call is the top-level call plus edges from the parent (`PayloadData` for values, `FilterData` to limit to the parent's rows). Every write builder adds a read-back of the rows it writes: an insert is followed by a `FindByKeys` of the inserted rows by their identity; an update keeps the caller's condition and is also filtered by a `Find` of the rows it will change, by key (decided 2026-11-11, so a row another writer moved out of the condition between the two statements is not updated, as on main), and is followed by a `Find` that reads the keys of the updated rows from the `Update` (decided 2026-11-10); a delete is preceded by a `Find` of the rows it deletes, which is what the result and later nodes read (decided 2026-11-10); in `delete()` the `Delete` is filtered by the `Find` by key, and in `deleteAll()` it keeps the caller's condition with no edge from the `Find`, as on main (decided 2026-11-11). On a table with no primary key or unique constraint, `updateAll()` returning rows is the `Update` with the caller's condition alone, read from directly, with no `Find` and no read-back: with `returning` it returns its rows itself, and without it the `Update` cannot give rows from its inputs, so its check refuses with main's `ORM.ROW_IDENTITY_MISSING` error (decided 2026-11-11). Builders do not read the `returning` capability. A builder takes `returns: 'rows' | 'count'`, what the caller asked for: a count call (`createAndCount()`, `updateAndCount()`, `deleteAndCount()`) builds only the write, with no read-back and no `Find` it does not need; nested builders pass `'rows'` where a later node reads the write and `'count'` where none does (decided 2026-11-11, replacing the 2026-11-09 decision that builders lose `returns`). |
| `create()` | One path: always the relation translation, which with no relation operations is one insert and its read-back. `createGraph` and the branch on relation operations in `create()` go. |
| Adding a node with its inputs | `graph.add(node, inputs)` adds a node together with the edges it reads, and returns the id of the node that stands for it once the rules have run, which is the write's id when a rule collapsed the node into the write. The `addFilterDataEdge`/`addPayloadDataEdge`/`addRowsEdge`/`addRequiresEdge` methods stay for edges added to a node that already exists. |
| Peephole rules | Run by the graph as each node is added (decided 2026-11-10). A rule sees the node with all its inputs, including its state edges in the `state` slot. State edges are inputs like any other edge: the caller of `add` passes them in `inputs.state`, from the current `State` of each table the node reads, which the graph gives; the graph does not add state inputs by itself (decided 2026-11-10). The graph still adds the `State` nodes a write produces. Two rules, both only on a contract with `returning`. **Read-back:** a read-back `Find`/`FindByKeys` whose only data input is a write it reads back by key, without includes, whose state edge for the table comes from the `State` that write produced, on a contract with `returning`, is not added; the write gets its columns in `RETURNING` and the add returns the write's id. Order between nodes is read from state edges only. A read-back with includes is added as it is, since includes are not part of `RETURNING`. **Fold:** an `Update` added with a `FilterData` edge of key columns from a `Find` of the same table that has only a condition (no limit, offset, order, joins or includes), whose state edge for the table comes from the same `State` as the `Update`'s, whose own condition is the `Find`'s condition (the same AST object, which the builder passes to both), and with no other `FilterData` input, drops the edge (decided 2026-11-11); nothing then reads the `Find`, and the removal step drops it (decided 2026-11-10). **Delete:** a `Delete` added either with a `FilterData` edge of key columns from a `Find`, or with the same condition (the same AST object) as a `Find` added before it, of the same table that reads one table without includes, that no node reads yet, and whose state edge for the table comes from the same `State` as the `Delete`'s, gets the `Find`'s columns in `RETURNING`; it keeps its edge from the `Find` when it has one (`LIMIT 1` in `delete()`). The graph then forwards the `Find`'s id to the `Delete` (decided 2026-11-10, design B with id forwarding): a reader added later from the `Find`'s id, and a result set to it, read from the `Delete`, except the `Delete`'s own edge from the `Find`. When the `Delete` has no edge from the `Find` (`deleteAll()`), nothing reads the `Find` and the removal step drops it. Without `returning` no rule runs. |
| Forwarding ids | A table in the graph that maps a node's id to the node that stands for it after a rule replaced it. Every id the graph is given (edge sources in `add` and the `add*Edge` methods, the result, `readersOf`, `inputsOf`) is resolved through it. |
| Moving readers | A graph operation that points every edge from one node at another, for a rule that replaces a node other nodes already read. |
| Removing unread `Find` nodes | Design record D7a: after the graph is built and before it runs, a `Find` or `FindByKeys` that is not the result and that no node reads is removed, and the step repeats until none is left. It removes reads a builder added that nothing ended up reading. |
| `Insert` without `RETURNING` | `Insert` and `InsertChunked` run without `RETURNING` on a database that lacks it, and give the columns other nodes read from them from their own values: the key values in their rows, those the `PayloadData` edges give, and, for a one-row insert, the value the database generated for an auto-increment key, decoded from the `insertId` the driver reports (decided 2026-11-10). A node nobody reads from returns the affected count. `InsertReportingKeys` is removed. |
| `Update` without `RETURNING` | An `Update` on a database without `RETURNING` gives the columns other nodes read from it from its inputs: the key values of the rows its `FilterData` edges gave it, with the new value of any key column it sets. `FilterData`'s `changed` values go, since the read-back reads the new keys from the `Update`. An `Update` that is read from and sets a key column by an expression refuses in its check (decided 2026-11-10). |
| Checking a node before anything runs | Before it runs the first node, the runner asks every node whether it can run; an `Insert` without `RETURNING` that is read from refuses when its rows cannot give the columns read from it, with `writtenKeys`' errors. The check runs after unread `Find` nodes are removed, so a count call's insert is never refused. `Run` carries the execution context, which an `Insert` needs for the capability, the auto-increment columns and the key's codec. |
| Read-back without an order | The read-back has no `ORDER BY`: no order is promised for the rows a write returns (decided 2026-11-09). `FindByKeys` keeps its 500-key chunks and its check that it found a row for every key. |
| One identity check | `requireIdentityColumns` and `readBackIdentity` become one check with one error. |

Rules for the translation, unchanged from `graph-nested` except where a part above says otherwise:

- Nested child `connect`/`disconnect` and junction `disconnect` use the update and delete builders.
- The parent's write in `update()` reads back the updated row from the `Update` whenever a later node or the result reads it; on a database with `RETURNING` the read-back rule collapses it into the `Update`, as on `graph-nested`. In `update()` the `Find` has `LIMIT 1`, so the fold rule leaves it.

## Coherence rationale

Every later stage 2 slice adds rows to the translation that build inserts, updates, deletes and finds of a related model. Without this slice each of them would add a fifth way of creating rows and a further pair of `RETURNING`/no-`RETURNING` branches. The read-back redesign is part of the same change because the remaining duplications are the read-back branches themselves: `readsBack`, `addReadBack`, `addFindOfWrittenRows`, the `InsertReportingKeys`/`FindByKeys` pairs written in three builders, and `Translation.readsBack`.

## Scope

**In:** the parts above; unit tests for the add-with-inputs operation, each rule, moving readers, the removal step, the node check and `Insert` without `RETURNING`; printed graphs of every write method on a contract with and without `returning`.

**Out:** new behaviour for callers beyond the decided changes listed here; rules other than the read-back and fold rules; arrays of operations and `updateAll`/`deleteAll` in relation callbacks (slice `filtered-many-writes`).

## Pre-investigated edge cases

| Case | Behaviour that must hold |
| --- | --- |
| `createAll()` without `RETURNING`, rows in a different order than their keys | The rows come back, in any order. `without-returning-sqlite.test.ts` "createAll() returns the rows in the order it was given them, not in key order" and "reads back more rows than one statement takes, in the order it was given them" assert order on main, as do three tests in `packages/3-targets/mysql/9-facade/test/runtime/orm-writes.live.test.ts` ("createAll returns the rows in the order it was given them, not in key order", "createAll returns rows keyed by a DATETIME(3) with milliseconds in the order it was given them", "createAll reads back more rows than one statement takes, in the order it was given them"); they change to assert the rows regardless of order (decided 2026-11-09). |
| `createAndCount()`, `updateAndCount()`, `deleteAndCount()` | Return the count as on main, from a graph of the write alone. |
| `createAndCount()` of several rows with a generated key, without `RETURNING` | Allowed, as on main (its error text tells callers to use it): its graph has no read-back, so nothing reads from the insert and the check does not refuse it. |
| `update()` whose parent write reads back into child operations, without `RETURNING` | Children read the keys from the read-back, as on `graph-nested`. |
| `deleteAll()` with `RETURNING`, no includes | One statement, `DELETE … RETURNING`, as on main. |
| `delete()` with `RETURNING`, no includes | `Find … LIMIT 1` and `DELETE … RETURNING`, as on main. |
| `updateAll()` on a table with no key | With `returning`, one `UPDATE … RETURNING`, as on main; without it, refused with `ORM.ROW_IDENTITY_MISSING` before any statement, as on main. |
| `delete()`/`deleteAll()` with includes, or of a variant in its own table | The `Find` reads the rows with their includes before the `Delete`; no rule applies. |
| `updateAll()` with `RETURNING` | One statement, as on main: the fold rule merges the `Find` into the `Update` and the read-back rule merges the read-back into it. |
| `update()` that sets a key column, without `RETURNING` | The read-back finds the row by its new key. |
| `createAll()` of several rows with a generated key, without `RETURNING` | Refused with the same `ORM.CAPABILITY_MISSING` error before any statement runs, now as a rejection of the result, as `create()` reports it, instead of a throw at the call (decided 2026-11-10). The integration test "refuses createAll() of several rows whose ids the database generates, before running, and counts them with createAndCount()" changes from `toThrow` to `rejects`. |
| A nested child-held create whose key a database default other than auto-increment fills, without `RETURNING` | Succeeds: nothing reads the child row, so the insert is a count write and its check does not ask for keys. On main the whole call was refused before running. The integration test "refuses a nested create before running when a child key column gets a database default other than auto-increment" changes to assert the rows written (decided 2026-11-11). A child create with nested creates of its own is still read from and still refused. |
| `upsert()` without `RETURNING` | Reads its row back by the create's values for the conflict columns, with main's refusals. |

## Slice-specific done conditions

- [ ] No builder reads the `returning` capability; `readsBack` and `Translation.readsBack` do not exist.
- [ ] Every integration test passes on Postgres, SQLite and MySQL, unedited except for the five order assertions, the `createAll()` refusal (SQLite and its MySQL counterpart) and the nested child create above.
- [ ] Tests assert effects and printed graphs, never generated SQL.

## Open questions

None.

## References

- [`../../mutation-graph.md`](../../mutation-graph.md) — design records, including D7a.
- [`../../plan.md`](../../plan.md) — slice entry and the duplications it lists.
- Code: `packages/3-extensions/sql-orm-client/src/mutation-graph/collection-graphs.ts`, `nested-mutations.ts`, `model-statements.ts`, `graph.ts`, `insert-reporting-keys.ts`, `find-by-keys.ts`; `src/written-keys.ts`.

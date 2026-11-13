## Dispatch plan

Slice spec: `projects/nested-mutations/slices/write-builders/spec.md`. Five dispatches, sequential. Tests first in each. Tests assert effects and printed graphs, never SQL.

### Dispatch 1: graph operations for rules

- **Outcome:** `graph.add(node, inputs)` adds a node with the edges it reads and returns the id that stands for it; the graph runs peephole rules as each node is added, with the read-back collapse rule for a contract with `returning`; a graph operation moves every reader of one node to another; a step removes unread `Find`/`FindByKeys` nodes until none is left; the runner asks every node to check it can run before running the first, after that removal; `Run` carries the execution context. Unit tests for each. No builder changes yet; existing graphs print and run as before.
- **Builds on:** Slice `graph-nested`.
- **Hands to:** The graph pieces dispatches 2 and 3 use.
- **Focus:** The rule sees a node with its inputs, so a read-back added with its edge from the write can be collapsed before anyone holds its id.

### Dispatch 2: `Insert` without `RETURNING`

- **Outcome:** `Insert` and `InsertChunked` on a contract without `returning` run without `RETURNING` and give the columns read from them from their own values, the payload edges and a one-row insert's decoded `insertId`; their check refuses with `writtenKeys`' errors when they cannot; `InsertReportingKeys` is removed; `FindByKeys` has no `ORDER BY`. The builders that used `InsertReportingKeys` use `Insert` and `FindByKeys`. MySQL and SQLite-without-returning tests pass, with the two order assertions changed.
- **Builds on:** Dispatch 1.
- **Hands to:** One insert node for every database.
- **Focus:** A count call's insert is not refused; `upsert()` reads back by the create's conflict values.

### Dispatch 3: `Update` without `RETURNING` and the fold rule

- **Outcome:** An `Update` without `RETURNING` gives the keys of the rows its `FilterData` edges gave it, with the new values of the key columns it sets, and refuses in its check when it is read from and sets a key by an expression; `FilterData`'s `changed` values go. The fold rule, with `returning`, merges a condition-only `Find` that filters an `Update` by key in the same state into the `Update`'s `WHERE`. `updateFirstGraph` and `updateAllGraph` build `Find` → `Update` → read-back from the `Update` on every database. Unit tests for the fold rule and `Update` without `RETURNING`; printed graphs of `update()` and `updateAll()` with and without `returning`.
- **Builds on:** Dispatches 1 and 2.
- **Hands to:** Update builders without branches on `returning`.
- **Focus:** `updateAll()` stays one statement with `RETURNING`; nested `update()` child operations read from the node `add` returned for the update.

### Dispatch 4: delete and the rest of the builders

- **Outcome:** The delete rule and id forwarding as the spec states them; `deleteFirstGraph` and `deleteAllGraph` build `Find` → `Delete` on every database, reading the result from the `Find`'s id; every write builder adds its read-back; no builder takes `returns` or reads `returning`; `readsBack`, `Translation.readsBack`, `addReadBack`, `addFindOfWrittenRows`, `addWithIncludes` collapse into the builders; `create()` has one path; nested child `connect`/`disconnect` and junction `disconnect` use the update and delete builders; one identity check.
- **Builds on:** Dispatch 3.
- **Hands to:** The builders later slices use.
- **Focus:** Results unchanged for callers; count calls return the count.

### Dispatch 5: clean-up and the slice gates

- **Outcome:** Dead helpers removed, docs that describe the read-back updated, every gate passes: package tests and typecheck, lint, `lint:deps`, ratchets, integration on Postgres, SQLite and MySQL, `test:packages`.
- **Builds on:** Dispatch 4.
- **Hands to:** The slice ready for its PR.

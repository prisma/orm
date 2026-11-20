# Slice: read-back-reuse

Parent project `projects/nested-mutations/`. Outcome this slice contributes: whether an `update()` that sets none of the record's own fields reads the record again after its nested writes is decided by a rule on the statement graph, from the state edges of the table, and no longer by a flag each nested operation has to set.

## At a glance

`updateFirstGraph` has a branch for an `update()` whose data sets none of the record's own fields and writes none of its foreign keys (`collection-graphs.ts`, the `values` empty and `before.keys` empty case). Today that branch returns the first `Find`, which runs before the nested writes, unless the collection has includes or `BeforeWrite.unlinksAfterWrite` is set. After this slice the branch always adds a read-back, and a new rule replaces the read-back with the first `Find` when no statement of the call writes the record's table between the two. `BeforeWrite.unlinksAfterWrite` is removed.

Results change in the five cases listed under "Results that change", where today's result is not what the database holds; every other result is unchanged.

## Chosen design

### The builder

In `updateFirstGraph`, the branch that sends no `UPDATE` of the record becomes:

```ts
addAfterWrite(b, model, { ...parent, node: find }, relationMutations);
b.graph.setResult(
  readBack(b, model, find, identityColumnsOf(collection), { shape: shapeOf(collection), by: 'filter', owner }),
);
```

The condition on `state.includes` and `before.unlinksAfterWrite` is removed. `BeforeWrite` loses `unlinksAfterWrite`: the field, the two assignments in `addBeforeWrite` (`nested-mutations.ts`), and its entry in `nothingBefore` (`storage-rows.ts`). The `bare` branch (no data and no relation callbacks) and the branch that sends an `UPDATE` are not changed.

### The rule

A new rule, working name `reuseRule` in `src/statement-graph/reuse-rule.ts`, with a doc comment in the form the three existing rules have. When a node is added, the node is not added and `add` returns the id of an earlier `Find` when all of these hold:

1. **The node is a read-back.** It is a `Find` with no condition of its own that reads one table: no joins, includes, order, limit, offset, distinct, grouping or locking. This is what `readBackRule` requires (`conditionOnlyReadOf` with `where === undefined`).
2. **It reads by key.** Its only data input is one `FilterData` edge whose columns cover the primary key or a unique constraint of the table, each column read into the same column (`readsByKey`).
3. **Its source is a `Find` of rows of the same table.** The source reads that table alone, projects columns only, and has no `DISTINCT`, `DISTINCT ON`, `GROUP BY` or `HAVING`, so each of its rows is one row of the table. A condition, an order, a limit, an offset, locking and inputs of its own are allowed: the first `Find` of `update()` has `LIMIT 1` unless the filter pins a unique key.
4. **Both read the same state of the table.** The node's state edge for the table comes from the same `State` as the source's (`readsTableAsFound`). A write to the table, or a write to another table that changes it through a foreign-key action the contract declares (`changedBy`), produces a new `State`, so the rule does not apply after either.

The rule then replaces the source with `source.withReturning(node.returns)`, so the first `Find` selects the columns of the read-back, and returns the source's id. This is the mechanism `readBackRule` uses on a write.

`FindByKeys` is not covered: no builder reads one back from a `Find`.

### The rule runs on every contract

`rulesFor` returns the fold, delete and read-back rules only with capability `returning`, because each moves a read into a write's `RETURNING`. The new rule replaces a `SELECT` with an earlier `SELECT`, so `rulesFor` returns it on every contract. Without it, a contract without `returning` would send a second `SELECT` for every relation-only `update()`, where today it sends one.

### Graphs

```text
db.User.where({ id: 1 }).update({ posts: (p) => p.create([{ … }]) })        every contract

built by updateFirstGraph                         after the rule
n1 Find users where id = 1                        n1 Find users where id = 1
n2 Insert posts <- PayloadData n1 (id->user_id)   n2 Insert posts <- PayloadData n1 (id->user_id)
n3 Find users <- FilterData n1 (id->id)           result: n1
result: n3

db.User.where({ id: 1 }).update({ invitedBy: (u) => u.disconnect([{ id: 2 }]) })

n1 Find users where id = 1
n2 Update users set invited_by_id = null where invited_by_id in (select …) <- FilterData n1 (id->id)
n3 Find users <- FilterData n1 (id->id)           kept: n2 produced a new State of users
result: n3
```

### Statements per call

For an `update()` that sets none of the record's own fields:

| Case | Today | After |
| --- | --- | --- |
| No statement writes the record's table, no includes | `Find`, nested writes | same |
| Includes loaded per relation | `Find`, nested writes, read-back, include reads | `Find`, nested writes, include reads |
| Includes joined into one statement | `Find`, nested writes, read-back with includes | same; the read-back is not a one-table read |
| N:1 `delete`, N:1 `disconnect` with criteria or a variant | `Find`, nested writes, read-back | same |
| A nested write to the record's own table | `Find`, nested writes | `Find`, nested writes, read-back |
| A nested write whose declared foreign-key action changes the record's table | `Find`, nested writes | `Find`, nested writes, read-back |
| Base model with a variant in its own table | `Find`, nested writes | `Find`, nested writes, read-back with the variant joins |

The graph does not know which row a nested write changes, so every nested write to the record's table keeps the read-back, also when the row it writes is another one. On a model related to itself this is one more `SELECT` than today for `create`, `connect`, `disconnect`, `update`, `updateAll`, `delete` and `deleteAll` on the child-held side.

### Results that change

Each was run against today's code on Postgres (PGlite) on 2026-11-20. In the first four the call returns the record as it was before the nested write; after this slice it returns the record as the database holds it.

| Case | Call | Today | After |
| --- | --- | --- | --- |
| Record connected to itself | `Person.where({ id: 1 }).select('id', 'managerId').update({ reports: (r) => r.connect({ id: 1 }) })` | `managerId: null` | `managerId: 1` |
| Record updated through its own relation | `reports: (r) => r.where({ id: 1 }).update({ name: 'Renamed' })`, person 1 being its own manager | `name: 'Ada'` | `name: 'Renamed'` |
| Record disconnected from itself | `reports: (r) => r.disconnect([{ id: 1 }])`, person 1 being its own manager | `managerId: 1` | `managerId: null` |
| A foreign-key action changes the record | `reports: (r) => r.where({ id: 2 }).delete()`, person 1 managed by person 2, `ON DELETE SET NULL` | `managerId: 2` | `managerId: null` |
| Base model with a variant in its own table | `Task.where({ id: 1 }).update({ comments: (c) => c.create({ … }) })` on a `Feature` row | no `priority`, no `assigneeId` | both fields, as `update({ title })` and `first()` return them |

The fifth is a different defect: the first `Find` joins the variant tables but selects only columns of the base table. Its `Find` is not a one-table read, so the rule does not apply and the read-back with the variant joins stays, which is what `update({ title })` on that model already ends with.

## Coherence rationale

One rule, the one builder branch that depends on it, and the removal of the flag the rule replaces. The rule cannot merge without the builder change (nothing would build its pattern) and the builder change cannot merge without the rule (every relation-only `update()` would send a second `SELECT`). One reviewer reads the rule, the three small edits and the graph diffs together.

## Scope

**In:**

- `reuseRule` and its unit tests, on a contract with and without `returning`: applies; does not apply after a write to the table, after a write whose declared foreign-key action changes the table (`test/statement-graph/cascade-contract.ts`), for a source with joins, `DISTINCT` or grouping, for a read-back with a condition, an order or includes, and for an edge that does not cover a key.
- `rulesFor`; `updateFirstGraph`; removal of `BeforeWrite.unlinksAfterWrite`.
- Graph tests of `updateFirstGraph` for each row of "Statements per call", and existing graph tests whose printed graph changes.
- Integration tests on Postgres and SQLite for the results that change: the five of the table above, and a sixth where a `DELETE` on another table changes the record's table through a declared foreign-key action, since the fourth case also writes the record's own table (added 2026-11-20).
- For results that stay, new integration tests only where no existing test asserts the result (amended 2026-11-20): a relation-only `update()` with a `select`, with and without `returning`, which also asserts the statements sent; and on SQLite, includes loaded one query per relation. An N:1 `delete` and includes are already asserted by `nested-mutations.test.ts` (both include strategies) and `nested-mutations-sqlite.test.ts`.
- The package README: the sentence at "A write that returns rows is built the same way on every database" gains what a relation-only `update()` sends, and the nested-writes section says that when a nested operation of the call writes the record's own table, as on a model related to itself, the record is read again after the nested operations.
- Design record `mutation-graph.md` D7: a fourth rule, and which rules need `returning`.
- The declaration `check:upgrade-coverage` requires for a change under `packages/3-extensions/**`. The changed results are corrections with no code to translate.

**Out:**

- The branch of `updateFirstGraph` that sends an `UPDATE`, and PR #31119, which changes it. #31119's `b.graph.writesAnyTable` check stays as that PR has it.
- Making the first `Find` of a polymorphic base model select the variant columns, which would save the read-back there.
- A read-back from a `Find` that reads several tables, by comparing the state of each.
- Changes a trigger makes, and foreign-key actions the contract does not declare: the graph does not see them (design record D4).
- The two cascade cases recorded in PR #31105, where one statement's own `RETURNING` reports a row its cascade then changes.
- `create()`, `upsert()`, `updateAll()`, `delete()`: none of them reads a row back from a `Find`.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| The first `Find` has `LIMIT 1` and an order (filter that does not pin a unique key), an offset or a cursor | Rule applies | The read-back reads by key the row that `Find` returned, so the `Find` with the read-back's columns returns the same row. |
| Includes loaded per relation | Rule applies | The include reads are added after the nested writes and read their keys from the first `Find`; they run after the nested writes, so they see them. |
| A variant collection, `.variant(v)`, of a variant in its own table | Read-back kept | The first `Find` joins the variant table. A variant stored in the base table is a one-table read and the rule applies. |
| A foreign-key action added outside the contract | Result stays stale across two tables | The probe's `SET NULL` case was caught only because the `DELETE` was on the record's own table. |
| PR #31119 | Rebase only | It edits lines next to this branch in `updateFirstGraph` and one other test in `update-graph.test.ts`. No `it.fails` test of PR #31105 is on this slice's branch. |

## Slice-specific done conditions

- [ ] `grep -rn unlinksAfterWrite packages/3-extensions/sql-orm-client/src packages/3-extensions/sql-orm-client/test` returns nothing.
- [ ] An integration test on each target, with and without `returning`, shows a relation-only `update()` that writes no row of the record's table sends one `SELECT` of that table.

## Open Questions

None.

## References

- Parent project: `projects/nested-mutations/spec.md`; plan entry: `projects/nested-mutations/plan.md` slice 12
- Design record: `projects/nested-mutations/mutation-graph.md` D4, D7, D7a, D18
- Code: `packages/3-extensions/sql-orm-client/src/statement-graph/` (`collection-graphs.ts`, `rules.ts`, `read-back-rule.ts`, `rule-patterns.ts`, `nested-mutations.ts`, `storage-rows.ts`)
- PR [#31119](https://github.com/prisma/orm/pull/31119), stacked on PR [#31105](https://github.com/prisma/orm/pull/31105)
- Linear issue: none (project not tracked in Linear by owner decision)

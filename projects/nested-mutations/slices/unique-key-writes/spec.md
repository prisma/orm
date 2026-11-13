# Slice: unique-key-writes

Parent project `projects/nested-mutations/`. Outcome this slice contributes: `update()` and `delete()` on one row identified by a key send one statement on a contract with `returning`, and slice `single-row-writes` builds its nested `update` and `delete` on the same first-row builders.

## At a glance

Today `db.User.where({ id: 1 }).update({ name })` sends `SELECT id FROM users WHERE id = $1 ORDER BY … LIMIT 1` and then `UPDATE users … WHERE id = $2 RETURNING …`; `delete()` sends the same `SELECT … LIMIT 1` before its `DELETE`. When the combined condition of the collection pins one row by its primary key or a unique constraint, `updateFirstGraph` and `deleteFirstGraph` build the `Find` so that the existing fold and delete rules remove it, and the write is sent alone. Results are unchanged.

## Chosen design

**The condition check.** `pinsUniqueKey(contract, table, where)` in `src/mutation-graph/unique-condition.ts` (a draft exists, uncommitted, with unit tests). It splits `where` into conjuncts, flattening nested `AND`s, and collects the columns of the conjuncts that are an `eq` between a column of `table.alias` and a `ParamRef` or a `LiteralExpr` that is not `null`, in either order. It returns true when those columns cover one set from `resolveUniqueKeyColumnSets`. Conjuncts of any other form are ignored: `AND` with an equality on a key matches at most one row whatever else it holds, so `where({ id: 1 }).where((u) => u.name.like('A%'))` also sends one statement (decided 2026-11-13, replacing the plan entry's "only for an `AND` of `eq`"). A key that appears only inside `OR`, `NOT` or `IN`, an `IS NULL`, a comparison between two columns, and a column of another alias do not count.

**The builders.** In `src/mutation-graph/collection-graphs.ts`, `updateFirstGraph` and `deleteFirstGraph` compute `where = whereOf(collection)` and check it when the state has no `offset` and no `cursor` (the cursor condition is in the `Find`'s `WHERE` but not in `whereOf`, and an offset skips the one row). When the check holds:

- the `Find` is built from the same select with `limit` and `orderBy` removed and `.withWhere(where)`, so its condition is the same AST object as the write's, as `deleteAllGraph` does today;
- the `Update` or `Delete` gets `where` instead of `undefined`, and keeps its `FilterData` edge from the `Find`.

Nothing else changes. The rules then do what they do for `updateAll()` and `deleteAll()`:

```text
db.User.where({ id: 1 }).update({ name: 'Grace' })       (contract with returning)

before                                        after
n1 Find users where id = 1                    n1 Update users set name = 'Grace'
   order by id asc limit 1                       where id = 1
n2 Update users set name = 'Grace'            result: n1
   <- FilterData n1 (id->id)
result: n2

db.User.where({ id: 1 }).delete()

before                                        after
n1 Find users where id = 1                    n1 Delete users where id = 1
   order by id asc limit 1                    result: n1
n2 Delete users <- FilterData n1 (id->id)
result: n1
```

For `update()`, the fold rule drops the key edge and `removeUnreadFinds` removes the `Find`. For `delete()`, the fold rule drops the key edge, then the delete rule gives the `Delete` the `Find`'s columns and the `Delete` stands for the `Find` as the result; `delete()` already takes the first row of the result.

Cases where the `Find` stays, and runs without `LIMIT 1`:

- a nested before-write or after-write of `update()` reads the `Find` (it is still read, so it is not removed);
- `delete()` with includes: the `Find` returns include columns, so it is not a one-table read and neither rule applies;
- a contract without `returning`: no rule runs.

## Coherence rationale

One change to two builders and the function they share, with the design record sentence that described the old behaviour. One reviewer reads the check, the two builder edits and the graph diffs together.

## Scope

**In:** `pinsUniqueKey` and its unit tests; `updateFirstGraph` and `deleteFirstGraph`; graph tests for folded and unfolded cases (key, unique constraint, chained `where`, callback form, offset, cursor, includes, a part of a composite key, a nested write reading the `Find`); existing graph tests whose `Find … limit 1` changes; integration tests on both targets that `update()` and `delete()` by key send one statement and return the same rows as before, including a missing row (`null`); design record D10b's sentence "A `Delete` with a key edge is not rewritten: `delete()` keeps its `Find … LIMIT 1` as the result" amended.

**Out:** `whereUnique` records nothing new in the collection state. The nested `r.where(w).update/delete` (slice `single-row-writes`). `updateAll()`, `deleteAll()` and `upsert()`. New rules: the existing fold, delete and unread-`Find` removal are used as they are.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `cursor()` | Keep `Find … LIMIT 1` | `buildCursorWhere` adds the cursor condition to the select's `WHERE` only; `whereOf` does not hold it, so dropping the limit would change which row is written. |
| A variant stored in its own table | Check is false | `countMutationWhere` makes the condition `pk IN (subquery)` for it. A variant stored in the base table adds an equality on the discriminator, which is ignored. |

## Slice-specific done conditions

- [ ] An integration test on each target shows `where({ id }).update(…)` and `where({ id }).delete()` send one statement on a contract with `returning`.

## Open Questions

1. `orderBy` on the folded `Find`: working position: removed, since one row has no order, and the delete rule only applies to a `Find` without an order.

## References

- Parent project: `projects/nested-mutations/spec.md`; plan entry: `projects/nested-mutations/plan.md` slice 6
- Design record: `projects/nested-mutations/mutation-graph.md` D7a, D10b
- Linear issue: none (project not tracked in Linear by owner decision)

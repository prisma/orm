# Slice: graph-nested

Parent project `projects/nested-mutations/`. Last slice of stage 1, stacked on `graph-creates` (branch `mutation-graph-nested` on top of `mutation-graph-creates`). It moves `create()` and `update()` with relation callbacks onto the mutation graph and removes the nested-write executor. After it, every write method of the collection runs through the graph.

## At a glance

```ts
db.orm.Post.where({ id: 1 }).update({
  title: 'New',
  author: (a) => a.connect({ email: 'ada@x' }),
  comments: (c) => c.create({ body: 'hi' }),
  tags: (t) => t.connect({ name: 'sql' }),
})
```

```
n1 Find   post where id = 1 limit 1
n2 Find   user where email = 'ada@x'
n3 Assert <- Rows n2
n4 Update post set title = 'New' <- FilterData n1 (id->id), PayloadData n2 (id->author_id)
n5 Insert comment { body: 'hi' } <- PayloadData n4 (id->post_id)
n6 Find   tag where name = 'sql'
n7 Assert <- Rows n6
n8 Insert post_tag <- PayloadData n4 (id->post_id), PayloadData n6 (id->tag_id)
result: n4
```

(State nodes and edges left out of the printed form above; see below.)

## Chosen design

The design is in [`../../mutation-graph.md`](../../mutation-graph.md). This slice adds:

| Part | Added |
| --- | --- |
| `Assert` | a node with no statement and one `Rows` input; throws its named error when the input has no rows, otherwise returns nothing. |
| `State` | a node with no statement, one per version of a table, created by the graph (design record D4). |
| State edges | ordinary edges in an input slot of statement nodes, from the current `State` of each table the statement reads; and from a write to each new `State` it produces. Resolved by the runner like any edge; nodes ignore them. |
| `changedBy` | a function derived once from the contract: the tables a write to a table can change through `CASCADE`, `SET NULL`, `SET DEFAULT` foreign keys, transitively. |
| `sameState(a, b, table)` | on the graph; compares the `State` sources of two nodes' state edges. Nothing in this slice calls it. |
| AST table collector | in `relational-core`: every table source in a statement (from, joins, subqueries, include joins, a write's target). |
| Translation | one entry per operation and relation layout, for `create`, `connect`, `disconnect` in `create()` and `update()`, appended in main's phase order: relations the parent holds the key for, the parent's write, relations the child holds the key for, many-to-many relations. Nested creates inside nested creates recurse. |

Rules for the translation, reproducing main except where a decided change says otherwise:

- **Parent holds the key.** `create`: the related row is inserted first and its key copied into the parent's values by `PayloadData`. `connect`: a `Find` by the criterion, an `Assert` raising `ORM.RELATION_ROW_MISSING`, the key copied by `PayloadData`. `disconnect` (in `update()` only): the parent's key columns are set to null in its own values.
- **Child holds the key.** `create`: one `Insert` of the child rows with the parent's key from `PayloadData`. `connect`: an `Update` of the children matching the criterion, setting their key from the parent by `PayloadData`; no error when nothing matches, as on main. `disconnect`: an `Update` setting the children's key to null, limited to children of the parent by `FilterData`, and to the criterion when one is given.
- **Many-to-many.** `create`: the target row is inserted, then the junction row with both keys by `PayloadData`. `connect`: a `Find` and an `Assert` per criterion, then the junction insert. `disconnect`: a `Find` per criterion, then a `Delete` of the junction row. Junction `connect` uses a conflict clause where the junction has a key over exactly its link columns and a plain insert otherwise, with no duplicate check and no wrapped error; `ORM.RELATION_LINK_DUPLICATE` is removed.
- **The parent's write.** In `update()`, `Find` of the first matching row, then `Update` (or the `Find` itself when nothing is set, design record D7a). In `create()`, `Insert`.
- **Result.** The parent's write node, with the caller's selection. With includes, a `Find` with the includes reading the parent's key is added last, after every child operation.
- **Rejections while the graph is built.** Invalid nested input is rejected before any statement, including when the filter matches no row. A relation field that is not a callback is rejected with `ORM.RELATION_MUTATION_INVALID`. `disconnect` in `create()` stays rejected with `ORM.RELATION_MUTATION_UNSUPPORTED`.
- **Contract validation.** A relation whose link-column lists are empty is rejected by the contract validator (minimum length 1 on `on.localFields`, `on.targetFields` and the three `through` lists). The executor's guards for empty lists are not carried over.

Clean-up that this slice owns:

- `mutation-executor.ts` and the branch on relation callbacks in `create()` and `update()` are removed; `withMutationScope` moves where the runner can import it.
- Every `compile…` function in `query-plan-mutations.ts` that loses its last caller is removed, `aliasTarget` with them; the file keeps the AST-building functions and is renamed to say what it holds.
- The step that removes a `Find` nobody reads (design record D7a) is built if a graph in this slice can contain one; otherwise it stays for later and the slice says so.

## Scope

**In:** the above; unit tests for each new class, the collector, `changedBy` (including a transitive cascade), each translation entry by printed graph; integration tests on Postgres and SQLite for every operation and layout.

**Out:** arrays of operations, `updateAll`/`deleteAll` inside relation callbacks, the inlining peephole (slice `filtered-many-writes`); any rule that calls `sameState`.

## Pre-investigated edge cases

| Case | Behaviour that must hold |
| --- | --- |
| `update()` matching no row with valid nested input | Resolves `null`; no write runs (the parent's `Find` is empty, so its readers return no rows). |
| A nested create whose data has its own relation callbacks | The inner operations translate in the same phase order, recursively. |
| A variant collection as parent or child | As main; a variant stored in its own table as a nested create target uses the chain from slice `graph-creates`. Report what main does where it differs from that. |
| Annotations | On every statement of the call, including the nested ones (main discarded them for nested calls; design record D12). |
| Includes on a nested `create()`/`update()` | Loaded by the final `Find`, after all child operations. |

## Slice-specific done conditions

- [ ] Every integration test on main passes on Postgres and SQLite, unedited except for the decided behaviour changes listed above.
- [ ] No write method of the collection executes a statement outside a node; `mutation-executor.ts` does not exist.
- [ ] Tests assert effects (returned rows, table contents, errors) and printed graphs; never generated SQL.

## Open questions

None.

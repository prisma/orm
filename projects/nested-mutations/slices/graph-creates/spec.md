# Slice: graph-creates

Parent project `projects/nested-mutations/`. Second slice of stage 1, stacked on `graph-core` (branch `mutation-graph-creates` on top of `mutation-graph-core`). It moves the insert-side methods onto the mutation graph.

## At a glance

After this slice, `create`, `createAll`, `createAndCount` and `upsert`, called without relation callbacks, build a mutation graph and run it with `queryGraph` or `executeGraph`. `create()` with relation callbacks keeps calling the executor until slice `graph-nested`.

```
createAll, one statement           createAll, rows split by column set (no DEFAULT in a row)
n1 Insert user 3 rows              n1 InsertChunked user (2 statements)
result: n1                         result: n1

create, variant in its own table   createAll, two such variant rows
n1 Insert task                     n1 Insert task      n4 Insert task
n2 Insert feature <- PayloadData   n2 Insert feature   n5 Insert feature
       n1 (id->id)                 n3 CrossJoin            n6 CrossJoin
n3 CrossJoin <- Rows n1, Rows n2       n7 UnionAll <- Rows n3, Rows n6
result: n3                         result: n7

create / createAll with includes   upsert
n1 Insert user                     n1 Insert user … on conflict (email) do update
n2 Find user (with includes)       result: n1
       <- FilterData n1 (id->id)
result: n2
```

## Chosen design

The design is in [`../../mutation-graph.md`](../../mutation-graph.md). This slice adds what its four methods need and nothing else.

| Part | Added |
| --- | --- |
| `Insert` | a node holding one `InsertAst` (one or many rows); one statement. Input slot `payload: PayloadData[]`. |
| `InsertChunked` | a node holding several `InsertAst`s, run in order; no inputs. Returns their rows one statement after another, or the sum of their counts, as the ASTs' returning decides. `withReturning` applies to every AST. The builder uses it when the rows split into more than one column set. |
| `PayloadData` | an edge whose `output(sourceRow)` is a record of values for the target's row. In this slice its source always has one row; how a target combines several source rows is decided in slice `graph-nested`. |
| `Rows` | an edge whose `output(sourceRow)` is the source row restricted to the edge's columns; listing them makes the source return them. |
| `CrossJoin` | a node with no statement and two single-edge slots, `left` and `right`, that makes one row from one row of each, side by side. It knows nothing about tables, variants or keys. `UnionAll` keeps a list slot, since its number of inputs is the number of rows. |
| `UnionAll` | a node with no statement that returns all rows of its inputs, one input after another. |
| Builders | `createGraph(collection, rows, conflict)` and `upsertGraph(collection, create, update, conflictColumns)`. No result form: `createAll` and `createAndCount` call the same builder. |

Decisions specific to this slice, taken with the project owner:

- **Batching.** An `Insert` is one statement. When the rows cannot go into one statement (the target lacks `DEFAULT` inside a row and the rows set different columns), the builder makes one `InsertChunked`. Its statements are main's statements, in main's order, and a one-node graph runs without a transaction as on main.
- **Variant columns are labeled by the variant insert's statement, as reads label them.** The variant `Insert`'s returning clause projects each variant column under the label reads use (`variantColumnLabel`) and leaves out the key columns, so its rows arrive as a read of the same variant would return them. `CrossJoin` and the `Rows` edges rename nothing; shaping maps labels to fields with the function reads use. Decided 2026-10-14 over a `CrossJoin` that renames, and over renaming on the `Rows` edge.
- **Variants stored in their own table.** One chain per row: `Insert` into the base table, `Insert` into the variant table reading the base row's key through `PayloadData`, `CrossJoin` of the two. Several rows are joined by `UnionAll`. The graph runs in one transaction, so `createAll` of several such rows creates all or none; main used one transaction per row.
- **Write targets use the collection's table scope.** Every node of a call names its tables through the collection's scope, so a variant table aliased `tasks_2` for reads is the target `tasks_2` of its insert too, and the same aliased table gives both the column references and the variant column labels. The Postgres and SQLite adapters render the alias on the target of `INSERT`, `UPDATE` and `DELETE` (`INSERT INTO tasks AS tasks_2`). SQLite does not let `RETURNING` refer to the target's alias (its own test suite, `returning1.test` 7.7, pins this), so the SQLite adapter writes returned columns unqualified (`RETURNING "id"`), which is unambiguous because SQLite's `RETURNING` can only refer to the target; the adapter's documentation states this. Decided 2026-10-15 over building write targets unaliased, and over writing returned columns unqualified in the AST.
- **`upsert`** is one `Insert` with a conflict clause that updates. With nothing to update, the clause assigns a conflict column its own proposed value (`do update set email = excluded.email`), so the row is returned whether it was inserted or already existed. Main issued `do nothing` and a second read in that case.
- **Includes.** An insert's returning clause cannot join related rows, so with includes the graph ends in a `Find` holding the select with includes, reading the inserted rows' identity columns through `FilterData`, as for updates.

## Coherence rationale

The same shape as slice `graph-core`: new node and edge classes with unit tests, builders with printed-graph tests, and method bodies that become "build, run". Each of the four methods is wholly on the graph or wholly untouched.

## Scope

**In:** the classes and builders above; `create` (without relation callbacks), `createAll`, `createAndCount`, `upsert` in `collection.ts`; removal of the private helpers of `collection.ts` that nothing calls afterwards (`#executeMtiCreate` and others), and of `dispatchSplitMutationRows` / `executeMutationReturningSingleRow` if nothing calls them; unit tests; a pending upgrade entry with `changes: []`.

**Out:** `create()` with relation callbacks, `mutation-executor.ts`, the `compile…` functions the executor still calls (slice `graph-nested` removes them), how `PayloadData` with several source rows feeds a target.

## Pre-investigated edge cases

| Case | Behaviour that must hold |
| --- | --- |
| `createAll([])`, `createAndCount([])` | No statement; no rows, `0`. |
| `onConflict: 'skip'` on `createAll` / `createAndCount` | As on main, including its capability checks and its refusal on a variant stored in its own table. Skipped rows are absent from the result. |
| `create()` returning no row | `ORM.MUTATION_ROW_MISSING`, as on main. |
| A variant stored in the base table | One `Insert` with the discriminator value set, as main does today. |
| `createAndCount`, `upsert` on a variant stored in its own table | Refused, as on main. |
| `select` / `include` on a variant stored in its own table | Check what main returns (its variant path maps the combined row directly) and reproduce it; report if main ignores them. |
| Create defaults (generated ids, timestamps) | Applied before the AST is built, as on main, including the shared cache across the base and variant rows of one variant create. |
| `upsert` with update defaults | Applied only when the caller's update sets something, as on main. |
| Annotations | On every statement of the call. |

## Slice-specific done conditions

- [ ] Every test under `test/integration/test/sql-orm-client/` and the port corpus passes on Postgres and SQLite with no edit, except where a difference above is stated.
- [ ] No statement is executed by the four methods except through a node.
- [ ] Each graph the builders produce has a unit test asserting its printed form.

## Open questions

None.

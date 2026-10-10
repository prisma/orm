# Mutation graph — design record

Outcome of the design discussion of 2026-10-09. It replaces the executor-based approach the project started with, and it is the reason PR #30634 is not merged. The project spec and plan refer to this file for the design; this file holds the decisions, the reasons, what they assume, and what was rejected.

## The question, as sharpened

The project began by adding operations to the nested-write executor. That produced an executor nobody could read: each operation was written once per relation layout, statements were issued as a side effect of walking the input, and every defect of the week (a lookup that ran before a write it should have seen, a doubled lookup, validation that ran too late) came from the same place: nothing between "what the caller asked for" and "statements already executed" could be inspected.

The question became: what explicit structure sits between the two, for every write the ORM client performs?

## The design in one page

A write call is turned into a **mutation graph**. Nodes are database-level steps. Edges carry everything one node needs from another. A small runner executes the graph.

```ts
type NodeId = number

// An edge turns one row of its source into what its target consumes
abstract class Edge<T> { from: NodeId; to: NodeId; abstract output(sourceRow): T }
class FilterData  extends Edge<Expr>    { columns: [source, target][] }  // a condition for that row
class PayloadData extends Edge<Payload> { columns: [source, target][] }  // a record of values for that row
class After       { from: NodeId; to: NodeId }                            // order only, added with graph.after

// A node is a frozen class that holds its statement as SQL AST and executes it
abstract class Node<Inputs> {
  abstract execute(inputs: OutputsOf<Inputs>, run): AsyncIterableResult<Row> | Promise<number>
  peephole(graph, id): Node
}
class Find   extends Node<{ filter: FilterData[] }>                         { ast: SelectAst }
class Insert extends Node<{ payload: PayloadData[] }>                       { ast: InsertAst }
class Update extends Node<{ filter: FilterData[]; payload: PayloadData[] }> { ast: UpdateAst }
class Delete extends Node<{ filter: FilterData[] }>                         { ast: DeleteAst }
class Assert, Merge, State                                                   // slices 2 and 3

class Graph {
  add<I>(node: Node<I>, inputs: I): NodeId
  after(from: NodeId, to: NodeId): void
  replace(id: NodeId, next: Node): void
  result
}
```

Illustrative; names are settled only where a decision below says so.

Example, `post.update({ title, author: connect, comments: [create, deleteAll], tags: connect })`, state nodes left out:

```
n1 Find    post     where id = 1
n2 Find    user     where email = 'a@x'
n3 Assert  ROW_MISSING                         <- n2
n4 Update  post     set title = 'T'            <- FilterData n1 (id->id), PayloadData n2 (id->author_id), After n3
n5 Insert  comment  { body: 'hi' }             <- PayloadData n4 (id->post_id)
n6 Delete  comment  where spam                 <- FilterData n4 (id->post_id)
n7 Find    tag      where name = 'sql'
n8 Assert  ROW_MISSING                         <- n7
n9 Insert  post_tag {} on conflict do nothing  <- PayloadData n4 (id->post_id), PayloadData n7 (id->tag_id), After n8
result: n4
```

## Decisions

Each entry: the decision, why, and what it assumes. An assumption that turns out false is the signal to reopen the entry.

### D1. Nodes are database-level steps, not user operations

`Find`, `Insert`, `Update`, `Delete`, plus `Assert`, `Merge` and `State`. A translation in front turns each user operation on each relation layout into nodes and edges.

- **Why.** A user operation does not map to one statement shape: `connect` is an update of the child on one-to-many, a lookup feeding the parent's write when the parent holds the key, and a lookup plus a junction insert on many-to-many. Putting that table in one translation keeps the runner and the nodes free of relation knowledge. An earlier attempt to make user operations the classes failed for this reason.
- **Assumes.** Every user operation, present and planned, can be expressed as these node kinds.

### D2. Everything that comes from another node is an edge

Three edge classes: `After` (order only), `PayloadData` (copy columns into a write's values), `FilterData` (add `target = value`, or `IN` when the source has many rows). Each data edge carries a list of column pairs, so a composite key is one edge with several pairs.

- **Why.** With links as edges, a node's `where` stays an ordinary list of SQL AST expressions, the form the collection, the compile functions and the adapters already use. No placeholder inside expressions, no rewrite before compiling, no second representation of filters.
- **Assumes.** Scoping conditions can be expressed as column equalities against another node's rows (see D8 for many-to-many).

### D2a. A node holds its statement as SQL AST

`Find` holds a `SelectAst`, `Update` an `UpdateAst`, `Delete` a `DeleteAst`, `Insert` an `InsertAst`. The graph builder creates the AST; the runner applies a node's edges with the AST's own `withWhere`, `withRows` and `withReturning` and builds the plan from the result. A node has no description of its statement besides the AST.

- **Why.** The first build gave nodes their own fields (table identity, raw values, `where`, a copy of the read state) and the runner compiled them to AST with a switch on the node's class: two forms of one statement. The AST classes are already frozen and already have the operations the edges need. Inlining a `Find` into its consumer (D8) becomes a subquery over the `Find`'s AST.
- **Assumes.** Everything the runner needs besides the AST (which model the result's rows are mapped to, the caller's selection and includes) belongs to the graph's result, not to a node. A `Find` with includes holds the single `SelectAst` the read code already builds for a read with includes (base table plus one joined JSON column per include), and the result step decodes it with the read code's own consumer. Only writes with includes return identity columns and have their rows loaded by identity, because a write's returning clause cannot join related rows.

### D2b. Edges resolve data, nodes execute

An edge class has `output(sourceRow)`, which turns one row of its source into what its target consumes: `FilterData` a condition, `PayloadData` a record of values. A node class is generic over its inputs, a map from slot name to the edge class the slot accepts, and has `execute(inputs, run)`, which applies the inputs to its AST and runs the statement. `graph.add(node, inputs)` takes the node's inputs, typed by the node. The runner is a loop: for each node in position order, call `output` for every row of each input edge's source, call `execute`, keep what it returns.

Rules that make this precise:

- **Slots hold lists.** A node that takes several edges of one kind has one slot with a list (`payload: PayloadData[]`). One named slot per source is the fallback if combining a list inside `execute` gets complicated; it was not chosen because it needs a node class per relation layout.
- **What `execute` receives for an edge:** `null` when the edge is absent; otherwise a list with one `output` per source row, which is empty when the source had no rows. Absent and empty are different values because confusing them would turn `update()` on a missing row into an update of every row.
- **The node decides what an empty source means.** A write or a `Find` returns no rows without running its statement; `Assert` throws. The runner has no skip rule. (Replaces the runner-side rule of D6; the behaviour of D6 is unchanged.)
- **A node combines filters as `AND` across edges and `OR` across the rows of one edge.** Many rows give `id = 5 OR id = 6`, not `IN`, because `output` sees one row. Many-to-many scoping does not go through this; D8 turns it into `IN (SELECT ...)`.
- **Order-only edges are not inputs.** `graph.after(from, to)` adds one between two nodes already in the graph, `from` added before `to`. Table-state ordering (D4) gets its own edge class when `State` nodes arrive.
- **Rows or count is decided by the node's AST.** A statement that returns columns is run as a row stream, one that returns nothing as an affected-row count; `execute` returns what the runtime gave it, and the runner collects a stream only when another node reads from the node. No second class per write and no parameter.
- **The caller's rows are made in a step after `execute`,** described by the graph's result: model and variant for mapping, selected fields, includes. Every node, the result node included, returns storage rows, so any node can be read from.
- **An edge is given what it needs to build a parameter for its target column** (the codec) when the builder creates it, because `output` only receives a row.

- **Why.** In the first build the runner branched on edge classes to build conditions and on node classes to compile statements, so every new node or edge kind meant a change to the runner. With this split a new kind is a class, a wrong combination (a `PayloadData` into a `Delete`) does not compile, and an edge or a node can be tested alone.
- **Assumes.** Typing is checked at `graph.add`; inside the graph nodes are stored with the widest input type. How a peephole reads and rewrites typed inputs is decided with the first rule that needs it (D8, slice 4).

### D3. Order comes only from edges

No phases and no reliance on the order things were written in. The runner executes nodes one at a time in dependency order.

- **Why.** One mechanism decides order. The fixed phases of the old executor (parent-owned relations, parent write, child-owned, junction) are a consequence of data edges here, not a rule.

### D4. Table state is nodes in the graph

Per table, `State(table, n)`. A read depends on the latest state of its table. A write depends on the latest state and produces the next. A write also depends on every read of the state it replaces.

- **Why.** This orders a lookup after earlier writes to the same table, which fixes the defect where a lookup read rows as they were before an earlier write in the same call, without anyone having to remember to add an edge. State as nodes, not as bookkeeping in the builder, because peephole rules need to ask "do these two nodes see the same version of this table" and that must be readable from the graph.
- **Assumes.** Two nodes that touch different tables and share no data edge need no order between them, except as D5 says.

### D5. A write to the target of a `through` relation also advances the junction's state

Reads and junction writes use only their own table's state. An update or delete on the target table of a many-to-many relation depends on and advances the state of that relation's junction table.

- **Why.** `[t.connect(x), t.deleteAll()]` inserts into the junction and deletes from the target: two tables, no shared state, no order. The order matters, because deleting the target changes junction rows through the foreign key. The rule models that one hop and nothing more.
- **Assumes.** The only cross-table ordering that matters within one relation's array is target-versus-junction. A schema that also declares a direct relation from the parent to the junction model can still produce two writes with no defined order; that case is accepted as unordered.

### D6. An empty source skips its consumers; `Assert` is the only way empty becomes an error

A node whose data-edge source produced no row is skipped and is empty itself. An `Assert` node attached to a result throws a named error when that result is empty.

- **Why.** One rule covers `update()` finding no row (everything is skipped, the result is `null`), `connect` finding no target (`Assert` raises `ORM.RELATION_ROW_MISSING`), and the planned nested upsert (an `Assert` on an `Insert`). No conditional nodes.
- **Assumes.** No operation needs "do A if the row exists, otherwise B" as two different statement shapes. A to-one nested upsert is the case to check against this when it is designed.

### D7. Optimisation is by peephole, at construction

Each node class may override `peephole()`, which looks at the node and its inputs and returns the node or a replacement. `Graph.add` calls it. There are no passes and no worklist.

- **Why.** A local rule owned by a node class is small and testable with a three-node graph, and rules that run as nodes are added have no order to choose. A worklist is added only when a rule can become applicable because of a later change (merging duplicate lookups would be one).
- **Assumes.** The rules needed are local. The first two: inlining (D8) and removing an `Update` that sets nothing.

### D8. Many-to-many scoping is a junction read plus a peephole

The translation emits a `Find` on the junction for this parent, with an `FilterData` edge from it to the write on the target. A peephole on the consumer inlines a `Find` that has no other user as `column IN (SELECT ...)`, and that `Find` is removed.

- **Why.** The base graph needs only plain edges, and the junction knowledge stays in the translation. Measured on 200,000 tags and 2,000 posts with 20 tags each: the `IN (SELECT ...)` form took 0.2 ms on Postgres and 0.06 ms on SQLite; the correlated `EXISTS` form the old executor used took 0.2-0.5 ms on Postgres and 9.5-25.8 ms on SQLite, because SQLite scans the whole target table.
- **Assumes.** This peephole is required, not optional: without it the `IN` list is as long as the relation and exceeds bound-value limits. The SQL AST can express `IN` over a subquery for one column today (`BinaryExpr.in` with `SubqueryExpr`); the row-value form for composite keys is unverified.

### D9. Adding a data edge makes its source return the columns the edge reads

When `graph.add` attaches a data edge, the graph replaces the source node in its slot with one whose AST also returns the edge's source columns. The builder sets the caller's selection on the result node the same way. A node has a method for "this node, also returning these columns" so the graph does not need to know its AST class.

- **Why.** `execute` then needs no list of columns passed in and edges need no second method; the AST alone says what a node returns and whether it is the count form. This reverses the first version of this decision, which derived the columns at run time from the outgoing edges: with nodes holding AST and `replace` being a write to one slot, updating the source is the simpler mechanism.
- **Assumes.** If a peephole removes an edge, the source keeps returning a column nobody reads. That is accepted. Columns returned only for an edge are removed from the caller's row by the result step.

### D10. Nodes are frozen

A peephole returns a new node and the graph rewires edges to it.

- **Why.** It is the repo's convention for IR class hierarchies, a rule cannot change a node it does not own, and the only cost is one `replace` function the graph needs anyway.

### D10a. The graph is a bidirectional adjacency list with stable positions

Nodes sit in numbered slots; a node is referred to by its position, which `add` returns. An edge is one object holding `from` and `to` as positions and is listed at both of its nodes (edges in, edges out). Replacing a node writes its slot and touches no edge. A removed node leaves its slot empty; other positions do not change. Position order is dependency order.

- **Why.** The operations are: append a node with its inputs, look up the edges into and out of a node, replace a node, remove a node, make a node's users read from another node. Edges that hold node objects had to be rebuilt on every replacement, and a single edge array made every lookup a scan. This is the form of Boost's `adjacency_list` with `bidirectionalS` and petgraph's `StableGraph`: parallel edges, data on edges, both directions by lookup, removal that does not invalidate other positions.
- **Assumes.** Nodes stay frozen and edges stay separate objects (D2, D10). The form compilers use, where each node holds mutable arrays of its inputs and users (Simple, LLVM), fits peephole rules slightly better and is the one to revisit if those two decisions change.

### D11. The caller's `select` is returned by the write; `include` is loaded afterwards by the existing read code

- **Why.** Returning the selection from the write costs no extra statement, which is what plain writes do today and nested writes do not (they reload the row). Putting includes in the graph would mean building the read half of a planner, which is out of scope.

### D12. Annotations are an argument to the runner

The caller's annotation map is merged onto every statement of the call.

- **Why.** The map describes the call, not a statement. Today statements issued for nested operations carry no annotations; with this they do.

### D13. A `Merge` node, and variant writes go through the graph

A variant stored in its own table is an `Insert` into the base table, an `Insert` into the variant table with a data edge for the key, and a `Merge` of the two rows as the result. A variant stored in the base table is one `Insert` with a literal discriminator.

- **Why.** Variant handling then applies whether or not the call has relation callbacks. On main it exists only in the plain create path, and the nested executor has no variant handling at all.
- **Assumes.** Main's tests pin base-then-variant order and that the returned row comes from the variant insert; the merge must reproduce both.

### D14. Scope: every write method of the collection

`create`, `createAll`, `createAndCount`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`, `upsert`. Reads are not included.

- **Why.** On main, `create()` and `update()` branch on "does the input contain a relation callback", and the two branches differ: annotations, variant handling and the returned selection exist in one and not the other. Plain `create()` and `update()` call the bulk functions with one row, so moving only the single-row methods would leave two implementations of the same write. One path removes the branch and the duplication.

### D15. Intermediate nodes are collected; only the result node may stream

A node another node reads from is collected into an array first. The result node is handed to the existing function that turns a compiled write into a stream and applies selection and includes. An `PayloadData` edge requires a one-row source, checked when the graph is built.

- **Why.** The bulk methods return streams today. Making every node a stream brings buffering rules that exist mostly for reads.

### D16. More than one statement means a transaction

The runner opens a transaction when the graph will execute more than one statement, and runs a single statement directly. A transaction supplied by the caller is used as is.

- **Why.** It reproduces what each path on main does today from one rule, and it does not hold a connection open around a single streamed statement.

### D17. Delivery: restructure first, then features

Stage 1 builds the graph for what main does today. The bar is that every integration test on main passes unedited on Postgres and SQLite; SQL statements may change freely, and statement-level unit tests are rewritten. Stage 2 adds the project's features one at a time as translation entries.

- **Why.** PR #30634 mixed new behaviour, fixes and restructuring in one executor and could not be read. The structure has to be reviewable separately from the behaviour.

## Smaller points settled without discussion

- The name is "mutation graph", with nodes and edges. "Plan" already means a compiled statement in this package.
- The graph names its result node and whether the caller gets rows, the first row, or a count.
- Input that can be rejected from the input and the contract alone is rejected while the graph is built, before any statement runs.
- `upsert` is an `Insert` node with a conflict clause.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| The runner decides that a node with an empty source is skipped, or the edge returns a "skip" value | The node decides; `Assert` needs the opposite of every other node, and that belongs in its own `execute` |
| `output` called once with all source rows | "No rows" then needs a special expression for filters and has no value at all for payloads |
| Two classes per write, or a rows/count parameter | The AST's returning already says it; a parameter can disagree with it |
| A `Return` node that shapes the caller's rows | Its output is not storage rows, and a one-node graph would become two |
| Deriving returned columns at run time from outgoing edges | A second method on every edge and an extra argument to `execute` |
| Graph as an edge list, or edges that hold node objects | Lookups scan the graph; every replacement rebuilds the node's edges |
| Adjacency list with input edges only | "Who reads from this node" is a scan, and rules that redirect a node's users need it |
| Use-def and def-use arrays on the nodes (Simple, LLVM) | Nodes are mutated on every change and an edge has nowhere to carry its kind and column pairs |
| Adjacency matrix, compressed sparse row, adjacency map | For dense graphs; for graphs that do not change; no parallel edges without a further level |
| Keep the executor and make it more regular (one object per relation layout, one class per user operation) | Tried in PR #30634 and abandoned: `create` does not fit an attach/detach interface, and statements still run as a side effect with nothing to inspect |
| Classes for user operations (`Connect`, `Disconnect`, ...) in the list | Each would branch on relation layout when run; the per-layout knowledge belongs in one translation |
| Links as references embedded in a node's values and `where`, filled in before compiling | Needs a placeholder inside expression trees and a rewrite step; edges avoid both |
| Separate payload and filter link types | One edge hierarchy with a class per use is enough; the position says what the data does |
| Order from the order the caller wrote things in, with an exception for what the parent's write needs | Two mechanisms for order; edges alone decide it |
| An order-only edge between consecutive operations of one array | Table state already orders most pairs; D5 covers the remaining many-to-many pairs without a per-array rule |
| A write advancing the state of every table that references its table | Spreads through the schema, needs cycle handling, and depends on foreign keys the contract does not always have |
| Table state as bookkeeping in the builder | Peephole rules could not ask whether two nodes see the same version of a table |
| A junction-aware edge lowered to `EXISTS` | A special edge where a peephole belongs; and `EXISTS` is slow on SQLite |
| Optimisation passes run in a chosen order | Order between passes has to be found by trial; peepholes at construction have none |
| A worklist run after the graph is built | Not needed for the rules we have; added only when a rule requires it |
| Storing returned columns on the node and updating them when an edge is added | Repeats what the edges say and becomes wrong when an edge is removed |
| Mutable nodes | Would save one `replace` function and lose value comparison and safety |
| A required/optional flag on `Find` | `Assert` as a node works for any result, not only lookups |
| Conditional nodes | Skip-on-empty plus `Assert` covers every case we have |
| Scope limited to nested writes, or to single-row `create()` and `update()` | Leaves the branch between nested and plain paths, or two implementations of each write |
| The whole planner from `projects/ssa-planner` on the `worktree-ssa-planner` branch of the archived `prisma/prisma-next`, reads included | Out of proportion for this project; five of its decisions are taken (edges that copy columns, order from dependencies, table state, expansion of nested operations into reads and writes, printable graphs) and its read side, passes and streaming model are not |

## Sources consulted

- `projects/ssa-planner` (spec, data structures, plan) on branch `worktree-ssa-planner` of `prisma/prisma-next`: a design, not implemented.
- `SeaOfNodes/Simple`, chapters 2 and 9: peepholes at node construction; the worklist to a fixed point.
- `projects/psl-relation-syntax` on branch `tml-2943-s4-implicit-mn-synthesis` of `prisma/prisma-next`: implicit many-to-many with a model-less junction, designed and partly built, never merged. The graph therefore works from a relation's `through` and never assumes a junction model.

## Questions raised and decided

The rest of the decisions from the same round (ports PR, capability check, empty link columns, non-callback relation value, matrix fixtures) are in the project spec.

1. **Row-value `IN` for composite keys.** Decided: the SQL AST has no row-value form today; it is added to the AST and both adapters in the slice that adds many-to-many `updateAll` / `deleteAll`. Rejected: `EXISTS` for composite keys only (two statement forms, and the slow one on SQLite); refusing those relations.
2. **Junction `connect` in stage 1.** Decided: slice `graph-nested` takes the already-decided behaviour: a conflict clause where the junction has a key over exactly its link columns, a plain insert otherwise, no duplicate check, no wrapped error; `ORM.RELATION_LINK_DUPLICATE` is removed. It is the one deliberate behaviour change in stage 1. No test on main asserts either of main's errors. Rejected: reproducing main's duplicate check and wrapped error in stage 1, which needs a comparison of two lookups' rows and a per-node error mapping that nothing else uses and that the next slice would remove.
3. **Rejection timing in stage 1.** Decided: the graph rejects invalid nested input while it is built, before any statement, including when the filter matches no row, where main resolves `null`. This matches Prisma 7 and is the second deliberate behaviour change in stage 1. An integration test on main that asserts the `null` result, if one exists, is edited in slice `graph-nested`; that has not been checked yet. Rejected: postponing validation until the parent lookup has returned a row, which carries unvalidated input into the runner.
4. **`createAll` batching.** Decided: an `Insert` node is exactly one statement and holds one or many rows. The translation decides the batching: rows that can go into one statement become one node; rows that cannot (different column sets without the `defaultInInsert` capability, own-table variants, a row with nested operations of its own) become several nodes. The node never splits itself into statements, and no peephole merges inserts. How the rows of several `Insert` nodes are combined into the call's result, in input order, is settled in the design of slice `graph-creates`.
5. **Annotations.** Decided: the runner takes the caller's annotations and puts them on every statement the call executes, including lookups, child writes and junction inserts. A middleware sees the annotation once per statement. Rejected: annotating only the result node's statement.

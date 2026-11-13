# Design: loading includes with one query per relation

## Decision

When the database cannot run the ORM's one-query include correctly, the ORM loads includes with **one query per relation**: it reads the parent rows, then runs one query per relation for all of those parents at once, and attaches each related row to its parent in JavaScript.

The ORM client already runs a write as a graph of statements that pass rows to each other (`sql-orm-client/src/mutation-graph/`). A read with includes becomes such a graph too: a `Find` for the parents, one step per relation that reads the related rows of those parents by their keys, and a new step, `NestJoin`, that attaches the children. A write that returns rows with includes adds the same steps after its read-back step. The folder is renamed `statement-graph`, because it now runs reads as well.

Three capabilities say whether the one-query include is correct on a database: `sql.jsonAgg`, and two new ones, `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`. The ORM uses the one-query include only when the contract reports all three. Postgres, SQLite and MySQL report all three. MariaDB reports only `jsonAgg`, so MariaDB loads every include per relation.

```ts
const posts = await db.orm.Post
  .include('author')
  .include('comments', (c) => c.orderBy((comment) => comment.createdAt.desc()).limit(3))
  .all()
```

On MariaDB this sends three queries: the posts; the authors of those posts; and at most three comments per post. On Postgres, SQLite and MySQL it sends one query, as today.

This follows ADR 296 and ADR 302: the database does whatever it can do. The database still joins wherever it can run the one-query include, and under the per-relation strategy `limit`, `offset`, `distinct` and aggregates still run in SQL. JavaScript only attaches rows to their parents.

## Terms

- **Include:** related rows or a value computed from them, requested with `.include(…)`. A **row include** returns related rows. A **scalar include** returns one value per parent, such as `count` or `sum`.
- **Parent row** and **child row:** the row an include hangs off, and the related rows it returns. Nested includes make child rows the parents of the next level.
- **One-query include** (strategy `'join'`): today's strategy. Each include is a correlated subquery in the parent's `SELECT` that aggregates the child rows into a JSON array (`sql-orm-client/src/query-plan-select.ts`).
- **Per-relation strategy** (strategy `'query'`): the strategy this document designs.
- **Derived table:** a subquery in a `FROM` clause, `FROM (SELECT …) alias`.
- **Statement graph:** the ORM client's graph of steps for one call (`Graph` in `mutation-graph/graph.ts`). A step is a node. A `StatementNode` sends statements; other nodes, such as `CrossJoin` and `UnionAll`, combine rows in memory. An edge passes one node's rows to another.
- **Keys edge:** an edge that passes the rows of one node to another as key values. `FindByKeys` takes its keys this way today (a `Rows` edge in its `keys` slot).
- **Identity:** a table's primary key, or a unique key whose columns are all `NOT NULL`.
- **`FindRelated`:** the new statement node that runs one include's child query (section 3). The name is a suggestion for Will; "related" is the ORM client's word for the other side of a relation (`relatedModelName`).

## Requirements

- **R1.** Every include form the ORM supports returns the same result under both strategies: row and scalar includes, to-one, to-many and many-to-many relations, relations declared on a multi-table-inheritance variant, nested includes, `orderBy`, `limit`, `offset`, `distinct(…)`, `distinctOn(…)` and `combine(…)`.
- **R2.** No include returns fewer rows than it matched without an error.
- **R3.** Reads and the reads that writes do to return their rows (`create`, `update`, `upsert`, `delete` with an include) both work, through one mechanism.
- **R4.** Every query is one the database runs, and none can exceed the server's packet size.
- **R5.** Keys compare correctly for every key type and under case-insensitive collations.
- **R6.** A cached read with includes is keyed by the whole read.
- **R7.** No target name appears in shared code; the choice is made from capabilities the adapters report.
- **R8.** Nothing in the framework domain or the SQL runtime changes.

## Design

### 1. Capabilities

Three capabilities in the SQL family's capability namespace decide the strategy:

- **`jsonAgg`** (existing): the database aggregates rows into JSON. Nothing reads it today; the strategy choice now does.
- **`outerReferencesInDerivedTables`** (new): the database resolves a reference to the outer query from inside a derived table in a subquery. The one-query include needs it, because every row include reads from such a derived table.
- **`jsonAggWithoutTruncation`** (new): when the database aggregates rows into a JSON array that is too large, the query fails or the array cannot be decoded; it never returns a shorter valid array.

| Database | `jsonAgg` | `outerReferencesInDerivedTables` | `jsonAggWithoutTruncation` |
| --- | --- | --- | --- |
| Postgres | yes | yes | yes |
| SQLite | yes | yes | yes |
| MySQL 8.4 | yes | yes | yes |
| MariaDB 10.11 | yes | no | no |

Changes to what adapters report:

- MySQL gains `jsonAgg: true`. It aggregates JSON and did not report it, because nothing read the capability.
- Postgres reports `jsonAgg` only in its `postgres` group today. It also reports `sql.jsonAgg`, as it does for `lateral`.
- Postgres, SQLite and MySQL report the two new capabilities as `true`.
- MariaDB's capabilities are built by spreading MySQL's, so it sets the two new ones to `false` explicitly.

MySQL's term for the second capability is "outer references in derived tables" (its manual and its 8.0.14 release, which lifted the restriction). The third has no prior name; "truncated" is the word MySQL and MariaDB use in their warnings.

Contracts emitted before the new capabilities existed still get them: the runtime merges the adapter's capabilities over the contract's (`sql-runtime/src/sql-context.ts`).

### 2. Choosing the strategy

`selectIncludeStrategy(contract): 'join' | 'query'` in `sql-orm-client` returns `'join'` when `contract.capabilities.sql` reports all three capabilities, and `'query'` otherwise. It reads the `sql` group directly: `hasContractCapability` accepts a key from any group, which would let `postgres.jsonAgg` stand in for `sql.jsonAgg`. It is the only place the choice is made. Reads (`collection.ts`) and the graphs for writes (`collection-graphs.ts`) both call it. A read without includes never calls it and is unchanged.

### 3. A per-relation read is a graph

The row-returning reads (`all`, `first` and the others built on `describeCollectionQuery`) build this graph when they have includes and the strategy is `'query'`:

```text
Find(posts) ──keys──▶ FindRelated(authors of those posts) ──┐
     │      ──keys──▶ FindRelated(comments of those posts) ─┤
     └──────────────────────────────────────────────────────┴─▶ NestJoin ─▶ result
```

1. **Check.** Before the graph is built, the ORM checks that every parent table in the include tree has an identity. A table without one fails the read with `ORM.ROW_IDENTITY_MISSING`, naming the table and the include. Reads and writes use one check: the writes' `requireIdentityColumnsForIncludes`. `resolveRowIdentityColumns` (`collection-contract.ts`) is fixed to skip a unique key with a nullable column, which it accepts today; a parent whose key is `NULL` would match nothing and get no children.
2. **Parent step.** A `Find` with today's parent query, without include subqueries. The graph adds the identity columns to its selection because another node reads them.
3. **One `FindRelated` per include.** A new `StatementNode`, modelled on `FindByKeys`. It takes a `keys` edge from the parent step, so it receives the parents' identity values, not ready-made conditions. It removes duplicate keys, splits them into chunks (section 6), and builds one statement per chunk (section 4). `Find` and `executeFiltered` are not changed: `Find` puts an edge's filter in the outermost `WHERE` and adds returned columns to the outermost select, and neither is valid for a child query wrapped in a derived table.
4. **Nested includes.** A `FindRelated` is the parent step of the next level: the next level's `FindRelated` takes its keys from it. When another node reads columns from a `FindRelated`, it adds them through every derived-table layer of its statement.
5. **`combine(…)`.** One `FindRelated` per branch.
6. **`NestJoin`.** A new node beside `CrossJoin` and `UnionAll`. It has a `left` slot for parent rows and one slot per include, or per `combine` branch, for child rows. Its edges pass each source row whole, including lists an inner `NestJoin` already attached; the existing `Rows` edge copies only the columns it lists, so this is a new edge kind beside it. For each parent row, `NestJoin` attaches the child rows whose parent key equals the parent's identity (section 5). Nested levels are joined innermost first, each by its own `NestJoin`.
7. **Shaping.** A graph's result is shaped by `shapeRows` (`run-graph.ts`), which today calls `consumeCollectionRows`. For a state with includes that leads to `consumeIncludeRows`, which expects a JSON payload per include and decodes each child cell with its codec. Rows from a `FindRelated` are already decoded, so decoding them again fails or gives wrong values. `shapeRows` therefore chooses by strategy between `consumeIncludeRows` and a new consumer beside it in `collection-dispatch.ts`. The new consumer walks `state.includes` and, at each level:
   - maps storage rows to model fields with the mapper top-level rows use (`mapStorageRowToModelFields`, or `mapPolymorphicRow` with the include's `nested.tables` and `variantValue`);
   - removes the columns another node read that the caller did not select, taken from `columnsReadFrom` of that level's own node, and the parent-key and row-number columns;
   - sets the include's field: the list of shaped child rows; the first row or `null` for a to-one relation; the aggregate value for a scalar include, with `emptyAggregateResult` for a parent with no row and for a `NULL` aggregate, as the one-query path does; an object keyed by branch name for `combine`.
   Each occurrence of a child row is shaped into its own object, nested lists included, so a row matched to several parents (many-to-many, or a to-one shared by several parents) is never shared between results.

### 4. The child queries

For the example's comments, for one chunk of parent identities:

```sql
SELECT parent_key, id, body, createdAt
FROM (
  SELECT p.id AS parent_key, c.id, c.body, c.createdAt,
         ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY c.createdAt DESC, c.id) AS rn
  FROM Comment c
  JOIN Post p ON c.postId = p.id
  WHERE p.id IN (?, ?, …)
) d
WHERE rn <= 3
ORDER BY parent_key, rn
```

How each include form is written:

| Form | Query |
| --- | --- |
| To-many, no paging | `SELECT p.<identity> AS parent_key, c.<cols> FROM child c JOIN parent p ON <relation> WHERE p.<identity> IN (…) ORDER BY parent_key, <caller's order>, c.<identity>` |
| `limit` / `offset` | The query above as a derived table with `ROW_NUMBER() OVER (PARTITION BY parent_key ORDER BY <caller's order>, c.<identity>) AS rn`, filtered by `rn > offset AND rn <= offset + limit` and ordered by `parent_key, rn`. `limit(0)` adds no `FindRelated`. |
| `distinct(cols)` | A first window `ROW_NUMBER() OVER (PARTITION BY parent_key, <cols> ORDER BY <caller's order>, c.<identity>)` keeps the row numbered 1 of each group, which is what `distinct` returns today; the paging window, if any, runs over those rows. |
| `distinctOn(cols)` | The same first window. It equals `DISTINCT ON` here, because `assertDistinctOnCompatibleOrder` already requires the order to start with the `distinctOn` columns. |
| To-one | As to-many, without paging. |
| Many-to-many | The junction table joins child to parent: `FROM child c JOIN junction j ON j.<child fk> = c.<key> JOIN parent p ON j.<parent fk> = p.<key>`. |
| Relation declared on a variant | The variant's table is joined to reach the relation's columns, as the one-query include does. The parent key returned is the root table's identity, so both sides of the match come from one column. |
| Scalar (`count`, `sum`, …) | `SELECT p.<identity> AS parent_key, <aggregate> … GROUP BY p.<identity>`. Paging or `distinct` on a scalar include applies the windows above in a derived table first. |
| `combine(…)` | Each branch is its own query, written by the rules above. |

Rules for every form:

- **Built by the existing include builder.** The functions in `query-plan-select.ts` that build the one-query include (polymorphic joins and projection, junction joins, order, the `distinct` wrap, scalar scoping) build these queries too. They take one new parameter: how the child is tied to the parent. It is the correlated outer reference, as today, or a join to the parent table that returns the parent's identity and filters on it. Only the outermost wrapping differs: JSON aggregation in a correlated subquery, or a `ROW_NUMBER` window in a derived table. There is no second include builder.
- **The identity filter sits beside the join,** inside every derived table. In the outer `WHERE` the parent's columns do not exist.
- **Aliases.** The example shows `parent_key`, `rn`, `p` and `c` for reading. The real aliases are reserved ones, as `__prisma_distinct_rn` is today (`query-plan-source.ts`): one parent-key column per identity column, and a row-number column, all prefixed `__prisma_`. Table aliases come from the include's `TableScope`, which also covers a self-relation. `GROUP BY` names the expressions, not an alias.
- **Tie-break.** The child's identity ends every window's and query's order, so ties have one order. A child table without an identity orders by the caller's order only, as the one-query include does today.
- Columns are always listed, never `*`. The caller's own filter and cursor on the include go in the same `WHERE` as the identity filter.

The derived tables contain no reference to an outer query, so a database without `outerReferencesInDerivedTables` runs them.

### 5. Keys

The parent key in a child row and the identity in the parent row are the same column, read through the same codec, so they decode to equal JavaScript values. `NestJoin` matches them through `stitchKey(value)`, which turns a decoded key into a string for a `Map`: a `bigint` as its decimal text, a `Uint8Array` as hex, a `Date` or Temporal value as its ISO 8601 text, a number or string as itself; a composite identity as the JSON array of those parts. A key that decodes to any other kind of value fails the read with `ORM.ROW_IDENTITY_MISSING`.

The keys a `FindRelated` sends are the decoded values, encoded through the column's codec like any other parameter, so the database compares them with the column's own type and collation. A single-column identity is written as an `IN` list. A composite identity is written as an `OR` of `AND`s (`anyOf` in `filtered-statement.ts`); the SQL AST has no row-value expression, and this design adds none.

### 6. Chunking

`FindByKeys` already splits its keys into chunks of 500 (`KEYS_PER_STATEMENT`), for a reason of its own. The splitting moves into one helper that `FindByKeys` and `FindRelated` share, with the limits passed in.

`FindRelated` first removes duplicate keys, by `stitchKey`: the rows of a to-one or many-to-many level repeat a key, and a key split across two chunks would return its children twice. A chunk then holds at most **10 000 bound parameters** (keys × identity columns) and an estimated **1 MiB** of key values. The ORM never encodes parameters, since the runtime does that later, so the size is estimated from the decoded values: twice the UTF-8 length of a string, twice the length of a `Uint8Array`, the decimal text of a `bigint`, and a fixed 32 bytes for anything else. The first limit keeps a chunk under the bind-parameter limits of Postgres and SQLite; the second keeps a statement far below MariaDB's and MySQL's default 16 MiB `max_allowed_packet`, which, when exceeded, drops the connection.

The rows of a `FindRelated`'s chunks are concatenated in chunk order. Chunking cannot split a page or an aggregate, because every window and `GROUP BY` is per parent and each parent is in one chunk. A `FindRelated` with no keys sends no statement.

### 7. Writes that return rows with includes

A write's graph ends in a read-back step: `Find`, or `FindByKeys` for an insert on a database without `RETURNING` (`addWithIncludes`, `addReadBack` and `addFindOfWrittenRows` in `collection-graphs.ts`). Today that step's statement carries the include subqueries.

When the strategy is `'query'`, the read-back step reads the rows without includes, and the graph adds the steps of section 3 after it: one `FindRelated` per include fed by the read-back step, and a `NestJoin`. `FindByKeys` keeps its own work: returning rows in the order they were inserted, and failing when a row is missing.

Nodes run in the order they are added to the graph; state edges do not reorder them. In both delete graphs (`deleteFirstGraph`, `deleteAllGraph`) the include steps are therefore added after the parent `Find` and before the `Delete` node, so they read the children before a cascade removes them.

Creates on a multi-table-inheritance variant drop includes today (`#descriptionWithoutIncludes` in `collection.ts`). This design does not change that.

### 8. Transactions

The runner opens a transaction for any graph with more than one statement node (`runAllNodes` in `run-graph.ts`). The rule becomes: it opens one when the graph has more than one statement node **and writes a table**. The graph already records the tables each node writes (`#tablesWrittenBy` in `graph.ts`, private today; `Graph` gains a public member that says whether it writes any table).

A read with includes therefore runs without a transaction: no `BEGIN` and `COMMIT`, no connection held for the whole read, and no `transaction` activity for middleware. A write's graph is unchanged, and its include steps run inside the write's transaction. When the caller is already in a transaction, the statements run on it, as today.

### 9. Caching

The cache stores the result of the whole ORM call, under a hash of the method and a hash input (`ormCallContentHash` in `orm-call.ts`). Annotations sit on the call, never on the statements the ORM sends.

For a graph read, the hash input has two parts:

- the content hashes of the graph's statements (`node.statements`), in graph order. Each node holds its statement before any parent keys are added, so these describe the parent statement with the caller's filter values, and each child statement with its order, paging and selection;
- a canonical description of the include tree: at every level the relation name, whether it is to-one or to-many, the kind (rows, scalar or `combine`) and the branch names.

The second part is needed because some facts change the result and appear in no statement: `limit(0)` adds no statement, and `combine` branch names exist only in the shaped result. The one-query plan carries them as JSON keys, so today's key covers them.

Reads take their hash input from `CollectionQuery.plan()` today. It becomes a `hashInput` that both strategies provide. A read without includes keeps today's value.

### 10. Prepared reads

A prepared read is a single plan (`relational-core/src/plan.ts`, `Preparable`). Preparing a read with includes under the per-relation strategy fails with `ORM.CAPABILITY_MISSING`, naming the three capabilities. The refusal is raised in `prepared.all`, `prepared.first` and `prepared.firstOrThrow` (`collection.ts`), the only paths that build a `Preparable` with includes. Prepared reads without includes are unchanged.

### 11. The folder

`sql-orm-client/src/mutation-graph/` is renamed `statement-graph/`, in a commit of its own. The class names (`Graph`, `Find`, `StatementNode`) do not change. The docs that say "mutation graph runner" are updated.

## What the design accepts

- **Streaming.** Reads with includes already read every row before returning any (`collection-dispatch.ts`, `consumeIncludeRows`). The per-relation strategy does the same: it holds the parents and every level of children in memory until the read completes. Reads without includes still stream. Streaming with includes in batches, a parent query per page of identities followed by that page's children, can be added later without changing this design.
- **Consistency.** The queries of one read run one after another. At READ COMMITTED, which MariaDB and MySQL sessions use, each statement sees the latest committed data. A row committed between two queries can therefore appear in a later level: a child added to a parent already read is returned, and a child whose parent was deleted in between finds no parent and is dropped. A to-one child can also disagree with its parent's foreign-key column, when the foreign key changed between the two statements. ActiveRecord, Django and Prisma 7 load relations with the same behaviour.
- **`budgets` and `lints`.** `lints` warns about any `SELECT` without a `LIMIT`. `budgets`, where an application installs it, fails such a `SELECT` by default (`severities.rowCount` defaults to `'error'`). So with `budgets` installed, a read with includes that passes where the database runs the one-query include fails with `BUDGET.ROWS_EXCEEDED` where it loads per relation, as the ORM's read-backs after a write already do. This design does not change either middleware. Completing or removing them is a row in the GA plan (stream 6, row 8).
- **Keys a codec cannot reproduce.** A key is read, decoded, and sent back encoded. If the codec loses part of the stored value, the key sent back matches nothing and that parent gets no children, without an error. The known case is a `timestamptz(6)` or `datetime(6)` identity column read with a `Date` codec, which drops the digits below a millisecond. The write graphs already send decoded keys back this way. The defect is the codec's, and a fix belongs with the codecs; the framework's codec traits cannot be extended in this project. It is recorded in `deferred.md`.
- **Order of tied rows.** The per-relation strategy breaks ties with the child's identity; the one-query strategy leaves them undefined. Tests that run under both strategies must not depend on the order of tied rows.

## Requirements met

| Requirement | Met by |
| --- | --- |
| R1 every form, same result | Section 4's table; tests run the existing include suite under both strategies |
| R2 no silent short result | `jsonAggWithoutTruncation` is required for the one-query include; the per-relation strategy aggregates no JSON |
| R3 reads and writes, one mechanism | Sections 3 and 7: the same `FindRelated` and `NestJoin` steps |
| R4 runnable, bounded queries | Uncorrelated derived tables (section 4); chunking (section 6) |
| R5 keys | Filtering on the parent's identity (section 4); `stitchKey` (section 5) |
| R6 cache key | Section 9: statements and the include tree |
| R7 no target names | Sections 1 and 2 |
| R8 no framework or SQL runtime change | Changes are in the ORM client and the adapters' capability lists |

## What changes where

- **`sql-orm-client`:** `selectIncludeStrategy`; the new tie parameter of the include builder in `query-plan-select.ts`; `FindRelated`; `NestJoin`, its whole-row edge and `stitchKey`; the key-chunking helper shared with `FindByKeys`; the per-relation row consumer in `collection-dispatch.ts` and the choice in `shapeRows`; graph reads in `collection.ts` with `hashInput` in place of `CollectionQuery.plan()`; the read-back steps without includes; `resolveRowIdentityColumns` skipping nullable unique keys; the runner's transaction rule and the public member on `Graph`; the prepared-read refusal; the folder rename.
- **Adapters:** the capability changes of section 1. SQLite lists its capabilities in two places (`capabilities.ts` and `defaultCapabilities` in `adapter.ts`); both change. Emitted contracts and fixtures are regenerated.
- **Docs:**
  - `docs/reference/capabilities.md`: the two new keys, and MySQL's `jsonAgg`;
  - ADR 164: a row in its scenario table for includes, the include strategy in its section on strategy selection, and that a read of several statements opens no transaction;
  - ADR 296 and ADR 302: reworded to state their motivation (do in the database what the database can do), so they are not read as forbidding this strategy. ADR 302 keeps its statement about the user's own `in` filters;
  - ADR 031 and ADR 065: a pointer to ADR 164 where they describe the ORM's includes, and ADR 065's MySQL example;
  - subsystem docs 3 (Query Lanes), 4 (Runtime & Middleware Framework) and 5 (Adapters & Targets), and `docs/reference/framework-integration-analysis.md`: where they describe includes as one statement, or name the "mutation graph runner";
  - `coupling.md` row 17 and `deferred.md`.
- **Release notes:** the capability changes alter the profile hash of every emitted contract. The runtime logs `CONTRACT.MARKER_MISMATCH` as a warning until the database is signed again.
- **No change:** the framework domain; the SQL runtime and its middleware; the SQL AST (`WindowFuncExpr` already exists); `Find`.

## Tests

The ORM reads capabilities from the execution context's contract, and the include tests build that context in several ways, so one switch on the adapter descriptor does not reach them all:

- `test/integration/test/sql-orm-client/helpers.ts` builds the shared contexts with `postgresAdapter`;
- about eleven call sites replace the contract after the merge (`integration-helpers.ts`, `nested-includes-helpers.ts`), which bypasses the adapter;
- the value-parity suites build their own context (`include-codecs`, `include-codec-canonical-json`, `char-padding-include`, `float-non-finite-include`);
- the ported Prisma suites go through the public `postgres({…})` facade.

So the tests get one helper that returns the Postgres adapter descriptor for a given strategy, with `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` set to `false` for `'query'`. Every include suite builds its context through it and runs under both strategies with `describe.each`. Under `'query'` each suite asserts that it sent at least one statement per include, so a suite that stayed on `'join'` fails. The ported suites are covered where their harness can take the adapter without a new facade option; a facade option added only for tests is not acceptable.

Hand-written capability literals that would otherwise change strategy while asserting one-query SQL gain the two new capabilities: `nested-includes-helpers.ts`, and the unit tests `collection-dispatch.test.ts` and `orm-namespace-relation.test.ts`.

New tests cover: the identity check, and a nullable unique key not counting as an identity; `stitchKey` for each key type; duplicate keys under a to-one read from the foreign-key side, with more parents than one chunk holds; chunk boundaries by parameter count, including a composite identity, and by size; a parent with no children, and an all-`NULL` aggregate, for each scalar aggregate; `distinctOn`; a child table with a column named `parent_key`; a self-relation; hidden identity columns removed at every level; the cache key differing by include, by `limit(0)` and by `combine` branch name; a read with includes opening no transaction; the prepared-read refusal; each write with includes, including `create` through `FindByKeys`; and a delete with an include whose children are removed by `ON DELETE CASCADE`.

MySQL's ORM live tests run against MariaDB in slice 6b-2.

## To probe on MariaDB 10.11 during the build

- A subquery in a window's `ORDER BY` inside a derived table, which a paged include ordered by a relation produces.
- An `IN` list of 1 000 or more string keys, which MariaDB turns into a table of values (`in_predicate_conversion_threshold`): the results under the default collation.

## Evidence

Probed on MariaDB 10.11 and MySQL 8.4:

- MariaDB 10.11 fails every row include with "Unknown column": it does not resolve the outer reference inside the include's derived table.
- MariaDB cuts `JSON_ARRAYAGG` at `group_concat_max_len` and at `max_allowed_packet` with only a warning; a cut on an element boundary is valid JSON with fewer elements. No session setting prevents the packet cut.
- MySQL 8.4 also cuts an oversized `JSON_ARRAYAGG` at `max_allowed_packet`, with warning 1301, but cuts the raw text, so the closing `]` is lost and decoding fails. Its ordered includes fail a `CAST(… AS JSON)` the same way. This is why MySQL reports `jsonAggWithoutTruncation`. The error is a decoding error, not a message about size; a clearer message is a separate follow-up.
- Filtering child rows on the parent's join column instead of its identity returned every row sharing the foreign key: 10 posts with their author returned 100 010 rows.
- Under MariaDB's default collation `'Red'`, `'red'` and `'Red '` are equal in SQL and different in JavaScript.
- A `ROW_NUMBER` window without the child's identity in its order returned tied rows in either order.
- A statement over `max_allowed_packet` (17.5 MB against 16 MiB) dropped the connection with `ERROR 2006`.
- 20 000 keys in one `IN` list against a million child rows took 30–140 ms.

Read in the code, not run: the graph parts this design reuses (`FindByKeys`' keys edge and chunking, `columnsReadFrom`, `shapeRows`, `runAllNodes`), and that the ORM's statements carry no annotations. This version was reviewed against the code by an architect and a principal engineer on 2026-11-14; both approved it with the changes now folded in.

## Alternatives considered

- **Running each child query in `Find`, fed by a filter-data edge.** `Find` puts the filter in the outermost `WHERE` and adds returned columns to the outermost select, both invalid for a windowed child query, and a filter-data edge hands over conditions, not the key values that chunking and removing duplicates need. Making `Find` handle this would be a mode on a shared node for one use.
- **Refusing a key column whose codec decodes to a floating-point number.** A double read through one codec always gives the same number and the same text, so matching is safe.
- **A row-value `IN` for composite identities.** It needs a new SQL AST node. An `OR` of `AND`s with a parameter limit per chunk needs none.
- **A `Preload` node that replaces `Find` in write graphs, and a separate loader for reads.** The first version of this design. It did not cover `create` on a database without `RETURNING`, which reads back through `FindByKeys`, and it built per-relation loading twice. The graph already passes one step's rows to another's filter.
- **An annotation that makes `budgets` and `lints` skip child queries.** A flag in the SQL runtime set by one caller. The two middleware already flag the ORM's other statements; they are handled as a whole in the GA plan.
- **Deleting `sql.jsonAgg`.** The one-query include depends on JSON aggregation, so the choice should read the capability, and a database without it will need it.
- **Running a read with includes in a transaction.** At READ COMMITTED each statement still sees the latest committed data, so it costs two round trips and a held connection for nothing.
- **A one-query include rewritten for MariaDB, checked for a short result.** The correlation moves into the subquery's own `WHERE`, which MariaDB runs, and each array is checked against `COUNT(*)`, raising an error through a deliberate arithmetic overflow when they differ. Rejected: the aggregate is built twice per nesting level (two levels went from 0.86 s to 2.43 s), the error is recognised by matching message text, and `distinct`, paged scalar includes and `combine` cannot be written this way. No other tool does it.
- **Drizzle's mode for databases without lateral joins.** It still puts the correlation inside a derived table when a relation is ordered or paged, which MariaDB rejects, and it does not enforce the order of related rows.
- **Restoring the multi-query code the ORM client removed in commit `70482700f2`.** It read every child row and cut pages in JavaScript, computed aggregates in JavaScript, and matched rows on the foreign key, which the collation evidence shows is wrong.
- **One query joining parents and children, de-duplicated in JavaScript** (ActiveRecord's `eager_load`). Paging per parent and several to-many relations multiply the rows returned.

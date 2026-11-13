# Design: loading includes with one query per relation

## Decision

When the database cannot run the ORM's one-query include correctly, the ORM loads includes with **one query per relation**: it reads the parent rows, then runs one query per relation for all of those parents at once, and attaches each related row to its parent in JavaScript.

The ORM client already runs a write as a graph of statements that pass rows to each other (`sql-orm-client/src/mutation-graph/`). A read with includes becomes such a graph too: a `Find` for the parents, one `Find` per relation fed by the parents' keys, and a new step, `NestJoin`, that attaches the children. A write that returns rows with includes adds the same steps after its read-back step. The folder is renamed `statement-graph`, because it now runs reads as well.

Three capabilities say whether the one-query include is correct on a database: `sql.jsonAgg`, and two new ones, `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`. The ORM uses the one-query include only when the contract reports all three. Postgres, SQLite and MySQL report all three. MariaDB reports only `jsonAgg`, so MariaDB loads every include per relation.

```ts
const posts = await db.orm.Post
  .include({ author: true, comments: (c) => c.orderBy({ createdAt: 'desc' }).take(3) })
  .findMany()
```

On MariaDB this sends three queries: the posts; the authors of those posts; and at most three comments per post. On Postgres, SQLite and MySQL it sends one query, as today.

This follows ADR 296 and ADR 302: the database does whatever it can do. The database still joins wherever it can run the one-query include, and under the per-relation strategy paging, `distinct` and aggregates still run in SQL. JavaScript only attaches rows to their parents.

## Terms

- **Include:** related rows or a value computed from them, requested with `.include(…)`. A **row include** returns related rows. A **scalar include** returns one value per parent, such as `count` or `sum`.
- **Parent row** and **child row:** the row an include hangs off, and the related rows it returns. Nested includes make child rows the parents of the next level.
- **One-query include** (strategy `'join'`): today's strategy. Each include is a correlated subquery in the parent's `SELECT` that aggregates the child rows into a JSON array (`sql-orm-client/src/query-plan-select.ts`).
- **Per-relation strategy** (strategy `'query'`): the strategy this document designs.
- **Derived table:** a subquery in a `FROM` clause, `FROM (SELECT …) alias`.
- **Statement graph:** the ORM client's graph of steps for one call (`Graph` in `mutation-graph/graph.ts`). A step is a node. A `StatementNode` sends statements; other nodes, such as `CrossJoin` and `UnionAll`, combine rows in memory. An edge passes one node's rows to another.
- **Filter-data edge:** an edge that makes a `Find` match the rows whose columns equal the values in another node's rows (`FilterData` in `mutation-graph/filter-data.ts`). `Find` writes those values as an `IN` list.
- **Identity:** a table's primary key, or a unique key whose columns are all `NOT NULL`.

## Requirements

- **R1.** Every include form the ORM supports returns the same result under both strategies: row and scalar includes, to-one, to-many and many-to-many relations, relations declared on a multi-table-inheritance variant, nested includes, `orderBy`, `take`, `skip`, `distinct(…)` and `combine(…)`.
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

`selectIncludeStrategy(contract): 'join' | 'query'` in `sql-orm-client` returns `'join'` when the contract reports all three capabilities, and `'query'` otherwise. It is the only place the choice is made. Reads (`collection.ts`) and the graphs for writes (`collection-graphs.ts`) both call it. A read without includes never calls it and is unchanged.

### 3. A per-relation read is a graph

`findMany` and the other row-returning reads build this graph when they have includes and the strategy is `'query'`:

```text
Find(posts) ──filter-data──▶ Find(authors of those posts) ──┐
     │      ──filter-data──▶ Find(comments of those posts) ─┤
     └──────────────────────────────────────────────────────┴─▶ NestJoin ─▶ result
```

1. **Check.** Before the graph is built, the ORM checks that every parent table in the include tree has an identity. A table without one fails the read with `ORM.ROW_IDENTITY_MISSING`, naming the table and the include.
2. **Parent step.** A `Find` with today's parent query, without include subqueries. The graph adds the identity columns to its selection because another node reads them, and removes them from the result if the caller did not select them (`columnsReadFrom` and `shapeRows`, as for writes today).
3. **One `Find` per include.** Each joins the child table to the parent table and returns each child row with its parent's identity as `parent_key`. A filter-data edge from the parent step supplies the parents' identities, which `Find` writes as an `IN` list on the parent's identity columns.
4. **Nested includes.** A child `Find` is the parent step of the next level: the next level's `Find` takes a filter-data edge from it.
5. **`NestJoin`.** A new node beside `CrossJoin` and `UnionAll`. It has a `left` slot for parent rows and one slot per include for child rows. For each parent row it sets the include's field to the list of child rows whose `parent_key` equals the parent's identity (section 5), or to the first such row or `null` for a to-one relation, or to the aggregate value for a scalar include. Nested levels are joined innermost first, each by its own `NestJoin`.
6. **Shaping.** Child rows arrive from the runtime already decoded by their codecs, like any row. They are mapped to model fields by the mapper top-level rows use (`mapStorageRowToModelFields`, `mapPolymorphicRow`), not by the JSON decoding the one-query include needs.

### 4. The child queries

For the example's comments, with the parents' identities written in by the filter-data edge:

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
| `take` / `skip` | The query above as a derived table with `ROW_NUMBER() OVER (PARTITION BY parent_key ORDER BY <caller's order>, c.<identity>) AS rn`, filtered by `rn > skip AND rn <= skip + take` and ordered by `parent_key, rn`. The child's identity always ends the window's order, so ties have one order. `take(0)` adds no `Find`. |
| `distinct(cols)` | A first window `ROW_NUMBER() OVER (PARTITION BY parent_key, <cols> ORDER BY <caller's order>, c.<identity>)` keeps the row numbered 1 of each group, which is what `distinct` returns today; the paging window, if any, runs over those rows. |
| To-one | As to-many, without paging. |
| Many-to-many | The junction table joins child to parent: `FROM child c JOIN junction j ON j.<child fk> = c.<key> JOIN parent p ON j.<parent fk> = p.<key>`. |
| Relation declared on a variant | The variant's table is joined to reach the relation's columns, as the one-query include does. |
| Scalar (`count`, `sum`, …) | `SELECT p.<identity> AS parent_key, <aggregate> … GROUP BY parent_key`. A parent missing from the result gets the value the one-query include gives an empty set (`emptyAggregateResult`). Paging or `distinct` on a scalar include applies the windows above in a derived table first. |
| `combine(…)` | Each branch is its own `Find`, written by the rules above. |

Columns are always listed, never `*`. The caller's own filter on the include goes in the same `WHERE` as the identity filter.

**Where the identity filter goes.** `Find` adds an edge's filter to the outermost `WHERE` today (`executeFiltered`). In the windowed forms the filter must be inside the derived table, beside the join: outside it, the database numbers every row of the child table before filtering. The `Find` for a windowed include therefore applies its filter to the innermost select.

The derived tables above contain no reference to an outer query, so a database without `outerReferencesInDerivedTables` runs them.

### 5. Keys

`parent_key` in a child row and the identity in the parent row are the same column, read through the same codec, so they decode to equal JavaScript values. `NestJoin` matches them through `stitchKey(value)`, which turns a decoded key into a string for a `Map`: a `bigint` as its decimal text, a `Uint8Array` as hex, a `Date` or Temporal value as its ISO 8601 text, a number or string as itself; a composite identity as the JSON array of those parts. A key column whose codec decodes to a binary floating-point number (`float`, `double`) fails the read with `ORM.ROW_IDENTITY_MISSING`, because its text form is not stable.

The keys in the `IN` list are the decoded values, encoded through the column's codec like any other parameter, so the database compares them with the column's own type and collation.

A child row matched to several parents (many-to-many) is copied for each, so changing one result does not change another.

### 6. Chunking

`Find` writes all of an edge's keys into one `IN` list today. `FindByKeys` already splits its keys into chunks of 500 (`KEYS_PER_STATEMENT`), for a reason of its own. The splitting moves into one helper both use.

For an include's `Find`, a chunk holds at most **10 000 keys** and at most **1 MiB** of encoded key values, measured as the UTF-8 length of each value's encoded text (the hex length for bytes). The first limit keeps a chunk under the bind-parameter limits of Postgres and SQLite; the second keeps a statement far below MariaDB's and MySQL's default 16 MiB `max_allowed_packet`, which, when exceeded, drops the connection. The rows of a `Find`'s chunks are concatenated in chunk order. Chunking cannot split a page, because every window partitions by parent. A `Find` with no keys sends no statement, as today.

### 7. Writes that return rows with includes

A write's graph ends in a read-back step: `Find`, or `FindByKeys` for an insert on a database without `RETURNING` (`addWithIncludes`, `addReadBack` and `addFindOfWrittenRows` in `collection-graphs.ts`). Today that step's statement carries the include subqueries.

When the strategy is `'query'`, the read-back step reads the rows without includes, and the graph adds the steps of section 3 after it: one `Find` per include fed by the read-back step, and a `NestJoin`. `FindByKeys` keeps its own work: returning rows in the order they were inserted, and failing when a row is missing.

In both delete graphs (`deleteFirstGraph`, `deleteAllGraph`) the include steps run before the `Delete` node, as the `Find` does today.

### 8. Transactions

The runner opens a transaction for any graph with more than one statement node (`runAllNodes` in `run-graph.ts`). The rule becomes: it opens one when the graph has more than one statement node **and writes a table**. The graph already records the tables each node writes (`#tablesWrittenBy` in `graph.ts`).

A read with includes therefore runs without a transaction: no `BEGIN` and `COMMIT`, no connection held for the whole read, and no `transaction` activity for middleware. A write's graph is unchanged, and its include steps run inside the write's transaction. When the caller is already in a transaction, the statements run on it, as today.

### 9. Caching

The cache stores the result of the whole ORM call, under a hash of the method and a hash input (`ormCallContentHash` in `orm-call.ts`). Annotations sit on the call, never on the statements the ORM sends.

For a graph read, the hash input is the list of the content hashes of the graph's statements (`node.statements`), in graph order. Each `Find` holds its statement before any parent keys are added, so the list describes the read: the parent statement with the caller's filter values, and each child statement with its order, paging and selection. Two reads with different includes build different graphs and get different keys. A read without includes keeps today's hash input.

### 10. Prepared reads

A prepared read is a single plan (`relational-core/src/plan.ts`, `Preparable`). Preparing a read with includes under the per-relation strategy fails with `ORM.CAPABILITY_MISSING`, naming the three capabilities. Prepared reads without includes are unchanged.

### 11. The folder

`sql-orm-client/src/mutation-graph/` is renamed `statement-graph/`, in a commit of its own. The class names (`Graph`, `Find`, `StatementNode`) do not change. The docs that say "mutation graph runner" are updated.

## What the design accepts

- **Streaming.** Reads with includes already read every row before returning any (`collection-dispatch.ts`, `consumeIncludeRows`). The per-relation strategy does the same: it holds the parents and every level of children in memory until the read completes. Reads without includes still stream. Streaming with includes in batches, a parent query per page of identities followed by that page's children, can be added later without changing this design.
- **Consistency.** The queries of one read run one after another. At READ COMMITTED, which MariaDB and MySQL sessions use, each statement sees the latest committed data. A row committed between two queries can therefore appear in a later level: a child added to a parent already read is returned, and a child whose parent was deleted in between finds no parent and is dropped. ActiveRecord, Django and Prisma 7 load relations with the same behaviour.
- **`budgets` and `lints`.** These middleware of the SQL runtime flag any `SELECT` without a `LIMIT`, so they flag the child queries, as they already flag the ORM's read-backs after a write. This design does not change them. Completing or removing them is a row in the GA plan (stream 6, row 8).

## Requirements met

| Requirement | Met by |
| --- | --- |
| R1 every form, same result | Section 4's table; tests run the existing include suite under both strategies |
| R2 no silent short result | `jsonAggWithoutTruncation` is required for the one-query include; the per-relation strategy aggregates no JSON |
| R3 reads and writes, one mechanism | Sections 3 and 7: the same `Find` and `NestJoin` steps |
| R4 runnable, bounded queries | Uncorrelated derived tables (section 4); chunking (section 6) |
| R5 keys | Filtering on the parent's identity (section 4); `stitchKey` (section 5) |
| R6 cache key | Section 9 |
| R7 no target names | Sections 1 and 2 |
| R8 no framework or SQL runtime change | Changes are in the ORM client and the adapters' capability lists |

## What changes where

- **`sql-orm-client`:** `selectIncludeStrategy`; the child-query builder; `NestJoin` and `stitchKey`; the shared key-chunking helper; `Find` applying its filter to the innermost select of a windowed include; graph reads in `collection.ts`; the read-back steps without includes; the runner's transaction rule; the graph read's hash input; the prepared-read refusal; the folder rename.
- **Adapters:** the capability changes of section 1. Emitted contracts and fixtures are regenerated.
- **Docs:** the capability reference; the subsystem docs that describe includes and the "mutation graph runner"; ADR 164's section on strategy selection; ADR 296 and ADR 302, reworded to state their motivation (do in the database what the database can do) so they are not read as forbidding this strategy; `coupling.md` row 17.
- **Release notes:** the capability changes alter the profile hash of every emitted contract. The runtime logs `CONTRACT.MARKER_MISMATCH` as a warning until the database is signed again.
- **No change:** the framework domain; the SQL runtime and its middleware; the SQL AST (`WindowFuncExpr` already exists).

**Tests.** The existing Postgres include tests run a second time with `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` switched off through the adapter descriptor, whose capabilities override the contract's; that covers the per-relation strategy in CI without MariaDB. MySQL's ORM live tests run against MariaDB in slice 6b-2. New tests cover: the identity check; `stitchKey` for each key type; chunk boundaries by count and by size; a parent with no children for each scalar aggregate; the cache key differing by include; a read with includes opening no transaction; the prepared-read refusal; and each write with includes, including `create` through `FindByKeys`.

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

Read in the code, not run: the graph parts this design reuses (`Find`'s filter-data edge, `columnsReadFrom`, `shapeRows`, `runAllNodes`), and that the ORM's statements carry no annotations.

## Alternatives considered

- **A `Preload` node that replaces `Find` in write graphs, and a separate loader for reads.** The first version of this design. It did not cover `create` on a database without `RETURNING`, which reads back through `FindByKeys`, and it built per-relation loading twice. The graph already passes one step's rows to another's filter.
- **An annotation that makes `budgets` and `lints` skip child queries.** A flag in the SQL runtime set by one caller. The two middleware already flag the ORM's other statements; they are handled as a whole in the GA plan.
- **Deleting `sql.jsonAgg`.** The one-query include depends on JSON aggregation, so the choice should read the capability, and a database without it will need it.
- **Running a read with includes in a transaction.** At READ COMMITTED each statement still sees the latest committed data, so it costs two round trips and a held connection for nothing.
- **A one-query include rewritten for MariaDB, checked for a short result.** The correlation moves into the subquery's own `WHERE`, which MariaDB runs, and each array is checked against `COUNT(*)`, raising an error through a deliberate arithmetic overflow when they differ. Rejected: the aggregate is built twice per nesting level (two levels went from 0.86 s to 2.43 s), the error is recognised by matching message text, and `distinct`, paged scalar includes and `combine` cannot be written this way. No other tool does it.
- **Drizzle's mode for databases without lateral joins.** It still puts the correlation inside a derived table when a relation is ordered or paged, which MariaDB rejects, and it does not enforce the order of related rows.
- **Restoring the multi-query code the ORM client removed in commit `70482700f2`.** It read every child row and cut pages in JavaScript, computed aggregates in JavaScript, and matched rows on the foreign key, which the collation evidence shows is wrong.
- **One query joining parents and children, de-duplicated in JavaScript** (ActiveRecord's `eager_load`). Paging per parent and several to-many relations multiply the rows returned.

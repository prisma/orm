# Design: loading includes with one query per relation

## Decision

When the database cannot run the ORM's one-query include correctly, the ORM loads includes with **one query per relation**: it reads the parent rows, then runs one query per relation for all of those parents at once, and attaches each related row to its parent in JavaScript. This is how ActiveRecord's `preload` and Django's `prefetch_related` load relations.

Two new capabilities, `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`, say whether the one-query include is correct on a database. The ORM uses the one-query include only when the contract reports both, and the per-relation strategy otherwise. Postgres, SQLite and MySQL report both. MariaDB reports neither, so MariaDB loads every include per relation.

```ts
const posts = await db.orm.Post
  .include({ author: true, comments: (c) => c.orderBy({ createdAt: 'desc' }).take(3) })
  .findMany()
```

On MariaDB this sends three queries: the posts; the authors of those posts; and at most three comments per post. On Postgres, SQLite and MySQL it sends one query, as today.

## Terms

- **Include:** related rows or a value computed from them, requested with `.include(…)`. A **row include** returns related rows. A **scalar include** returns one value per parent, such as `count` or `sum`.
- **Parent row** and **child row:** the row an include hangs off, and the related rows it returns. Nested includes make child rows the parents of the next level.
- **One-query include** (strategy `'join'`): today's strategy. Each include is a correlated subquery in the parent's `SELECT` that aggregates the child rows into a JSON array (`sql-orm-client/src/query-plan-select.ts`).
- **Per-relation strategy** (strategy `'query'`): the strategy this document designs. The two values follow Prisma 7's `relationLoadStrategy: 'join' | 'query'`.
- **Derived table:** a subquery in a `FROM` clause, `FROM (SELECT …) alias`.
- **Stitching:** attaching child rows to their parent rows in JavaScript.

## Requirements

- **R1.** Every include form the ORM supports returns the same result under both strategies: row and scalar includes, to-one, to-many and many-to-many relations, relations declared on a multi-table-inheritance variant, nested includes, `orderBy`, `take`, `skip`, `distinct(…)` and `combine(…)`.
- **R2.** No include returns fewer rows than it matched without an error.
- **R3.** Reads and the reads that writes do to return their rows (`create`, `update`, `upsert`, `delete` with an include) both work.
- **R4.** Every query is one the database runs, and none can exceed the server's packet size.
- **R5.** Keys compare correctly for every key type and under case-insensitive collations.
- **R6.** Caching, budgets and lints behave for a per-relation read as they do for a one-query read.
- **R7.** No target name appears in shared code; the choice is made from capabilities the adapters report.
- **R8.** Nothing in the framework domain changes.

## Design

### 1. Capabilities

Two capabilities in the SQL family's capability namespace:

- **`outerReferencesInDerivedTables`:** the database resolves a reference to the outer query from inside a derived table in a subquery. The one-query include needs it, because every row include reads from such a derived table.
- **`jsonAggWithoutTruncation`:** when the database aggregates rows into a JSON array that is too large, the query fails or the array cannot be decoded; it never returns a shorter valid array.

| Database | `outerReferencesInDerivedTables` | `jsonAggWithoutTruncation` |
| --- | --- | --- |
| Postgres | yes | yes |
| SQLite | yes | yes |
| MySQL 8.4 | yes | yes |
| MariaDB 10.11 | no | no |

MariaDB's adapter sets both to `false` explicitly, because its capabilities are built by spreading MySQL's. `sql.jsonAgg` is deleted from every adapter and from the capability reference; nothing reads it.

MySQL's term for the first is "outer references in derived tables" (its manual and its 8.0.14 release, which lifted the restriction). The second has no prior name; "truncated" is the word MySQL and MariaDB use in their warnings.

Contracts emitted before the two capabilities existed still get them: the runtime merges the adapter's capabilities into the contract's (`sql-runtime/src/sql-context.ts`).

### 2. Choosing the strategy

`selectIncludeStrategy(contract): 'join' | 'query'` in `sql-orm-client` returns `'join'` when the contract reports both capabilities, and `'query'` otherwise. It is the only place the choice is made. The read path (`collection-dispatch.ts`) and the mutation graph (`mutation-graph/`) both call it. ADR 164's table of read strategies gains a row for it.

### 3. A per-relation read

1. **Build and check.** Before sending anything, the ORM checks that every parent table in the include tree has an identity: its primary key, or a unique key whose columns are all `NOT NULL`. A table without one fails the read with `ORM.ROW_IDENTITY_MISSING`, naming the table and the include.
2. **Parent query.** Today's query for the parent rows, without include subqueries, also selecting the identity columns. Identity columns the caller did not select are removed from the returned rows after stitching.
3. **One query per relation.** For each include at this level, one query for all parents read, in chunks (section 5). The query joins the child table to the parent table, filters on the parents' identities, and returns each child row with its parent's identity as `parent_key`:

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
   | `take` / `skip` | The query above as a derived table with `ROW_NUMBER() OVER (PARTITION BY parent_key ORDER BY <caller's order>, c.<identity>) AS rn`, filtered by `rn > skip AND rn <= skip + take` and ordered by `parent_key, rn`. The child's identity always ends the window's order, so ties have one order. `take(0)` sends no query. |
   | `distinct(cols)` | A first window `ROW_NUMBER() OVER (PARTITION BY parent_key, <cols> ORDER BY <caller's order>, c.<identity>)` keeps the row numbered 1 of each group, which is what `distinct` returns today; the paging window, if any, runs over those rows. |
   | To-one | As to-many, without paging. |
   | Many-to-many | The junction table joins child to parent: `FROM child c JOIN junction j ON j.<child fk> = c.<key> JOIN parent p ON j.<parent fk> = p.<key>`. |
   | Relation declared on a variant | The variant's table is joined to reach the relation's columns, as the one-query include does. |
   | Scalar (`count`, `sum`, …) | `SELECT p.<identity> AS parent_key, <aggregate> … GROUP BY parent_key`. A parent missing from the result gets the value the one-query include gives an empty set (`emptyAggregateResult`). Paging or `distinct` on a scalar include applies the windows above in a derived table first. |
   | `combine(…)` | Each branch is its own query, written by the rules above. |

   Columns are always listed, never `*`. The derived tables above contain no reference to an outer query, so a database without `outerReferencesInDerivedTables` runs them.
4. **Nested includes.** Step 3 repeats for the next level, with the child rows just read as parents and their identities as keys.
5. **Stitch** (section 4), then remove identity columns the caller did not select.

### 4. Keys and stitching

`parent_key` in a child row and the identity in the parent row are the same column, read through the same codec, so they decode to equal JavaScript values. `stitchKey(value)` in `sql-orm-client` turns a decoded key into a string for a `Map`: a `bigint` as its decimal text, a `Uint8Array` as hex, a `Date` or Temporal value as its ISO 8601 text, a number or string as itself; a composite identity as the JSON array of those parts. A key column whose codec decodes to a binary floating-point number (`float`, `double`) fails the read with `ORM.ROW_IDENTITY_MISSING`, because its text form is not stable.

Keys sent in the `IN` list are the decoded values, encoded through the column's codec like any other parameter, so the database compares them with the column's own type and collation.

A child row matched to several parents (many-to-many) is copied for each, so changing one result does not change another.

### 5. Chunking

The keys of one level are sent in chunks. A chunk holds at most **10 000 keys** and at most **1 MiB** of encoded key values, measured as the UTF-8 length of each value's encoded text (the hex length for bytes). The first limit keeps a chunk under the bind-parameter limits of Postgres and SQLite; the second keeps a statement far below MariaDB's and MySQL's default 16 MiB `max_allowed_packet`, which, when exceeded, drops the connection. The results of a level's chunks are concatenated in chunk order. Chunking cannot split a page, because every window partitions by parent. A level with no keys sends no query.

### 6. Writes that return rows with includes

The mutation graph reads back written rows through its `Find` node (`mutation-graph/find.ts`), which runs one statement and decodes includes from JSON. When `selectIncludeStrategy` returns `'query'`, the graph uses a new node, `Preload`, in its place. The node takes the identities the write collected, reads the parent rows by identity, and runs sections 3 to 5 for the include tree. It runs in the write's transaction. In both delete graphs (`delete` and `deleteAll`) it runs before the `Delete` node, as `Find` does today.

### 7. Caching

An ORM read is cached under a hash of its first plan (`orm-call.ts`, `planHashInput`). For a per-relation read, the hash input is the list of the parent plan and every include query of the include tree, each built by the same builder as the real query but with an empty key list. Two reads with different includes, `take` or ordering therefore never share a key.

### 8. Budgets and lints

The `budgets` and `lints` middleware in the SQL runtime check each plan on its own: `budgets` refuses a `SELECT` without `LIMIT` in `beforeEncode` and counts rows in `onRow`. Child queries have no `LIMIT`, and a level can return more rows than the parent query did.

The SQL runtime defines an annotation handle, `secondarySelectAnnotation` (annotation name `'secondarySelect'`, Hibernate's term for a select issued after the main one to load related data), marking a plan as one statement of a read the ORM is loading in several statements. The ORM sets it on every child query. `budgets` skips its `LIMIT` check and its row count for a plan carrying it, and `lints` skips its missing-`LIMIT` lint. The parent query is checked as today. It is not the cache's annotation, so the cache never serves a child query from the parent's entry.

### 9. Prepared reads

A prepared read is a single plan (`relational-core/src/plan.ts`, `Preparable`). Preparing a read with includes under the per-relation strategy fails with `ORM.CAPABILITY_MISSING`, naming the two capabilities. Prepared reads without includes are unchanged.

## What the design accepts

- **Streaming.** Reads with includes already read every row before returning any (`collection-dispatch.ts`, `consumeIncludeRows`). The per-relation strategy does the same: it holds the parents and every level of children in memory until the read completes. Reads without includes still stream. Streaming with includes in batches, a parent query per page of identities followed by that page's children, can be added later without changing this design.
- **Consistency.** The queries of one read run one after another, on the caller's connection or transaction. At READ COMMITTED, which MariaDB and MySQL sessions use, each statement sees the latest committed data. A row committed between two queries can therefore appear in a later level: a child added to a parent already read is returned, and a child whose parent was deleted in between finds no parent and is dropped. ActiveRecord, Django and Prisma 7 load relations with the same behaviour.

## Requirements met

| Requirement | Met by |
| --- | --- |
| R1 every form, same result | Section 3's table; tests run the existing include suite under both strategies |
| R2 no silent short result | `jsonAggWithoutTruncation` gates the one-query include; the per-relation strategy aggregates no JSON |
| R3 reads and writes | Section 2 (one selector), section 6 |
| R4 runnable, bounded queries | Uncorrelated derived tables (section 3); chunking (section 5) |
| R5 keys | Filtering on the parent's identity (section 3); `stitchKey` (section 4) |
| R6 cache, budgets, lints | Sections 7 and 8 |
| R7 no target names | Section 1, section 2 |
| R8 no framework change | Changes are in the SQL family, the ORM client and the adapters |

## What changes where

- **`sql-orm-client`:** `selectIncludeStrategy`; the per-relation query builder; stitching and `stitchKey`; chunking; the per-relation hash input; setting `secondarySelectAnnotation`; the `Preload` node; the prepared-read refusal.
- **SQL family:** `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` in the capability reference; `sql.jsonAgg` removed; `secondarySelectAnnotation` in the SQL runtime; `budgets` and `lints` honour it.
- **Adapters:** Postgres, SQLite and MySQL report both capabilities and stop reporting `jsonAgg`; MariaDB sets both to `false`. Emitted contracts and fixtures are regenerated.
- **Docs:** ADR 164's strategy table; the capability reference.
- **No change:** the framework domain; the SQL AST (`WindowFuncExpr` already exists).
- **Size:** about 2 200–2 900 lines, including tests.

**Tests.** The existing Postgres include tests run a second time with both capabilities switched off through the adapter descriptor, whose capabilities override the contract's; that covers the per-relation strategy in CI without MariaDB. MySQL's ORM live tests run against MariaDB. New tests cover: the identity check; `stitchKey` for each key type; chunk boundaries by count and by size; a parent with no children for each scalar aggregate; the cache key differing by include; `secondarySelectAnnotation` on child plans and the middleware skipping them; the prepared-read refusal; and writes with includes.

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

## Alternatives considered

- **A one-query include rewritten for MariaDB, checked for a short result.** The correlation moves into the subquery's own `WHERE`, which MariaDB runs, and each array is checked against `COUNT(*)`, raising an error through a deliberate arithmetic overflow when they differ. Rejected: the aggregate is built twice per nesting level (two levels went from 0.86 s to 2.43 s), the error is recognised by matching message text, and `distinct`, paged scalar includes and `combine` cannot be written this way. No other tool does it.
- **Drizzle's mode for databases without lateral joins.** It still puts the correlation inside a derived table when a relation is ordered or paged, which MariaDB rejects, and it does not enforce the order of related rows.
- **Restoring the multi-query code the ORM client removed in commit `70482700f2`.** It read every child row and cut pages in JavaScript, computed aggregates in JavaScript, and matched rows on the foreign key, which the collation evidence shows is wrong.
- **One query joining parents and children, de-duplicated in JavaScript** (ActiveRecord's `eager_load`). Paging per parent and several to-many relations multiply the rows returned.
- **Redefining `sql.jsonAgg` as `jsonAggWithoutTruncation`.** Its documented meaning is "aggregate to JSON at the engine", which MariaDB can do, and core capabilities are not redefined.
- **Copying the call's annotations onto child queries.** The cache would serve a child query from the parent's cache entry.
- **Running the queries of a read on one pinned connection or in a transaction.** At READ COMMITTED each statement still sees the latest committed data, so it changes nothing.

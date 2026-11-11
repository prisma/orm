# Multi-query includes for MariaDB: research

Scratch files: `wip/multiquery/` (old removed code, probe SQL, Rails `batches.rb`). The probe container `mq-research-mariadb` was removed.

## 1. Streaming today

- The driver can stream. With `stream: true`, the MySQL driver reads rows with `client.queryStream()` as they arrive (`packages/3-targets/mysql/1-mysql/3-driver/src/core/runtime/mysql-driver.ts:59-69`, `:180-250`). Without it, the driver reads the whole result first (`:185-191`). The MariaDB driver is the MySQL driver with a different target id (`packages/3-targets/mysql/2-mariadb/3-driver/src/core/runtime/runtime-driver.ts`).
- The runtime passes the stream through. It decodes and yields one row at a time (`packages/2-sql-family/5-runtime/src/sql-runtime.ts:880-920`).
- The ORM streams reads without includes. `all()` returns `streamOrmCall(...)` over `query.rows` (`packages/3-extensions/sql-orm-client/src/collection.ts:1630-1635`, `orm-call.ts:147-155`). Without includes, rows are mapped one by one (`collection-dispatch.ts:92-124`).
- **Reads with includes do not stream today.** The include consumer calls `await rows.toArray()` on all parents, decodes every include, then yields (`collection-dispatch.ts:423-472`; the prepared path does the same at `:170-181`). So the correlated single query already buffers the whole result once includes are present.
- Driver constraint: on a held connection or transaction, a statement sent while a stream on that connection is open waits for the stream to end. One awaited inside the stream's loop never finishes (`mysql-driver.ts:307`, facade docs `packages/3-targets/mysql/1-mysql/9-facade/src/runtime/mysql.ts:185`).

## 2. Streaming with multi-query

- The removed code buffered everything: parents with `.toArray()`, then each relation's children with `.toArray()`, then yielded (`git show 70482700f2^:packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, lines 173-231, 361-424; copy at `wip/multiquery/old-collection-dispatch.ts`).
- Since includes do not stream today either, "buffer everything" is no regression from current behaviour.
- Streaming in batches (N parents, then their children, then yield N) is possible later. It needs the parent query read to its end before child queries run on the same connection, because of the driver constraint above. So each batch must be its own parent query (keyset pagination on the primary key), not a slice of one open stream. Rails does exactly that.
- Rails: `find_each`/`find_in_batches` default to 1000 rows per batch, force order by primary key, and load each batch as a relation built from `self`, so `includes`/`preload` run once per batch (`rails/rails activerecord/lib/active_record/relation/batches.rb:87`, `:163`, `:440`; scoped order is ignored).
- Django: `iterator()` runs `prefetch_related` only when `chunk_size` is given, one prefetch per chunk. The docs warn that `chunk_size` must keep each prefetch's `IN` list under database limits. Supported since 4.1; omitting `chunk_size` with prefetching was deprecated in 4.1 and is an error in 5.0.
- Prisma 7 has no streaming read API. `findMany` returns an array, and the query interpreter joins children to parents after loading both in full (`bot/7.9.x:packages/client-engine-runtime/src/interpreter/query-interpreter.ts:236-250`, `:434-478`).

## 3. Prisma history of one query per relation

- Prisma 7's default `relationLoadStrategy` is still `"query"`, one query per relation, stitched in TypeScript (issue #30761).
- Bind-parameter limits: Postgres 32767 (#8832, #21648 still open, #26726), MySQL prepared statements 65535 (#15529, #21912), SQLite 999 and D1 (#27545, #24545), SQL Server 2100 (#18203, #28385). Prisma 7 chunks `IN` lists by `maxBindValues` or a provider default: Postgres 32766, MySQL 65535, SQLite 999, SQL Server 2098 (`query-interpreter.ts:338-366`).
- Chunking is turned off when the child query has `orderBy`, a cursor, or unbatchable filters (`prisma-engines query-compiler/query-builders/query-builder/src/lib.rs:367-378`). So a nested `orderBy` sends one huge statement, and #28385 hits the 2100-parameter limit with 22k parameters.
- `QUERY_BATCH_SIZE` was the user workaround for the Rust engine. Users reported that fixed sizes still failed (#21648).
- MariaDB wrong results: with 1000 or more `IN` items, MariaDB rewrites the list into a subquery (`in_predicate_conversion_threshold`), and some versions then returned empty nested relations with no error (#12338, #14539, MDEV-28064). The prepared-statement path was affected. Our driver substitutes values client-side, and my probe with 10k and 100k keys on 10.11 returned correct results.
- Per-parent pagination in memory: Prisma 7 fetches all children and applies skip/take/cursor/distinct per parent in JS (`bot/7.9.x:.../in-memory-processing.ts:20-110`).
- Why `relationJoins` exists: database-level joins were among the most requested features; one round trip instead of one per relation; no merging in application memory (blog post). MariaDB was never supported, because it has neither LATERAL nor the correlated form Prisma uses (#23346, open).
- Other costs: empty child queries still run (`IN (NULL)`) for every level when no parent has a key (#30761). Unexpectedly high row reads (#10993).

## 4. Consequences of JS stitching (and what the removed code did)

| Topic | Consequence | Removed code |
|---|---|---|
| Memory | All parents and all children of a level are held at once; each nesting level adds its rows. | Same, `.toArray()` everywhere. |
| `IN` list size | Must be chunked; see section 5. | One unchunked `IN` list (`compileRelationSelect`, removed from `query-plan-select.ts`). |
| Key equality | A JS `Map` compares by `===` (SameValueZero). bigint vs number never match; `Date` and `Uint8Array` keys compare by identity and never match; decimals as text differ by formatting. Prisma 7 serialises the key tuple with `JSON.stringify` after casting each column to the parent's JS type (`query-interpreter.ts:480-512`, `in-memory-processing.ts:114-119`). | `Map<unknown, ...>` keyed by the raw decoded value. Correct only for number and string. |
| Composite keys | Today's `IncludeExpr` has `localColumns`/`targetColumns` arrays (`types.ts:94-98`). Needs a tuple key and a row-value `IN` or OR of ANDs. | Single `localColumn` only. |
| Collation | Under `utf8mb4_unicode_ci`/`general_ci`, `'Red'`, `'red'` and `'RED '` (trailing space, PAD SPACE) all match in SQL (probe). In JS they differ, so children are silently dropped. The contract has no column collation, so JS cannot imitate it. A fix is to have SQL return the parent's own key: join the child to the parent table and select the parent key column, then stitch on that exact value. | Not handled. |
| NULL foreign keys | Parents with NULL keys get the empty result without a query. Children with NULL foreign keys never match. | Filtered only `undefined` (line 238), so NULL went into the `IN` list. That matched nothing and was harmless. |
| Duplicate parent keys | De-duplicate the `IN` list; attach the same child list to every parent with that key (shared object, or a copy). | `new Set` de-dupe; shared arrays. |
| To-one vs to-many | To-one takes the first child or `null`; to-many takes the list. | `coerceIncludeResult`. |
| Order per parent | `ORDER BY` in the child query is kept within each bucket by stable insertion. Without a user order, order is not defined (true today too). | Child query carried the include's `orderBy`. |
| take/skip per parent | `ROW_NUMBER() OVER (PARTITION BY fk ORDER BY ...)` in SQL; needs a unique tiebreaker. The ORM already emits `WindowFuncExpr.rowNumber` for `distinctOn` (`query-plan-source.ts:188`, `:232`). | Fetched all children, then sliced in JS (`slicePerParent`). |
| Nested includes | Each level is one more query (or one per chunk) and repeats key handling. Join columns not selected by the user must be added and hidden. | Recursive `stitchIncludes`; added and stripped hidden join columns. |
| `combine()` | One query per branch. | Same. |
| Scalar includes (`count`, `sum`, ...) | Should be `GROUP BY fk` in SQL. Fetching rows to count them is costly; JS `sum`/`avg` over numbers loses decimal and bigint precision. | Fetched all rows and computed in JS through `Number(...)`. |
| `distinct()` | Must be applied per parent: partition by fk plus the distinct columns. | Not applied per parent. |
| Many-to-many | Join through the junction and return the junction's parent key. | Not supported then. |
| Polymorphic (MTI) children, namespaces, `locking` | Must carry over to the child query; `FOR UPDATE` then locks in separate statements. | Did not exist then. |
| Consistency | Each autocommit statement takes its own snapshot, so children can disagree with parents (a parent loaded with no children, or children of a parent not loaded). | Held one connection (`acquireRuntimeScope`), no transaction. |
| Prepared reads | `Preparable` is one plan plus `consume` (`packages/2-sql-family/4-lanes/relational-core/src/plan.ts:24-27`). A multi-statement read does not fit. | Not applicable then. |

Transactions: the runtime can group statements. The ORM already does it for writes with `withMutationScope`: it uses `runtime.transaction()`, otherwise `connection().transaction()`, otherwise runs on the given scope, so it works inside a user transaction (`packages/3-extensions/sql-orm-client/src/mutation-executor.ts:254-280`). A multi-query read can use the same helper to get one snapshot (InnoDB REPEATABLE READ).

## 5. Driver specifics and probe results (MariaDB 10.11.19)

- The driver writes values into the statement text (`mysql-driver.ts:52-56`, `namedPlaceholders: false` in `connection-options.ts:60`). There is no bind-parameter limit. The limit is `max_allowed_packet`: 16 MiB on MariaDB 10.11 (probed: 16777216); MySQL 8 defaults to 64 MiB.
- Over the limit the statement fails with `ERROR 2006 Server has gone away` (probe: 450k 36-character string keys, 17.5 MB). The connection is lost, so the driver must avoid it rather than catch it.
- Size per key: about 11 bytes for an integer key, about 39 for a quoted UUID string. 100k integer keys made a 1.3 MB statement.
- Timing (1M children, 200k parents, index on fk, times include about 0.15 s of `docker exec`): 1k keys 0.17 s, 10k keys 0.25 s, 100k keys 0.63 s, for both `COUNT` and the `ROW_NUMBER` take-2 query. Fetching 500k child rows for 100k keys: 0.48 s. MariaDB turns lists of 1000 or more into a materialised value table and does index lookups (`EXPLAIN`: `<subquery2>` then `ref` on the fk index).
- Practical chunking: chunk by encoded statement size, not by count. A fixed 10k-key chunk stays far under 16 MiB for any normal key (10k × 39 bytes = 390 KB). Chunks must split by parent key, so per-parent `ROW_NUMBER` pagination stays correct within a chunk; then concatenate bucket maps.
- `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, id)` with `rn > skip AND rn <= skip + take` gives correct per-parent pages (probe). Without the `id` tiebreaker, rows with equal `score` came back in either order (11 before 10). The ORM must add the primary key as a final sort column.
- Case-insensitive mismatch confirmed: `WHERE tag_name IN ('Red')` returned `'red'`, `'RED '` and `'Red'`.
- The failing form confirmed: a derived table inside a correlated subquery that references the outer row fails with `ERROR 1054 Unknown column 'u.id' in 'WHERE'`.
- Side finding: `JSON_ARRAYAGG(JSON_OBJECT(...) ORDER BY p.score DESC, p.id LIMIT 1, 2)` in a plain correlated subquery works on MariaDB 10.11 and gives correct per-parent take/skip with no derived table. Row includes with `take`/`skip`/`orderBy` may therefore not need the derived table on MariaDB. Scalar includes with a limit, and `distinct`, would still need one. Worth checking before committing to multi-query.

## 6. Size of restoring the multi-query path

- Removed code: about 600 lines of dispatch and stitching plus about 280 lines of unit tests and 90 lines of integration tests (`git show --stat 70482700f2`). It no longer fits the current code (namespaces, composite keys, many-to-many, polymorphism, async codecs, orm-call activities, prepared reads), so it is a rewrite with that code as a guide.
- Estimate: 1200 to 1800 lines of source plus tests, mostly in `packages/3-extensions/sql-orm-client` (`collection-dispatch.ts`, `query-plan-select.ts`, a new stitcher, include-strategy selection).
- Shared packages touched:
  - The MariaDB and MySQL adapter capabilities (`packages/3-targets/mysql/2-mariadb/2-adapter/src/core/capabilities.ts`, the MySQL adapter) for the new capability flag; Postgres and SQLite declare it too.
  - `packages/2-sql-family/4-lanes/relational-core` if prepared reads with includes must work on MariaDB, because `Preparable` is one plan. Otherwise prepared reads with includes refuse on such targets.
  - No runtime change is needed for transactions (reuse `withMutationScope`). No new AST node: `WindowFuncExpr.rowNumber`, `BinaryExpr.in` and `ListExpression` exist.
- Tests: the include integration tests would need to run on MariaDB, plus unit tests for key equality, chunking and per-parent pagination.

## Sources

- Removed code: commit `70482700f2` (`git show 70482700f2^:packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, `include-strategy.ts`)
- Prisma 7 runtime: branch `bot/7.9.x`, `packages/client-engine-runtime/src/interpreter/query-interpreter.ts`, `in-memory-processing.ts`, `render-query.ts`
- prisma-engines chunkable rule: https://github.com/prisma/prisma-engines/blob/main/query-compiler/query-builders/query-builder/src/lib.rs
- Prisma issues: https://github.com/prisma/prisma/issues/8832, /21648, /26726, /15529, /21912, /27545, /24545, /18203, /28385, /12338, /14539, /10993, /23346, /30761, /25645
- Prisma blog, join strategy: https://www.prisma.io/blog/prisma-orm-now-lets-you-choose-the-best-join-strategy-preview
- MariaDB big IN conversion: https://mariadb.com/kb/en/conversion-of-big-in-predicates-into-subqueries/ ; MDEV-28064: https://jira.mariadb.org/browse/MDEV-28064
- Rails batches: https://github.com/rails/rails/blob/main/activerecord/lib/active_record/relation/batches.rb ; https://api.rubyonrails.org/classes/ActiveRecord/Batches.html
- Django `iterator()` and `prefetch_related`: https://docs.djangoproject.com/en/5.2/ref/models/querysets/#iterator ; Django 4.1 release notes: https://docs.djangoproject.com/en/5.2/releases/4.1/

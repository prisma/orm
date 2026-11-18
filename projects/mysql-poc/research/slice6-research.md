# Slice 6 research: a `mariadb` target that extends MySQL

Date: 2026-11-06. Server: `mariadb:10.11` (10.11.19) in Docker on port 3366. Logs and probe scripts: `wip/slice6/`. Paths are relative to the worktree root. MySQL package paths are relative to `packages/3-targets/mysql/`.

How I probed: I ran each MySQL live test file against MariaDB with no changes. Then I patched the built `dist` files by hand (not the source) to imitate the overrides a MariaDB target would make: `tx_isolation`, no `EXPRESSION` column, and `VALUES()` upserts. Then I ran the files again to see what fails next. I restored `dist` afterwards from a clean rebuild. The git tree is clean.

## Headline

- **No change is needed in `packages/1-framework` or `packages/2-sql-family`** for anything the example and the MySQL tests use. Every difference can be handled inside a MariaDB target and adapter.
- **The MySQL packages must open up for subclassing.** The SQL renderer is about 50 private module functions. The runtime adapter class, the runner, the verifier and the control-target factory are not exported. The value `'mysql'` is written into about 25 type arguments and in several class fields. That refactor is the largest single cost of the slice.
- **One issue was not in the design notes and blocks everything at runtime:** the MySQL target's session settings set `transaction_isolation`. MariaDB 10.11 does not know that variable (it was added in MariaDB 11.1), so every runtime connection fails. MariaDB needs `tx_isolation`. The setting lives in the target's descriptor (`1-target/src/core/descriptor-meta-runtime.ts:12`), so it is a plain target override.
- **ORM writes already work on MariaDB through the slice 4 fallback** (`returning` off), once upsert uses `VALUES()`. Includes are the only part of the ORM that fails.

## 1. Include loading

**What MySQL renders today** (taken from the MariaDB general log while `orm-includes.live.test.ts` ran; full text in `wip/slice6/include-sql.txt`):

```sql
SELECT /*+ SET_VAR(group_concat_max_len = 4294967295) */ `User`.`id` AS `id`,
  (SELECT CASE WHEN COUNT(*) = 0 THEN JSON_ARRAY() ELSE CAST(COALESCE(CONCAT('[', GROUP_CONCAT(JSON_OBJECT('title', `posts__rows`.`title`) ORDER BY `posts__rows`.`posts__order_0` DESC SEPARATOR ','), ']'), CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')) AS JSON) END AS `posts`
   FROM (SELECT `Post`.`title` AS `title`, `Post`.`title` AS `posts__order_0` FROM `Post` WHERE `Post`.`authorId` = `User`.`id` ORDER BY `Post`.`title` DESC) AS `posts__rows`) AS `posts`
FROM `User` WHERE `User`.`id` = 1 LIMIT 1
```

A to-one include has the same shape, using `COALESCE(JSON_ARRAYAGG(...), JSON_ARRAY())` over the derived table.

**What fails on MariaDB 10.11.** All 11 tests in `orm-includes.live.test.ts` fail, for three reasons:

1. `Unknown column 'Post.authorId' in 'WHERE'`. The derived table refers to the outer row, and MariaDB cannot resolve that reference. This hits every include, ordered or not.
2. A syntax error near `JSON) END`. MariaDB has no `CAST(... AS JSON)`. This hits every ordered include.
3. MariaDB reads `/*+ SET_VAR(...) */` as a plain comment and ignores it. `SET STATEMENT group_concat_max_len = N FOR SELECT ...` works instead.

**A shape that works.** Put the correlation in the subquery's own `WHERE`, and the ordering and paging inside the aggregate. I verified it on 10.11 with two levels of nesting, `ORDER BY ... DESC`, and `LIMIT 1, 2` on the outer level and `LIMIT 2` on the inner level. The results were correct.

```sql
SELECT u.id,
  (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('title', p.title,
      'comments', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('body', c.body) ORDER BY c.body DESC LIMIT 2), JSON_ARRAY())
                   FROM Comment c WHERE c.postId = p.id))
    ORDER BY p.title DESC LIMIT 1, 2), JSON_ARRAY())
   FROM Post p WHERE p.authorId = u.id) AS posts
FROM User u
```

Other facts I checked:

- `LIMIT n OFFSET m` and `LIMIT m, n` both work inside `JSON_ARRAYAGG`.
- A JSON column, a nested aggregate, a nested `JSON_OBJECT` and a `COALESCE(JSON_ARRAYAGG(...), JSON_ARRAY())` all stay JSON when nested, so they are not quoted as strings.
- An empty aggregate returns `NULL`, so the `COALESCE(..., JSON_ARRAY())` is needed.
- **Risk: MariaDB silently truncates results.** `JSON_ARRAYAGG` is cut at `group_concat_max_len` (default 1 MB) with only warning 1260. `SET STATEMENT` cannot raise the limit past `max_allowed_packet`. Truncation can leave text that is still valid JSON but has fewer elements: with a limit of 2500 bytes and 5 rows, `JSON_LENGTH` returned 3. The MySQL renderer already treats the same risk for `GROUP_CONCAT` with a deliberate cast failure. MariaDB needs its own guard, for example `CASE WHEN JSON_LENGTH(agg) = <expected count> THEN agg ELSE <text that is not JSON> END`, where the expected count accounts for any `LIMIT`/`OFFSET`. Then the MySQL tests "longer than group_concat_max_len" and "larger than a packet" can pass. MariaDB has no `CAST AS JSON` that would fail on invalid text, so the guard needs another way to raise an error. One option is `JSON_EXTRACT` on text that is not JSON, which returns NULL with a warning; that is not enough. **This is not solved yet.** Settle it while building the slice.

**Where the shape is decided.** The ORM builds it in shared code: `packages/3-extensions/sql-orm-client/src/query-plan-select.ts`. `buildIncludeChildRowsSelect` (:512) puts the correlation, `ORDER BY`, `LIMIT` and `OFFSET` on the child select (:672-677). `buildIncludeChildRowsAggregateSelect` (:1215-1245) wraps that select in a `DerivedTableSource` and puts a `JsonArrayAggExpr` with the order over it.

**Can the MariaDB adapter fix this by overriding rendering only?** Yes, for the shapes the MySQL tests and the example use, and with no shared change. The AST the renderer receives holds everything it needs: a `SelectAst` whose only source is a `DerivedTableSource`, whose only projection is a `JsonArrayAggExpr` over columns of that alias, and whose inner select carries the source table, joins, `WHERE`, `ORDER BY`, `LIMIT` and `OFFSET`. The MariaDB renderer can flatten that form:

1. Replace each `rows.alias` reference with the inner projection's expression.
2. Move the inner `FROM`, joins and `WHERE` up into the subquery.
3. Render `JSON_ARRAYAGG(obj ORDER BY ... LIMIT offset, limit)`.

The hidden `__order_N` columns map back to the inner order expressions.

The forms it cannot flatten this way, because they put a correlated derived table inside another derived table:

- `distinct()` on an include, which wraps the rows in `ROW_NUMBER` (`wrapWithRowNumberDedup`).
- `distinct()` on an include that has its own includes (`buildDistinctNonLeafChildRowsSelect`, :688).
- A scalar include (count, sum) with `take`/`skip` (`buildIncludeChildScalarSelect`, :907, `hasPagination` at :962).
- `combine()` (`buildIncludeChildCombineSelect`, :1111, which joins derived tables).

None of these is in the example or in the MySQL include tests. In this slice, the MariaDB renderer should refuse them with `RUNTIME.AST_UNSUPPORTED`, and they should be filed. Fixing them later inside the renderer needs harder rewrites; fixing them in shared code would mean choosing the include shape from a capability.

**What MySQL must open up.** `renderMysqlSql` is at `2-adapter/src/core/sql-renderer.ts:86`. `renderJsonArrayAgg` (:612-626), `renderInsert` (:160-200), `renderColumn` (:396-404) and `withGroupConcatHint` (:110-118) are private module functions. One of these is needed:

- turn the renderer into an exported class with protected methods for the statement, the select, the insert, the column and the aggregate; or
- give it a dialect object of hooks.

This is a change inside the MySQL package only.

## 2. Upsert

- MariaDB 10.11 rejects `INSERT ... VALUES (...) AS \`new\` ON DUPLICATE KEY UPDATE email = \`new\`.email` with error 1064 (probed).
- It accepts `ON DUPLICATE KEY UPDATE email = VALUES(email)`, and `ROW_COUNT()` is 2 on update, as on MySQL.
- `INSERT ... ON DUPLICATE KEY UPDATE ... RETURNING` also works.

Where MySQL renders this:

- **ORM upsert:** `2-adapter/src/core/sql-renderer.ts:198` (`AS new ON DUPLICATE KEY UPDATE`). The `excluded` reference becomes `new.c` at :401.
- **Control plane:** the marker upsert in `2-adapter/src/core/migrations/marker-ledger.ts:90` uses `AS incoming ... incoming.core_hash`. It fails on MariaDB, so `db sign` and every migration that writes a marker fail. The MySQL control-adapter live test "writes markers and ledger entries" shows this.

How to override:

- **Renderer:** two protected hooks. One renders the proposed-row clause (empty for MariaDB). One renders a reference to a proposed column (`VALUES(col)` for MariaDB).
- **Marker:** move the statement to a method or constant that the MariaDB control adapter can replace.

With both changes patched into `dist`, the ORM upsert tests and the marker tests pass on MariaDB.

## 3. Control plane (planner, runner, `db verify`, introspection)

The DDL that the MySQL planner writes for the example contract runs on MariaDB unchanged: `int`, `varchar(191)`, `enum(...)`, `datetime(3) DEFAULT (CURRENT_TIMESTAMP(3))`, `date`, `time(6)`, the unique constraint, the index and the foreign key. What fails is reading the database back.

| Difference on MariaDB 10.11 | Probe result | MySQL code to override |
| --- | --- | --- |
| `information_schema.STATISTICS` has no `EXPRESSION` column (MariaDB has no functional indexes) | Introspection fails with `Unknown column 'EXPRESSION'` (all 7 tests in `introspection.live.test.ts`) | `2-adapter/src/core/migrations/introspection-queries.ts:23-28` (`INDEXES`); `readMysqlCatalog` |
| Integer display widths: `int(11)`, `bigint(20)`, `tinyint(1)` | `db verify`: "The database column is "int(11)", which no data type in the configured stack declares". The planner then wants to change every id column | Catalog texts in `1-target/src/core/data-types.ts:77-91` (`texts: [{ text: 'int', catalog: true }]`). MariaDB needs data types that also accept `int(11)` and `bigint(20)` from the catalog. Data types are the target's (`dataTypes` in the descriptor meta), so MariaDB can supply its own list |
| No `DEFAULT_GENERATED` in `EXTRA`; functions are written in lower case: `current_timestamp(3)`, `current_timestamp()`, `curdate()`, `curtime(6)` | The example's `Event.createdAt` fails verification: "mysql/datetime@1 cannot read the default the database reports, current_timestamp(3)" | `readMysqlDefault`, `1-target/src/core/default-normalizer.ts:91-108` (relies on the `default_generated` flag at :99) |
| Literal defaults are quoted in `COLUMN_DEFAULT` (`'hi'`, `'it''s'`, and `'it\'s a \\ b'` for an expression default) | "reads a literal default on a text column" gets `'it\'s a \\ b'` instead of `it's a \ b` | Same function: MariaDB needs a parser for quoted literals |
| `COLUMN_DEFAULT` is the text `NULL` (not SQL NULL) for a nullable column with no default | `COLUMN_DEFAULT IS NULL` is 0 for `c CHAR(3)` | Same function: MySQL would read it as the literal `NULL` |
| `JSON` is `longtext` with a `CHECK (json_valid(col))` constraint named after the column; collation `utf8mb4_bin` | The catalog shows `longtext`. `TABLE_CONSTRAINTS` lists a `CHECK` row | MySQL has **no JSON data type yet** (`data-types.ts:330-343`), so nothing breaks today. When JSON is added, MariaDB needs its own data type that reads `longtext` plus the check |
| Boolean is `tinyint(1)` | Probed | MySQL has no boolean data type yet; same note as JSON |
| `datetime(3)`, `time(6)`, `date`, `enum('USER','ADMIN')`, `varchar(191)` | Reported identically to MySQL | No change |
| A CHECK violation reports SQLSTATE `23000`, not `23514` | Driver live test | Error mapping: check whether `normalize-error.ts` maps by SQLSTATE or by error number |
| `transaction_isolation` is unknown | Fails every connection that applies the target's session settings, including the control adapter's | `1-target/src/core/descriptor-meta-runtime.ts:12`: MariaDB sets `tx_isolation: 'READ-COMMITTED'` (probed: accepted) |

Result of the probe on the example contract (plan, apply, verify, plan again): the only verification issues are four `int(11)` columns and the `current_timestamp(3)` default. The second plan then reports "Changing a column's type is not yet supported" for those columns. In `migrate.live.test.ts`, every apply fails at the runner's verify step with "Database schema does not satisfy contract (3 failures)", for the same reasons.

## 4. RETURNING

- MariaDB has `INSERT ... RETURNING` (also with `ON DUPLICATE KEY UPDATE`) and `DELETE ... RETURNING`. `UPDATE ... RETURNING` is a syntax error on 10.11. All probed.
- **With `returning` off, as MySQL reports it, writes work on MariaDB.** With the session and upsert overrides patched in, `orm-writes.live.test.ts` passes 13 of 15 tests.
  - One failure is an include (section 1).
  - The other is a test that compares the exact SQL with `AS new`, which a MariaDB copy of the test would replace.
- So `insertId`, `foundRows`, READ COMMITTED (through `tx_isolation`), `NO_AUTO_VALUE_ON_ZERO` and the `sql_mode` rewrite all work on 10.11. I checked `sql_mode` on the server: the driver's rewrite gives `NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES,...`.
- **Size of splitting `returning` by statement kind.** These places read the `returning` capability:
  - `sql-orm-client`: `collection-contract.ts:941`, `mutation-executor.ts:138, 168, 464, 1304`, `mutation-graph/collection-graphs.ts:341, 394, 438` and `written-keys.ts:42`.
  - The SQL builder's typed `ReturningCapability` (`sql-builder/src/types/mutation-query.ts:12`) and its 3 runtime checks (`mutation-impl.ts:211, 358, 478`).
  - The capability lists of the Postgres and SQLite adapters, and tests.
  - Estimate: 400–700 lines, all in shared code (the ORM extension and the SQL family). It adds capability names, so `returning` must keep its meaning for every statement kind if the change is to stay additive.
  - **Recommendation:** MariaDB reports `returning: false` in this slice and the split is filed. The fallback is proven, so the split brings speed, not correctness.

## 5. Driver

The MySQL runtime and control drivers (`3-driver`) work against MariaDB 10.11 unchanged:

- `statement-text.live.test.ts`: 1/1 pass.
- `runtime-driver.live.test.ts`: 56/60 pass.
- `control-driver.live.test.ts`: 19/21 pass.
- Session setup (`sql_mode` rewrite, `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`) is accepted. MariaDB's default `session_track_system_variables` includes `character_set_client`, so the character set check works.

The failures are server facts that the tests assert, not driver bugs:

- The tests create a user `IDENTIFIED WITH caching_sha2_password`, which MariaDB lacks (2 tests, one in each driver file).
- The TLS test needs a server that has TLS enabled; this container has it off. The same applies to `test/utils/test/mysql-database.test.ts`.
- MariaDB returns `0` where MySQL returns `-0` for negative zero in FLOAT, DOUBLE and computed DECIMAL columns (2 tests).
- A CHECK violation has SQLSTATE `23000` where MySQL has `23514` (1 test).

**MariaDB does not need its own driver package.** It does need driver descriptors whose `targetId` is `'mariadb'`:

- The config loader rejects a component whose `targetId` differs from the target's (`packages/1-framework/3-tooling/config-loader/src/orm-section.ts:146`; `cli/src/utils/framework-components.ts:101`).
- The MySQL driver writes `'mysql'` into `3-driver/src/core/descriptor-meta.ts:4-5`, into `MysqlControlDriver.targetId` (`control-driver.ts:22`) and into `MysqlDriver.targetId` (`runtime/mysql-driver.ts:542`).

So the MySQL driver should take the target id as a parameter, and the MariaDB adapter or facade should build its descriptors from it. The facade's URL check (`9-facade/src/runtime/binding.ts:24`) accepts only `mysql://`. Decide whether `mariadb()` takes `mariadb://`, `mysql://` or both.

## 6. Subclassing shape

A subagent mapped this; I checked the main points.

| Piece | Today | Change needed in MySQL so MariaDB can extend it |
| --- | --- | --- |
| Target descriptor meta (`1-target/src/core/descriptor-meta.ts`, `descriptor-meta-runtime.ts`) | Plain objects, exported as the pack's default | None; spread and override `targetId`, `id`, `displayName`, `dataTypes`, `sessionSettings` |
| Control target descriptor (`1-target/src/core/migrations/control-target.ts:27`) | Factory not exported; writes `targetId: 'mysql'` in `create()` (:60) | Export the factory, with the target id and the parts as parameters |
| Runtime target descriptor (`1-target/src/core/runtime/runtime-target.ts:7-16`) | Object with `targetId: 'mysql'` | Spread |
| Data types (`data-types.ts`) | `sqlDataType('mysql/…')` objects, exported | MariaDB lists its own, reusing most and replacing `int` and `bigint` (catalog widths). Decide whether the ids stay `mysql/…` or MariaDB forks them; reusing the ids keeps the codecs shared |
| Codec descriptor classes (`codecs.ts:110-342`) | Classes, not exported | Probably no override needed; export them if one is |
| Default reader (`default-normalizer.ts:91`) | Module function | Make it a parameter of the introspection and the verifier |
| Schema verifier (`migrations/mysql-schema-verifier.ts:8`) | Class with protected methods, not exported | Export |
| Planner (`migrations/planner.ts:101`) | Exported; core logic in private `#planSql` | Probably none; the DDL works on MariaDB |
| Runner (`migrations/runner.ts:97`) | Not exported; every step is private | Probably none if the marker SQL is overridden in the control adapter |
| Control adapter (`2-adapter/src/core/migrations/control-adapter.ts:55`) | Exported class; `targetId = 'mysql'` (:57); `introspect()` calls module functions (:206) | Make the target id, the catalog queries and the default reader parameters or protected methods; move the marker upsert onto a protected method |
| Runtime adapter (`2-adapter/src/core/runtime/mysql-adapter.ts:32`) | `MysqlAdapterImpl` and `createMysqlAdapter` not exported; profile id, target and capabilities written in (:39-42) | Export, with the renderer, the capabilities and the ids as parameters |
| SQL renderer (`2-adapter/src/core/sql-renderer.ts`) | About 50 private functions | Class or dialect hooks (sections 1 and 2) |
| Capabilities (`2-adapter/src/core/capabilities.ts:2-10`) | Object | Spread |
| Driver | `'mysql'` written in | Target id as a parameter (section 5) |
| Facade (`9-facade/src/runtime/mysql.ts:217`, `config/define-config.ts:34-58`) | `mysql()` and `defineConfig` import the MySQL target, adapter and driver directly. `MysqlRuntimeImpl` is exported for subclassing | Either a MariaDB copy of `mysql()` and `defineConfig` (about 500 lines, like the copy recorded in `deferred.md`), or a MySQL facade factory with the components as parameters (cheaper and better) |

**Types.** `'mysql'` appears as a type argument about 25 times across the MySQL sources (for example `SqlControlDriverInstance<'mysql'>` and `SqlControlAdapter<'mysql'>`). Each class that MariaDB subclasses needs a target-id type parameter that defaults to `'mysql'`.

The Adapters & Targets doc (`docs/architecture docs/subsystems/5. Adapters & Targets.md:148-174`) prescribes exactly this: spread the parent's descriptor meta, subclass only the interface that differs, override protected methods, and reuse the rest as it is. The runtime checks `contract.target === targetId`, so MariaDB needs its own id everywhere.

**Public packages (ADR 242).** Copy `packages/9-public/@prisma/orm-mysql` and `orm-target-mysql`. Then update:

- `ShellName` and the two map entries in `packages/0-shared/publish-surface/src/shells.ts`; MySQL's entries are at :629-650 and :756-769.
- `scripts/sync-package-skills.ts:31` and `turbo.json:67`.
- The publish-surface tests and the `orm-framework` shell tests.
- The root `fixtures:emit` filter and the lockfile.
- ADR 242's package count.

**Registration.** About 45 glob entries in `architecture.config.json:1204-1430`. There is no per-target layering test under `packages/3-targets/mysql/*/test`; layering is enforced by `architecture.config.json` and dependency-cruiser. The project spec says each target has one, so either the MySQL slice skipped it or the spec is stale. Check this at close-out.

## 7. Example and CI

- **"Test Examples"** (`.github/workflows/ci.yml` around :232-300) and **"Package Tests"** (around :164-230) each start a `mysql:8.4` service. Both set `MYSQL_URL=mysql://root:root@127.0.0.1:3306/mysql?allowPublicKeyRetrieval=true` (:174, :245). Test Examples runs `pnpm test:examples` (turbo `test` over `./examples/**`), then `check:clean-tree`.
- The Integration Tests job (:411) does not set `MYSQL_URL`, so the three MySQL integration files skip in CI.
- **There is no `mariadb:10.11` service** in the workflows or in `docker-compose.yaml`, which has only `mysql:8.4` at :10-22. Slice 2a planned one, and it was not added.
- **The example names its target in five places:**
  - the dependency on `@prisma/orm-mysql`;
  - `prisma.config.ts`, which imports `@prisma/orm-mysql/config`;
  - `contract.json`, which has `"target": "mysql"`, and so do the migration snapshots;
  - `migrations/*/migration.ts`, which imports the MySQL facade;
  - the test helpers.

  A switch through an environment variable would change emitted files and fail `emit:check` and `check:clean-tree`.

**Recommendation:** a second example, `examples/prisma-8-demo-mariadb`, that copies the MySQL one and depends on `@prisma/orm-mariadb`. Its contract and migrations are regenerated, not hand-written. CI needs a `mariadb:10.11` service on another port and a `MARIADB_URL` variable in Package Tests and Test Examples, plus a matching `docker-compose.yaml` service. `withMysqlDatabase` (`test/utils/src/mysql-database.ts:20`) reads only `MYSQL_URL`; it needs a parameter for the variable name. Then the MySQL live suites can run against both servers, and each test can state where the servers differ.

## 8. MySQL live tests on MariaDB

**A — unchanged code.** Where a file appears again under B, its count comes from the run with the overrides patched into `dist`, and the note says what blocked the unchanged run.

| File | Result | Failure reasons |
| --- | --- | --- |
| `3-driver/test/statement-text.live.test.ts` | 1/1 pass | — |
| `3-driver/test/runtime-driver.live.test.ts` | 56/60 | Server facts in tests: `caching_sha2_password` (1), negative zero (2), CHECK SQLSTATE (1) |
| `3-driver/test/control-driver.live.test.ts` | 19/21 | `caching_sha2_password` (1), TLS off in the container (1) |
| `2-adapter/test/control-adapter.live.test.ts` | 2/6 | `EXPRESSION` column (2), `transaction_isolation` (1), marker `AS incoming` upsert (1) |
| `9-facade/test/introspection.live.test.ts` | 0/7 | `EXPRESSION` column (7) |
| `9-facade/test/runtime/orm-reads.live.test.ts` | 0/10 | `transaction_isolation` (all) |
| `9-facade/test/runtime/*` (`orm-includes`, `orm-writes`, `raw-lane`), `migrate.live.test.ts` | Same as `orm-reads` | `transaction_isolation`, or `EXPRESSION` |
| `test/utils/test/mysql-database.test.ts` | 1 failure | TLS off in the container |
| `test/integration/.../mysql-journey.e2e.test.ts` | 2/4 | `transaction_isolation` (through the public bundles) |
| `test/integration/.../mysql-without-temporal.e2e.test.ts` | 0/2 | `transaction_isolation` |
| `examples/prisma-8-demo-mysql` (`pnpm test`) | 4 failed, 7 skipped | `db migrate` exits with code 2 (`transaction_isolation`); the rest skip |
| `test/integration/test/cli-journeys/migrations.mysql.e2e.test.ts` | Not run | It needs the journeys config, and it goes through the same public bundles, so it would fail on `transaction_isolation` |

**B — with the overrides patched into `dist`** (`tx_isolation`, `NULL AS expression`, `VALUES()` upserts in the ORM and the marker):

| File | Result | Failure reasons left |
| --- | --- | --- |
| `orm-reads.live.test.ts` | 9/10 | Include shape (1) |
| `orm-includes.live.test.ts` | 0/11 | Include shape: outer reference in a derived table, and `CAST AS JSON` |
| `orm-writes.live.test.ts` | 13/15 | Include (1); the exact-SQL assertion expects `AS new` (1) |
| `raw-lane.live.test.ts` | 4/4 | — |
| `introspection.live.test.ts` | 2/7 | `int(11)` (all 5); quoted literal default (1) |
| `migrate.live.test.ts` | 2/9 | The runner's verify fails on `int(11)` and `current_timestamp(3)` (7) |

## 9. Size and slice shape

Estimate of code that is not generated:

| Part | Lines |
| --- | --- |
| Opening up MySQL: renderer class or hooks, adapter, control adapter, introspection parameters, control-target factory, driver target id, type parameters | 700–1,000 changed |
| `mariadb/1-target`: descriptor meta, data types with widths, default reader for quoted literals, `NULL` and lower-case functions, control and runtime descriptors | 400–600 |
| `mariadb/2-adapter`: include flattening with a truncation guard, upsert hooks, marker upsert, introspection without `EXPRESSION`, capabilities, descriptors | 600–900 |
| `mariadb/9-facade`: with a shared MySQL facade factory | 150–250 (500+ if copied) |
| Public packages, `shells.ts`, publish tests, `architecture.config.json`, turbo, scripts | 400–500 |
| Tests: renderer goldens for MariaDB, unit tests for the default reader and data types, live suites run on both servers with the differences stated | 1,200–1,800 |
| Example copy (tests and config; contract and migrations are generated), CI, `docker-compose.yaml` | 300–400 |
| **Total** | **about 3,800–5,500** |

That is above the 3–4k target. **Recommended split**, following the MySQL slices:

- **6a — MariaDB control plane** (about 2.5k):
  - open up the MySQL target, control adapter, driver and facade config;
  - the `mariadb` target, adapter (control half) and config;
  - the public packages;
  - `mariadb:10.11` in CI and `docker-compose.yaml`;
  - the MySQL control live suites run against MariaDB;
  - `examples/prisma-8-demo-mariadb` emits, migrates, verifies and signs.
- **6b — MariaDB runtime** (about 2–2.5k):
  - the renderer class or hooks;
  - include flattening with the truncation guard;
  - the `VALUES()` upsert;
  - `tx_isolation`, though the session setting can land in 6a because the control adapter uses it too;
  - `mariadb()` in the facade;
  - the ORM live suites on MariaDB;
  - the example reads and writes.

File for later: the `returning` split by statement kind; include forms the flattening refuses (`distinct`, a paginated scalar include, `combine`); and `INSERT IGNORE … RETURNING` for `onConflict: 'skip'`.

## Shared-code changes

- **None required** in `packages/1-framework`, `packages/2-sql-family` or `sql-orm-client` for this slice.
- `test/utils` (test tooling) needs the URL variable as a parameter.
- Optional follow-up: a shared change would let `distinct` and `combine` includes run on MariaDB.

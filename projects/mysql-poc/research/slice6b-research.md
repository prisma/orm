# Slice 6b research: MariaDB runtime

Date: 2026-11-10. Branch `tml-3697-mariadb-target` (slice 6a, PR #30964). Servers: `mariadb:10.11` (10.11.19) on port 3380; `mariadb:11.4` for three cross-checks. Probe SQL and output: `wip/slice6b/q*.sql`, `wip/slice6b/*.out`, test logs `wip/slice6b/{A,B}-*.log`. Paths are relative to the worktree; MySQL paths relative to `packages/3-targets/mysql/`.

How I probed the ORM: I ran MySQL's ORM live test files against MariaDB (A: code unchanged). Then I patched the built `dist` of the MySQL target and adapter with a prototype of the design below (`wip/slice6b/patch-dist.mjs`: `tx_isolation`, include flattening with the truncation check, `VALUES()` upsert, `SET STATEMENT`) and ran them again (B). I restored `dist` afterwards (`wip/slice6b/restore-dist.sh`). The git tree is clean.

## Headline

- The design works end to end on 10.11. With the prototype, MySQL's ORM live files pass 38 of 40 tests on MariaDB. The two failures are expected: one asserts MySQL's error text, one asserts MySQL's exact upsert SQL.
- **Truncation has a working answer:** compare `JSON_LENGTH` of the aggregate with the row count the aggregate should hold, and raise an error otherwise. Raising `group_concat_max_len` alone cannot work: MariaDB also cuts at `max_allowed_packet`, silently.
- No change to `packages/1-framework`, `packages/2-sql-family` or `sql-orm-client`. Everything is in the MySQL and MariaDB packages.

## 1. Renderer extension shape

Today `renderMysqlSql` (`1-mysql/2-adapter/src/core/sql-renderer.ts:86`) and about 50 module functions; the runtime adapter calls it at `2-adapter/src/core/runtime/mysql-adapter.ts:57`. Postgres (`postgres/2-adapter/src/core/sql-renderer.ts:193`) and SQLite also use module functions; neither has a renderer extension point, so there is no renderer precedent.

What MariaDB must change:

| Change | Where in the MySQL renderer |
| --- | --- |
| Include subquery shape | `renderSubquery` (:436), `renderJsonArrayAgg` (:614), plus a column substitution in `renderColumn` (:397) |
| Upsert | the `AS new` clause (:198) and `excluded.c` (:401) |
| Statement hint | `withGroupConcatHint` (:111) |
| Error naming | `unsupported` (:79) and 24 messages that say "MySQL" |

**Dialect hooks** cover the upsert and the hint in three small functions. They do not cover includes: flattening needs `renderExpr`, `renderSource`, `renderJoin`, `renderOrderByItems`, `renderJsonValue`, the limit/offset renderer and a column substitution in the shared context. A hook would have to receive all of these, which is a class in disguise. Putting the flattening in MySQL behind a flag would put MariaDB-only code (MySQL has no `ORDER BY` inside `JSON_ARRAYAGG`) in the MySQL package.

**Recommendation: an exported class `MysqlSqlRenderer` with protected methods; MariaDB subclasses it.** It follows existing patterns: `SqlContractSerializerBase` with protected hydrate methods that `MysqlContractSerializer` overrides (`1-mysql/1-target/src/core/mysql-contract-serializer.ts:17`); `MysqlRuntimeImpl`, exported for subclassing (`1-mysql/9-facade/src/runtime/mysql-runtime.ts:14`); `MysqlMigrationBase` from 6a (`1-target/src/core/migrations/mysql-migration.ts:28`); and the subclass-and-override recipe in `docs/architecture docs/subsystems/5. Adapters & Targets.md:159`. The 6a architect review already named the renderer as the place for subclassing (`slices/mariadb-control/reviews/design-architect.md:30`). Methods MariaDB overrides: `renderSubquery`, `renderJsonArrayAgg`, `renderColumn` (proposed-row column), `renderUpsertClause`, `wrapStatement`, plus the target id and display name for errors. The conversion is mechanical (functions become methods, `ctx` stays a parameter); land it as its own commit so it reviews with whitespace ignored.

## 2. Include shape (re-verified)

Probed on 10.11 (`q1.out`, `q2.out`, `offset-only.out`): correlation in the subquery's own `WHERE`; `JSON_ARRAYAGG(obj ORDER BY … LIMIT n OFFSET m)` two levels deep; `DESC`; to-one (a one-element array, as the ORM builds it) and to-many; `LIMIT`/`OFFSET` as `?` parameters; offset without limit (`LIMIT 18446744073709551615 OFFSET 2` gives `[3,4,5]`); a join inside the include (many-to-many through a junction, polymorphism joins); `NULLS FIRST` written as `x IS NULL DESC, x`; JSON columns, NULLs and escaped text stay JSON when nested. Earlier research section 1 is correct.

**What replaces `CAST(… AS JSON)`:** nothing is needed for the array itself: MariaDB has no JSON type, and `JSON_ARRAYAGG` keeps its order natively. But a `CASE` or `IF` around a JSON value loses its JSON flag, so a nested include then arrives as a quoted string (`{"posts": "[1,2,3,5]"}`, `q8.out`). Wrapping the `CASE` in `JSON_EXTRACT(…, '$')` restores it (`{"posts": [1, 2, 3, 5]}`). The bigint-past-2^53 and datetime(3) include test passes through this wrapper.

**Produced from the AST:** yes. `buildIncludeChildRowsAggregateSelect` (`3-extensions/sql-orm-client/src/query-plan-select.ts:1215-1245`) builds `SELECT JsonArrayAggExpr FROM (child rows) AS rows`. The renderer recognises that form and renders the inner select's `FROM`, joins and `WHERE` directly, with `JSON_ARRAYAGG(obj ORDER BY … LIMIT …)`. Each `rows.alias` reference is replaced by the inner projection's expression through a substitution in the render context, so the AST is not rewritten. The prototype did this in about 30 lines. SQL it produced (general log, `wip/slice6b/include-sql.txt`):

```sql
SET STATEMENT group_concat_max_len = 1073741824 FOR SELECT `User`.`id` AS `id`, (SELECT JSON_EXTRACT(CASE WHEN JSON_LENGTH(COALESCE(JSON_ARRAYAGG(JSON_OBJECT('title', `Post`.`title`) ORDER BY `Post`.`title` ASC LIMIT 1 OFFSET 1), JSON_ARRAY())) = LEAST(GREATEST(COUNT(*) - 1, 0), 1) THEN COALESCE(JSON_ARRAYAGG(JSON_OBJECT('title', `Post`.`title`) ORDER BY `Post`.`title` ASC LIMIT 1 OFFSET 1), JSON_ARRAY()) ELSE 18446744073709551615 + COUNT(*) END, '$') FROM `Post` WHERE `Post`.`authorId` = `User`.`id`) AS `posts` FROM `User` WHERE `User`.`id` = 1 LIMIT 1
```

**Forms the renderer cannot flatten.** Each puts a correlated derived table inside another derived table, and MariaDB 10.11 and 11.4 both reject it (`Unknown column 'u.id' in 'WHERE'`, `mariadb114.out`). The ORM reaches all of them through public API:

- `distinct()` on an include (`wrapWithRowNumberDedup`, `query-plan-select.ts:656`);
- `distinct()` on an include with nested includes (`buildDistinctNonLeafChildRowsSelect`, :688);
- a scalar include (`count`, `sum` …) with `take`/`skip` or `distinct` (`hasPagination`, :962-966). A scalar include without them is already a plain correlated subquery and works;
- `combine()` (`buildIncludeChildCombineSelect`, :1111).

Recommendation: the MariaDB renderer refuses a derived table inside a subquery expression with `RUNTIME.AST_UNSUPPORTED`, naming the include form, and each is filed. None is in MySQL's tests or the example.

## 3. `JSON_ARRAYAGG` truncation

Facts (all probed on 10.11; the main ones repeated on 11.4):

1. **The cut is silent and can leave valid JSON with fewer elements.** Warning 1260 only. With 5 rows: `group_concat_max_len = 19` gives `[{"id": 1},{"id": 2}]`; `= 5` on scalars gives `[1,2,3]`. Other lengths give invalid text such as `[{"id": 1},{"id": 2},{"]` (`q3.out`).
2. **Raising the limit per statement works, up to 1 GiB.** `SET STATEMENT group_concat_max_len = 1073741824 FOR …` is accepted. Larger values are cut to 1073741824 with warning 1292 (`q2.out`). Same on 11.4.
3. **`max_allowed_packet` also cuts, silently.** With `group_concat_max_len` at 1 GiB, the aggregate is cut at 1,048,578 bytes when the packet is 1 MB and at 4,194,306 bytes when it is 4 MB, again with only warning 1260 (`q4.out`, `q5.out`). Earlier research said "SET STATEMENT cannot raise the limit past max_allowed_packet"; more exactly, it can, but the packet then cuts instead. So no setting can make truncation impossible.
4. **MySQL's answer does not carry over.** MySQL builds ordered arrays with `GROUP_CONCAT` and `CAST(… AS JSON)`, writing non-JSON text when `CONCAT` returns NULL, so the cast fails (`sql-renderer.ts:614-626`; test `orm-includes.live.test.ts:188`). MariaDB has no failing cast, and its `JSON_ARRAYAGG` truncates instead of failing.

Candidates:

| Candidate | Result |
| --- | --- |
| `JSON_VALID` on the result | Misses a cut on an element boundary (valid JSON, fewer rows) |
| `LENGTH(agg)` against `LEAST(@@group_concat_max_len, @@max_allowed_packet)` | Works, but it fails a result that is exactly at the limit, and it is harder to read |
| **`JSON_LENGTH(agg)` against the expected row count** | **Exact.** A cut in the middle gives `NULL`; a cut on a boundary gives a smaller number. With `LIMIT`/`OFFSET` the expected count is `LEAST(GREATEST(COUNT(*) - offset, 0), limit)`, and a `?N` written twice is bound once (`placeholders.ts:5-13`). `JSON_ARRAYAGG` keeps NULL elements, so `COUNT(*)` matches (`nulls.out`) |
| The same check in `HAVING`, using the select alias so the aggregate is built once | **Unusable.** MariaDB returns corrupted arrays: `[[{"id": 4}]]` and `[[]{"id": 4}]` (`q6.out`) |
| Driver warnings | Needs `SHOW WARNINGS` (an extra round trip) and changes MySQL's shared driver. Other warnings are harmless, so the driver would have to pick out 1260. Rejected |

How to raise the error inside a `SELECT`: `18446744073709551615 + COUNT(*)` raises error 1690 (BIGINT UNSIGNED out of range) only when the branch is reached; `COUNT(*)` stops MariaDB from evaluating it while preparing. An invalid `REGEXP` pattern returns NULL, not an error. A scalar subquery with two rows raises 1242, whose message misleads. MariaDB prints the failing operand, so a marker can go inside it (`marker.out`):

```
ERROR 1690 (22003): BIGINT UNSIGNED value is out of range in 'char_length(concat('include array cut short; rows: ',count(0))) + 18446744073709551615'
```

**Recommendation:**

```sql
JSON_EXTRACT(CASE WHEN JSON_LENGTH(COALESCE(<agg>, JSON_ARRAY())) = <expected>
  THEN COALESCE(<agg>, JSON_ARRAY())
  ELSE CHAR_LENGTH(CONCAT('<marker text>', COUNT(*))) + 18446744073709551615 END, '$')
```

The statement is prefixed with `SET STATEMENT group_concat_max_len = 1073741824 FOR`, so the limit is the packet, as on MySQL. In the prototype a 70 MB include failed with error 1690 instead of returning fewer rows. Cost: MariaDB builds the aggregate twice, because it is written twice. On an 8 MB include that took 55 ms instead of 28 ms (`q8.out`). The MariaDB copy of the MySQL "larger than a packet" test asserts the 1690 marker. The "longer than the session group_concat_max_len" test needs data larger than MariaDB's 1 MB default (MySQL's default is 1 KB), for example 2 MB, to check the raise.

## 4. Upsert

- `INSERT … ON DUPLICATE KEY UPDATE c = VALUES(c)` works on 10.11 and 11.4 with **no warning**. `VALUE(c)` is a synonym. The row alias (`AS n … n.c`) is error 1064 (`upsert.out`, `mariadb114.out`). MariaDB does not deprecate `VALUES()` there; MySQL 8.0.20+ does, which is why MySQL keeps `AS new`.
- Binding the values twice, as 6a did for the marker, works only for a one-row insert. The ORM's upsert has one row (`query-plan-mutations.ts:291-309`) and writes `excluded.c` only when the update is empty (`mutation-graph/collection-graphs.ts:288-292`). But the contract-free builder's `excluded` proxy can reference a multi-row insert (`relational-core/src/contract-free/table.ts:518`), and `renderInsert` takes several rows.
- **Recommendation:** MariaDB overrides two methods: no row-alias clause, and `excluded.c` rendered as `VALUES(c)`. The prototype passed every MySQL upsert test with it.

## 5. `mariadb()` facade

What is missing (6a ships only the control plane):

| Piece | Today | Needed |
| --- | --- | --- |
| Runtime target | `1-target/src/core/runtime/runtime-target.ts:7-16` writes `'mysql'` in the type and in `create()`; MariaDB has no `/runtime` export | A factory taking the descriptor meta; `@internal/target-mariadb/runtime` |
| Runtime adapter | `MysqlAdapterImpl`/`createMysqlAdapter` private; `targetId`, `profile.id` (`'mysql/default@1'`), `profile.target` and capabilities written in (`mysql-adapter.ts:32-45`); the descriptor is fixed to `'mysql'` (`runtime-adapter.ts:30-43`) | A descriptor factory taking the meta, the capabilities and a renderer; `@internal/adapter-mariadb/runtime` with `returning: false` capabilities |
| Runtime driver | Done in 6a: `2-mariadb/3-driver/src/core/runtime/runtime-driver.ts` | — |
| Client | `mysql()` imports MySQL's target, adapter and driver (`9-facade/src/runtime/mysql.ts:1-52, 217-236`); `MysqlTargetId = 'mysql'` (:54) types the stack and options; messages and `meta.extension` say MySQL | `createMysqlClient({ target, adapter, driver, displayName, urlSchemes })` with a target-id type parameter, as 6a did for `createMysqlDefineConfig`. `mariadb()` is a few lines |
| Runtime class | `MysqlRuntimeImpl` (`mysql-runtime.ts:14`), generic over the contract only | Reuse as it is |
| Static | `mysqlStatic` and `contractFromJson` import MySQL's target and adapter (`static/mysql-static.ts:1-19, 69-76`); the validator key is `mysql@<version>` (`static/contract-from-json.ts:8`) | The same factory parameters; MariaDB's validator key |
| Public package | `@prisma/orm-mariadb` has `/config`, `/control`, `/migration` | Add `/runtime` and `/static` in `shells.ts` and the publish tests |

**URL schemes:** accept both `mariadb://` and `mysql://`. The facade is the only scheme check (`9-facade/src/runtime/binding.ts:24`). The driver parses any URL (`3-driver/src/core/connection-options.ts:77-80`). CI, the 6a example README and the CLI path already use `mysql://` for MariaDB (`.github/workflows/ci.yml:175, 258`; `examples/prisma-8-demo-mariadb/README.md:18`). `mariadb://` is the `mariadb` package's own scheme. `validateMysqlUrl` takes the allowed schemes.

## 6. MySQL's ORM live tests on MariaDB

| File | A: 6a code unchanged | B: with the prototype | Failures in B |
| --- | --- | --- | --- |
| `orm-reads.live.test.ts` | 0/10 | 10/10 | — |
| `orm-includes.live.test.ts` | 0/11 | 10/11 | "larger than a packet" expects MySQL's `Invalid JSON text`; MariaDB raises the 1690 guard error. Correct behaviour, different text |
| `orm-writes.live.test.ts` | 0/15 | 14/15 | The exact-SQL assertion expects `AS \`new\`` (:219) |
| `raw-lane.live.test.ts` | 0/4 | 4/4 | — |

Every A failure is `Unknown system variable 'transaction_isolation'`: `mysql()` uses MySQL's target, whose session settings MariaDB 10.11 lacks. Only `mariadb()` fixes it.

Not covered by the four files: the refused include forms (section 2), and the "longer than the session limit" test (it is below MariaDB's 1 MB default, so it does not exercise the raise).

## 7. Runtime error metadata

Places that name MySQL in errors MariaDB can reach at runtime:

- `2-adapter/src/core/sql-renderer.ts:80` `meta.target: 'mysql'`, and 24 messages ("MySQL has no FULL JOIN", "MySQL lowering: …").
- `2-adapter/src/core/runtime/mysql-adapter.ts:42` `profile.target: 'mysql'`. This is identity, not wording: MariaDB's adapter must say `'mariadb'`.
- `3-driver/src/core/parameter-values.ts:5` `meta.target: 'mysql'`; `connection-options.ts:71` "MySQL connection URL"; `normalize-error.ts` (7 mentions).
- `1-target/src/core/errors.ts:36` (`mysqlQueryNotYetSupported`, reached at runtime from `codecs.ts:105`, a raw column inside an include) and `1-target/src/core/codec-descriptor.ts:219`, `1-target/src/core/sql-lexer.ts:112`.
- `9-facade/src/runtime/mysql.ts:255, 358, 377`, `binding.ts:8`, `mysql-options.ts:13`: `meta.extension: 'mysql'`, "MySQL client is closed".

Postgres writes its own name the same way (`postgres/2-adapter/src/core/sql-renderer.ts:329`, `postgres/9-facade/src/runtime/postgres.ts:127`), so `meta.target` means the target the user configured. **Recommendation:** the renderer, the runtime adapter, the driver and the client factory take the target id and the display name they are built with, and use them in `meta.target`, `meta.extension` and the message. The driver already has the target id from 6a. The codec and lexer errors run in the shared target package without a target instance; leave them as `'mysql'` and record in `deferred.md` that they name MySQL's codec set. This closes the 6a `deferred.md` entry.

## 8. Size

| Part | Lines |
| --- | --- |
| MySQL renderer to a class (mechanical) and export | 650 changed, about +60 net |
| MariaDB renderer: flattening, truncation check, refusals, upsert, `SET STATEMENT`, naming | 200–250 |
| Runtime target and adapter factories (MySQL) and MariaDB descriptors | 150–200 |
| `createMysqlClient`/static factory, `mariadb()`, binding schemes, exports | 250–350 |
| Error naming through renderer, adapter, driver, facade | 80–120 |
| Public package subpaths, `shells.ts`, publish tests | 60–100 |
| Tests: MariaDB renderer goldens; MariaDB copies of the four ORM live files with the server differences stated; unit tests for the factories | 1,000–1,400 |
| Example: `db.ts`, ORM client, queries, raw, seed and their tests (MySQL's are 373 lines) | 400–450 |
| **Total** | **about 2,200–2,900** |

It fits one reviewable PR, inside the 3–4k target. Put the mechanical class conversion in its own commit.

## Shared-code changes

None in `packages/1-framework`, `packages/2-sql-family` or `sql-orm-client`. Optional later: a shared include shape chosen by a capability, which would let `distinct`, paginated scalar and `combine` includes run on MariaDB.

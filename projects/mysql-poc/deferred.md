# Deferred

Work found during the project and set aside. Each entry says where it came from. At close-out each one is resolved, filed, or dropped.

## Running a migration.ts loads the target and adapter packages twice

From the system-design review of slice 2b (2026-10-22).

`node migration.ts` imports the target natively. The migration CLI then loads `prisma.config.ts` through c12 and jiti, which evaluates the target and adapter packages a second time. ADR 242 requires each module to exist once in a process, because registries and `instanceof` checks depend on it. Postgres and SQLite get away with it because they dispatch DDL through `ast.accept(visitor)`. The MySQL adapter hit it when it used `instanceof`, and now uses `accept` too. Any future `instanceof` or module-level registry on this path breaks silently.

Fix: make the config load reuse the modules already loaded, and add a test that fails when a target module is evaluated twice in one migration.ts run. Worked out from the code, not yet reproduced.

## One per-space apply loop for targets whose DDL is not transactional

From the system-design review of slice 2b (2026-10-22).

The Mongo and MySQL runners each carry their own copy of the loop that applies a space, verifies it, writes its marker, and stops on failure with `failingSpace` and `databaseUnchanged`. Two improvements:

1. Move the loop into one shared helper both runners use.
2. Run every check that needs no database change, for every space, before the first change, so a failure that can be predicted is reported while the database is still untouched.

## The internal runner step is on a public interface

From the system-design review of slice 2b (2026-10-22).

`SqlMigrationRunner.executeOnConnection` applies a space without opening a transaction, for the runner's own use. Only runners call it, each on itself. On MySQL "without a transaction" means nothing, and the MySQL version takes no marker lock, so an outside caller would apply a space with no lock held. Fix: make it internal to each runner, or have it take the lock.

## One error code per target for the same failure

From the system-design review of slice 2b (2026-10-22).

`MIGRATION.MYSQL_CONTROL_STACK_MISSING` sits beside `MIGRATION.POSTGRES_CONTROL_STACK_MISSING`: the same failure under two codes, and each new target adds another. Fix: one target-neutral code. Renaming the Postgres code changes what users can match on, so it needs an upgrade note.

## A planned migration does not type-check in a facade-only application

From slice 2c (2026-10-23).

Including `migrations/**` in the MySQL example's `tsconfig.json` fails with TS2742 on `get operations()`: the inferred type names a bundled chunk inside `@prisma/orm-target-mysql`, which an application that depends only on `@prisma/orm-mysql` cannot name. The Postgres and SQLite demos also leave `migrations/` out of type checking, so it may affect every target; not yet checked there. Fix: give the operations an explicit type the facade exports, and type-check `migrations/` in every example.

## A family-level client builder and a shared SQL renderer core

From the system-design review of slice 3 (2026-10-23).

The MySQL facade's client (about 440 lines) and the MySQL SQL renderer are copied from SQLite's. The renderer copy is justified for now, because the dialect differences are throughout it. The client copy has already drifted once: `main` gained `delegatingRuntime` while the MySQL copy kept its own, and slice 3 had to adopt it. The family-level builder should come first. Two follow-ups: a family-level builder for a target's `mysql(...)`/`sqlite(...)`/`postgres(...)` client, so each facade supplies only its driver and options; and a shared renderer core that targets extend for their dialect, so a fix like collecting parameters in written order lands once.

## MySQL environment check at startup or deploy time (Will, 2026-10-30)

The MySQL driver relies on mariadb's value substitution. That substitution is safe only when the session's `sql_mode` excludes `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, and when raw SQL avoids shapes mariadb's placeholder search misreads (see `slices/mysql-driver-protocol/spec.md`). Will's ideal: the driver offers a check at startup that the database is configured as the driver requires, and better still a deploy-time check. Not required for the proof of concept.

## `onConflict: 'skip'` on MySQL (slice 4, 2026-10-30)

MySQL has no form that skips only duplicate-key rows and counts correctly: `INSERT IGNORE` also turns foreign-key, `NOT NULL` and truncation errors into silent skips, and a no-op `ON DUPLICATE KEY UPDATE` counts a skipped duplicate as written while the driver sets `foundRows`. The ORM refuses the option on MySQL. MariaDB's `INSERT IGNORE … RETURNING` may change this in its slice.

## Upsert on MySQL relies on the contract listing every unique index (slice 4 code review, 2026-10-30)

Without `sql.insertOnConflictTarget`, the ORM allows an upsert only when the contract shows no other unique key can collide. `db verify` accepts unique indexes the contract does not list unless run with `--strict`, and against such an index an upsert can update another row and succeed (reproduced in the slice 4 code review). The requirement is documented. Fix candidates: the startup or deploy-time environment check (TML-3777) compares the table's unique indexes with the contract; or `db verify` refuses unlisted unique indexes on a target without the capability.

## Upsert without conflict columns (slice 4 system-design review, D02)

When the capability is absent the ORM sends an upsert with no conflict columns, and only the MySQL renderer accepts that. Alternative recorded: the AST always keeps the named columns, and the MySQL renderer checks them against the contract instead.

## `mariadb` 3.5.4 can raise an unhandled rejection after destroying a connection (slice 4, 2026-10-30)

`Connection.destroy()` in `lib/connection.js` sends `KILL` on a background connection and chains `.finally()` with no `catch`. If that background connection drops, the rejection is unhandled in the application process, and the driver cannot catch it. The MySQL driver now never calls `destroy()` while a statement is receiving: it cancels with `KILL QUERY` on another pooled connection instead, so users are not exposed. Report the bug to the `mariadb` package; the report text is in the slice 4 worktree's `wip/mariadb-kill-bug.md`.

## A statement sent after release runs on Postgres (slice 4 system-design review, D20)

The MySQL driver refuses a statement sent on a held connection after `release()`, or still waiting for it then, with `DRIVER.NOT_CONNECTED`. The Postgres driver runs it on the client after it went back to the pool, possibly inside another caller's session. MySQL does not force the difference; it fixes a defect both drivers share. Linear TML-2333 ("invalidate wrappers on teardown") covers the same fix at the runtime layer; give the Postgres driver the same rule there.

## Split `returning` by statement kind (slice 6a, 2026-11-06)

MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING` but not `UPDATE … RETURNING`. MariaDB reports `returning: false`, as MySQL does, and every ORM write works through the slice 4 read-back (probed on 10.11). Splitting the capability would save a round trip on MariaDB inserts and deletes. It touches about ten places in `sql-orm-client`, the SQL builder's typed `ReturningCapability` and its three checks, and the Postgres and SQLite capability lists: about 400–700 lines of shared code, additive only if `returning` keeps its meaning for every statement kind.

## MariaDB JSON and boolean columns (slice 6a, 2026-11-06) — resolved by the scalar convenience types

MariaDB stores `JSON` as `longtext` with a `CHECK (json_valid(col))` constraint, and booleans as `tinyint(1)`. MySQL has neither data type yet, so nothing breaks today. When MySQL gets them, MariaDB needs its own data types that read these catalog forms.

Resolved: MySQL now has `mysql/json` and `mysql/boolean`, and MariaDB shares them. MariaDB's catalog reader reads `information_schema.CHECK_CONSTRAINTS` and reports a `longtext` column with a column-level `json_valid` check named after the column as `json`, the text MySQL reports for the same column; it already reported a signed `tinyint(1)` as MySQL does. So MariaDB needs no data types of its own (`packages/3-targets/mysql/2-mariadb/2-adapter/src/core/migrations/catalog.ts`).

## MariaDB sessions set `tx_isolation`, which MariaDB 11.1 and later deprecate (slice 6a code review, 2026-11-06) — resolved in slice 6b-2

Resolved: MariaDB sessions no longer set an isolation level at all, as MySQL sessions have not since prisma/orm#30990. The ORM starts each transaction it owns at READ COMMITTED with `SET TRANSACTION ISOLATION LEVEL`, which MariaDB 10.11 accepts as MySQL does. Nothing reads or writes `tx_isolation` or `transaction_isolation`.

## Errors from MySQL's shared code say `target: 'mysql'` on MariaDB (slice 6a, 2026-11-06) — resolved in slice 6b-2

Resolved: errors raised by the codecs, the SQL lexer, the codec registry and the driver's parameter checks drop `meta.target`. Every error message in MySQL's target, adapter, driver and facade either takes the display name of the target it runs for (the renderer, the driver, the facade) or names both MySQL and MariaDB (the shared target and the control adapter); `1-target/test/messages-name-both-databases.test.ts` fails on an error in the target that names MySQL alone. The PSL type documentation (`type-constructors.ts`) still says, for example, "stored as MySQL int", which describes the type the column has on either server.

## A key column whose codec cannot reproduce the stored value (slice 6b-1 design review, 2026-11-14)

The ORM reads a key, decodes it, and sends it back encoded: in the write graphs' read-back today, and in every per-relation include from slice 6b-1. A `timestamptz(6)` or `datetime(6)` key read with a `Date` codec loses the digits below a millisecond, so the key sent back matches nothing, and the row or its children are missing without an error. Fix belongs with the codecs: a codec for a key column must reproduce the stored value, or the ORM must be able to ask whether it does. That needs a codec property the framework does not have.

## Reads with includes do not stream (slice 6b-1, 2026-11-17)

A read with includes reads every row before returning any, under both include strategies: one query per relation holds the parents and every level of children in memory until the read completes. Reads without includes still stream. Streaming with includes in batches, a parent query per page of identities followed by that page's children, can be added without changing the design.

## `budgets` and `lints` see each per-relation statement as a bare `SELECT` (slice 6b-1, 2026-11-17)

`lints` warns about a `SELECT` without a `LIMIT`, and `budgets`, where installed, fails it by default. Where includes load with one query per relation, each child statement is such a `SELECT`, so a read that passes on a database that runs the one-query include can fail with `BUDGET.ROWS_EXCEEDED` on MariaDB, as the ORM's read-backs after a write already can. Completing or removing the two middleware is stream 6, row 8 of the GA plan.

## MySQL and MariaDB supply no ORM aggregates, so scalar includes do not run there (slice 6b-1 manual QA, 2026-11-17) — resolved in slice 6b-2

Resolved: the MySQL target contributes aggregate descriptors as the Postgres target does (`packages/3-targets/mysql/1-mysql/1-target/src/core/aggregates.ts`), listed by the MySQL adapter and, through its metadata, the MariaDB adapter. `count` and `sum` over integers read as numbers through the new codec `mysql/bigintnumber@1`; `countBigInt` and `sumBigInt` as bigints; `avg` over an integer is `CAST(SUM(x) AS DOUBLE) / COUNT(x)`, read through the new codec `mysql/double@1`, because `AVG(x)` is cut to nine decimal places when the server groups through a temporary table. MySQL's live include tests cover scalar includes and `combine()`, on both servers.

## `mysql/bigintnumber@1` and `mysql/double` have no authoring name (slice 6b-2, 2026-11-18) — resolved by the scalar convenience types

The two codecs type aggregate results only. No PSL type or `type.*` helper writes a column of them, because MySQL's explicit type names are still to be decided under ADR 322, so no aggregate takes them as input, and `mysql/double` claims no `double` column the catalog reports: introspection and `db verify` read a `double` column as they did before it existed. When ADR 322 names them, give them catalog texts and the aggregate rows over them, as Postgres's `Int8Number` and `Float8` have.

Resolved: they are the explicit types `Int8Number` (`BigInt(as: number)`) and `Float8` (`Float`). `mysql/double` claims the catalog text `double`, so a `double` column is introspected and verified as `mysql/double`, and `sum`, `avg`, `min` and `max` take a column of either codec.

## `having` compares the mean of integers as `AVG`'s rounded decimal (slice 6b-2 round 2, 2026-11-18)

A projected `avg` over an integer reads `CAST(SUM(x) AS DOUBLE) / COUNT(x)`, but the ORM's `having` builds the plain `AVG(x)` and never uses an aggregate's lowering, because a lowering may be a rendering for the driver that changes comparisons. `AVG(x)` is a decimal with four more decimal places than its input, which MySQL and MariaDB round differently. So a comparison within about 1e-4 of a group's mean can disagree with the projected value, and between the two servers: over the means 1 and 5/3, `HAVING AVG(a) > 1.6666666666666667` keeps the 5/3 group on MariaDB 10.11 and drops it on MySQL 8.4, while `CAST(SUM(a) AS DOUBLE) / COUNT(a) = 1.6666666666666667` keeps it on both. A threshold away from a mean behaves the same on both (the live test uses `gt(1.5)`). The fix belongs to the SQL ORM client: use a descriptor's lowering in `having` when the descriptor says its lowering is the value itself, not a driver rendering. That is a change to shared code for every SQL target. Filed as TML-3841.

## `deleteAll()` on a table with no row identity deletes by the caller's condition after reading (slice 6b-1, 2026-11-17)

Where `deleteAll()` must read the rows before deleting them (rows returned on a database without `RETURNING`, or with includes under the one-query include), and the table has no primary key and no unique key of `NOT NULL` columns, it runs a `SELECT` and then a `DELETE` on the same condition. A matching row committed between the two is deleted and not returned. This is `main`'s deliberate behaviour for such tables (`sql-orm-client/test/statement-graph/table-without-identity.test.ts`), and slice 6b-1 did not change it. Slice 6b-1 does widen who meets it: a unique key with a nullable column no longer counts as an identity. With an identity, the `DELETE` is keyed by the rows read.

## A stored column whose name starts with `__prisma_` can clash with an internal alias

The ORM client names its internal projection aliases with the prefix `__prisma_` (`__prisma_page_rn`, `__prisma_parent_key_<n>`, `__prisma_aggregate`, and on `main` before this project `__prisma_distinct_rn` and `__prisma_polymorphic_discriminator`). Nothing rejects a stored column with such a name, so a table that has one can return a wrong value for it. The fix is one check where contract column names are validated, covering every alias. Raised by the automated review of prisma/orm#31058; not fixed there because it is not specific to per-relation includes.

## Rides along in the close-out pull request (2026-11-18)

Two changes were made after prisma/orm#31082 entered the merge queue, which rejects pushes. Both are commits on the local branch `aida-20/tml-3697-mariadb-runtime` and go into the project's next pull request:

- `packages/3-targets/mysql/2-mariadb/2-adapter/test/control-adapter.live.test.ts` compares the control session's isolation level with the server's default, where it hard-coded `REPEATABLE-READ` (automated review of prisma/orm#31082).
- `@prisma/orm-mariadb` gains the `contract-builder` entry that the Postgres, SQLite and MySQL packages have, so a MariaDB contract can be written in TypeScript.

## `createMysqlDefineConfig` is the one factory for extending targets outside its own entry (close-out review, 2026-11-18)

Factories that a target extending MySQL uses go in their own entry, as `createMysqlDefineContract` does in `./define-contract`. `createMysqlDefineConfig` stays in `./config`, beside the `defineConfig` applications import, because it was published there first. Move it to `./define-config` in the next breaking release.

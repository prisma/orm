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

## MariaDB JSON and boolean columns (slice 6a, 2026-11-06)

MariaDB stores `JSON` as `longtext` with a `CHECK (json_valid(col))` constraint, and booleans as `tinyint(1)`. MySQL has neither data type yet, so nothing breaks today. When MySQL gets them, MariaDB needs its own data types that read these catalog forms.

## MariaDB sessions set `tx_isolation`, which MariaDB 11.1 and later deprecate (slice 6a code review, 2026-11-06)

MariaDB's target sets the isolation level with `tx_isolation`, because MariaDB 10.11 has no `transaction_isolation`. On MariaDB 11.4, `SET SESSION tx_isolation = 'READ-COMMITTED'` works but raises warning 1287: the variable is deprecated and will be removed. From 11.1 both names exist. When the oldest supported MariaDB is 11.1 or later, switch to `transaction_isolation`; before that, a future MariaDB that removes `tx_isolation` makes every connection fail, unless the driver picks the name from the server version at connect. The example README says only that it is tested on 10.11.

## Errors from MySQL's shared code say `target: 'mysql'` on MariaDB (slice 6a, 2026-11-06)

`mysqlQueryNotYetSupported` in `packages/3-targets/mysql/1-target/src/core/errors.ts` puts `target: 'mysql'` in its error metadata, and its message says MySQL, also when MariaDB reaches them through MySQL's shared code. The control plane shows these errors rarely; runtime errors reach users. Slice 6b decides whether the label follows the target id, is dropped, or stays as the name of the code that raised the error.

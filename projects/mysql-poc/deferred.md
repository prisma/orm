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

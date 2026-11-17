# @internal/target-mariadb

MariaDB target pack for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Declares MariaDB to the SQL family as a target that extends MySQL ([`@internal/target-mysql`](../../1-mysql/1-target/README.md)): MariaDB reuses MySQL's data types, codecs, PSL authoring, planner, runner, schema verifier and contract serializer under its own target id, `mariadb`.

## Responsibilities

- **Descriptor metadata** (`src/core/descriptor-meta.ts`): MySQL's, with `targetId: 'mariadb'` and `displayName: 'MariaDB'`. MySQL's data types and codecs keep their `mysql/…` ids, which name MySQL's set of types rather than the server; no shared code compares an id's prefix with the target. Every session runs in UTC, as on MySQL. Like MySQL, it sets no session isolation level: the ORM starts each transaction it owns at READ COMMITTED with `SET TRANSACTION ISOLATION LEVEL`, which MariaDB takes as MySQL does.
- **Runtime target descriptor** (`src/core/runtime/runtime-target.ts`): built with MySQL's `createMysqlRuntimeTargetDescriptor` from MariaDB's runtime metadata.
- **Control target descriptor** (`src/core/migrations/control-target.ts`): built with MySQL's `createMysqlControlTargetDescriptor`, so planned operations carry `mariadb` and every `migration.ts` imports `@internal/mariadb/migration`.
- **Migration class** (`src/core/migrations/mariadb-migration.ts`): `MariadbMigration`, MySQL's `MysqlMigrationBase` with `targetId: 'mariadb'`.

A contract built for `mariadb` has different hashes from a MySQL contract with the same storage, and an extension pack built for `mysql` is refused on `mariadb`.

## Exports

- `./pack`: the descriptor metadata, the pack ref for the PSL interpreter
- `./control`: the control target descriptor
- `./migration`: `Migration`, which is `MariadbMigration`
- `./runtime`: the runtime target descriptor

# ADR 336 — Names Prisma puts in a database or a query begin with `_prisma`

**Status:** Proposed
**Date:** 2026-11-26
**Domain:** Adapters & Targets, Migration System

## At a glance

A PostgreSQL database that Prisma 8 manages has one schema that is not the user's:

```text
postgres=# \dn
   Name   |  Owner
----------+----------
 _prisma  | app
 public   | app
```

Everything Prisma keeps for itself is inside it. On a database with no schemas the same things are tables whose names begin `_prisma_`. A user who finds one of these knows three things from the name alone: it is internal, Prisma maintains it, and it is not to be changed by hand.

## Decision

Anything a target stores in a user's database for Prisma, and any name Prisma invents inside a query, begins with `_prisma`, with one underscore. That covers a table, a schema, a collection, an enum, a role, a temporary name used while a migration runs, and a column alias in a generated query.

The underscore means "do not edit". It does not mean "do not look": the record of which contract a database was signed with is worth a user's reading.

A target chooses its own names under this rule, because the target also writes the queries against them. The framework fixes one name only, the contract space for Prisma's own tables, which is `_prisma` on every target ([ADR 337](ADR%20337%20-%20Each%20target%20has%20a%20contract%20space%20for%20Prisma%27s%20own%20tables.md)).

Lock names are outside the rule. `prisma_8.contract.marker` on PostgreSQL and `prisma_marker_<hash>` on MySQL are not objects in a namespace the user shares, and an earlier release that is still running during a deploy must take the same lock.

## Why

These names share a namespace with the user's own. A collision with a user's name is unlikely with or without an underscore. But where our names and theirs share a space, the rule is to make a collision impossible or resolvable, and to make ownership plain. A leading underscore is the usual sign for "internal", and people who used Prisma 7 already know it from `_prisma_migrations`.

The rule has to be settled before `8.0.0`. A name in a user's database cannot change within a major version without a migration of that database, and the compatibility policy allows Prisma's own tables only additions within a major.

## Where the names stood, and where they are going

Before this decision each name was chosen where it was written. A search of the source on 2026-11-26 found three conventions:

| Where | Names before | Prefix before | After |
| --- | --- | --- | --- |
| PostgreSQL schema | `prisma_contract` | none | `_prisma`, renamed automatically ([ADR 337](ADR%20337%20-%20Each%20target%20has%20a%20contract%20space%20for%20Prisma%27s%20own%20tables.md)) |
| SQLite and MySQL tables | `_prisma_marker`, `_prisma_ledger` | one underscore | already follow the rule |
| MongoDB collection | `_prisma_migrations` | one underscore | already follows the rule |
| Temporary names while a migration swaps enum values or storage names | `prisma_swap`, `prisma_swap_<name>` | none | `_prisma_swap…`; nothing is stored, so nothing is migrated |
| Column aliases in queries the ORM client generates | `__prisma_distinct_rn`, `__prisma_page_rn`, `__prisma_aggregate`, `__prisma_parent_key_…`, `__prisma_polymorphic_discriminator`, `__prisma_combine__…` | two underscores | one underscore; they are never stored and never seen by a user |

The change that introduces this record renames the PostgreSQL schema. The temporary names and the query aliases move in a later change of the same project, and this table is updated when they do.

## Prisma 7's `_prisma_migrations` table

A user who moves a database from Prisma 7 may still have its `_prisma_migrations` table, which also begins `_prisma`. Prisma 8 does not own it: the PostgreSQL adapter treats it as another tool's bookkeeping and leaves it alone when it reads a schema, unless the user's contract declares it ([ADR 267](ADR%20267%20-%20A%20table%20may%20hold%20columns%20its%20model%20does%20not%20map.md)). So the prefix says "Prisma's", not "Prisma 8's". Prisma 8 never creates an object with that name on PostgreSQL, SQLite or MySQL.

## Prior art

Checked against each tool's own documentation or source on 2026-11-25.

- **The tool's name with no underscore:** Kysely (`kysely_migration`, [source](https://github.com/kysely-org/kysely/blob/master/src/migration/migrator.ts)), Knex (`knex_migrations`, [guide](https://knexjs.org/guide/migrations.html)), Django (`django_migrations`, [source](https://github.com/django/django/blob/main/django/db/migrations/recorder.py)), Alembic (`alembic_version`, [docs](https://alembic.sqlalchemy.org/en/latest/api/runtime.html)), Flyway (`flyway_schema_history`, [docs](https://documentation.red-gate.com/fd/flyway-table-setting-277579042.html)).
- **A generic name:** Rails (`schema_migrations` and `ar_internal_metadata`, [source](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/model_schema.rb)).
- **A leading underscore:** Prisma 7 and earlier (`_prisma_migrations`), Drizzle (`__drizzle_migrations`, inside a schema named `drizzle` on PostgreSQL, [source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts)), EF Core (`__EFMigrationsHistory`, [docs](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/history-table)).

## Alternatives considered

- **No prefix beyond the tool's name,** as most tools do. Rejected: the underscore is a clear sign of "internal", and Prisma's users already know it.
- **Two underscores.** Rejected: it adds nothing once the rule is stated, and one convention is simpler than two.
- **Leaving PostgreSQL as an exception,** because a schema already separates its tables from the user's. Rejected: the schema's own name shares a namespace with the user's schemas.
- **Relying on the rule that a contract space's name begins with a letter** to keep `_prisma` out of the user's repository. Rejected as an argument for the name: that is a check on names, and a structural property must not depend on a check on names.

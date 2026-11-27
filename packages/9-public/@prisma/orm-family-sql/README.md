# @prisma/orm-family-sql

The SQL family domain of Prisma 8: the SQL contract surface, schema IR, query lanes, SQL builder, and the SQL runtime shared by every SQL target (Postgres, SQLite).

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

An application on a SQL database lists this package beside its database package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`). The database package requires it as a peer dependency and says which versions it accepts, and `prisma orm init` writes the line for you. Application code imports from the database package. Extension authors and decomposed installs building against the SQL family import it directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/contract` | SQL contract entities, validators, index and FK modelling |
| `/schema-ir` | SQL schema intermediate representation |
| `/contract-psl`, `/contract-ts` | PSL and TypeScript contract authoring for SQL |
| `/contract-emitter` | SQL contract emission |
| `/relational-core`, `/builder` | query lanes, relational AST, SQL builder |
| `/runtime` | SQL runtime |
| `/orm-client` | the fluent, type-safe ORM client over SQL model collections |
| `/family` | the family pack: control, migration, diff, IR, verification |

## Responsibilities

Everything SQL databases share and nothing any one of them owns: contract semantics, relational query building, the ORM client, and the family-level control/migration surface. Target-specific behavior (Postgres or SQLite DDL, drivers) lives in the `@prisma/orm-target-*` packages.

The ORM client sits here rather than in the package for one database, because every SQL database package uses it and a module may be published from only one package. Its source still lives in `packages/3-extensions/sql-orm-client/` for historical reasons; the directory does not make it a user-installed extension.

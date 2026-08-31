# @prisma/orm-family-sql

The SQL family domain of Prisma Next: the SQL contract surface, schema IR, query lanes, SQL builder, and the SQL runtime shared by every SQL target (Postgres, SQLite).

Applications receive it as an exact-pinned dependency of a SQL facade (`@prisma/orm-postgres`, `@prisma/orm-sqlite`); app developers install the facade. Extension authors and decomposed installs building against the SQL family import it directly.

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

The ORM client sits here rather than in a facade because both SQL facades use it and a module may be published from only one package. Its source still lives in `packages/3-extensions/sql-orm-client/` for historical reasons; the directory does not make it a user-installed extension.

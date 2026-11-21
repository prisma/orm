# @prisma/orm-family-sql

The SQL family domain of Prisma 8: the SQL contract surface, schema IR, query lanes, SQL builder, and the SQL runtime shared by every SQL target (Postgres, SQLite).

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
| `/errors` | the SQL driver error classes: `SqlQueryError` (`kind: 'sql_query'` with `sqlState`, `constraint`, `table`, `column`, `detail`), `SqlConnectionError` (`kind: 'sql_connection'`, `transient`), and `isUniqueConstraintViolation(error)` |

## SQL driver errors

A SQL statement that fails surfaces as a `SqlQueryError`, and a connection that fails as a `SqlConnectionError`; both carry no dotted code — route on `kind` and the metadata fields instead. The classes are the same modules every SQL facade's driver throws, so `instanceof` and `SqlQueryError.is(...)` hold across the family. `isUniqueConstraintViolation(error)` classifies a unique or primary-key violation from the driver-normalized `sqlState` (`'23505'`), without knowing any target's own error shape:

```ts
import { SqlQueryError, isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';

try {
  await db.execute(plan);
} catch (error) {
  if (isUniqueConstraintViolation(error)) {
    // sqlState === '23505'; error.constraint, error.table name the violated key.
  } else if (error instanceof SqlQueryError) {
    // Other query failure: route on error.sqlState and error.constraint.
  }
}
```

An application that imports from `/errors` directly declares `@prisma/orm-family-sql` as a dependency of its own, pinned to the version the facade uses, so the application and the driver share one copy of the module.

## Responsibilities

Everything SQL databases share and nothing any one of them owns: contract semantics, relational query building, the ORM client, and the family-level control/migration surface. Target-specific behavior (Postgres or SQLite DDL, drivers) lives in the `@prisma/orm-target-*` packages.

The ORM client sits here rather than in a facade because both SQL facades use it and a module may be published from only one package. Its source still lives in `packages/3-extensions/sql-orm-client/` for historical reasons; the directory does not make it a user-installed extension.

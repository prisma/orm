# @prisma/orm-family-sql

The SQL family domain of Prisma 8: the SQL contract surface, schema IR, query lanes, SQL builder, and the SQL runtime shared by every SQL target (Postgres, SQLite).

An application on a SQL database lists this package beside its database package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`), at the same version, because the database package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the database package. Extension authors and decomposed installs building against the SQL family import it directly.

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

A SQL statement that fails surfaces as a `SqlQueryError`, or as a `SqlConnectionError` for a connection-related failure, which is not always a lost connection (SQLite reports a busy or locked database, `SQLITE_BUSY` and `SQLITE_LOCKED`, this way with the connection still open), and a connection that fails to open surfaces as the class the error's own code gives it, the same as anywhere else — an invalid password (`28P01`) is a `SqlQueryError`, not a `SqlConnectionError` — so route on `kind` and the metadata fields, not on which call failed; both carry no dotted code. The drivers classify from the underlying error's own code, so an error that carries none (a plain pg `Error`, for example) can surface unchanged — it then matches neither `kind` nor `instanceof` checks; treat an unclassified `Error` on a SQL path as unknown and inspect the error itself. The exception is a failure the Postgres driver knows is a connection failure — a `connect()` that rejects, or an error raised on a client that has already lost its connection — whose error no code classifies: it becomes a `SqlConnectionError`, keeping the original error as its `cause`. The classes are the same modules every SQL facade's driver throws, so `instanceof` and `SqlQueryError.is(...)` hold across the family. `isUniqueConstraintViolation(error)` classifies a unique or primary-key violation from the driver-normalized `sqlState` (`'23505'`), without knowing any target's own error shape:

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

The ORM client sits here rather than in the package for one database, because every SQL database package uses it and a module may be published from only one package. Its source still lives in `packages/3-extensions/sql-orm-client/` for historical reasons; the directory does not make it a user-installed extension.

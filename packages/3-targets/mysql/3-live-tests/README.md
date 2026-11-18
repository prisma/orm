# @internal/mysql-live-tests

The ORM live test suites of MySQL and MariaDB, run against MySQL 8.4 and MariaDB 10.11.

## Package Classification

The package has no source files, only tests, so it has no layer or plane in `architecture.config.json`. It sits in the targets domain, after `1-mysql` and `2-mariadb`, because it depends on both.

## Purpose

MariaDB runs MySQL's runtime under its own target id, so every ORM read and write must behave on MariaDB as on MySQL, except where a test says otherwise. This package holds that claim. It depends on both facades, which is why it sits beside `1-mysql` and `2-mariadb` rather than inside either: a suite in MySQL's facade could not reach MariaDB's, and MariaDB's facade would have to import MySQL's test files.

## Responsibilities

- **Suites** (`test/suites/`): reads, includes, writes, raw SQL and transaction ownership. Each suite takes a `LiveServer` (`test/live-server.ts`) and names no database: where the servers differ, the suite reads the expectation from `server.expected`, which the server's definition states.
- **Servers** (`test/mysql/server.ts`, `test/mariadb/server.ts`): a client of each, its control components, and what differs on it. Each folder runs every suite against its server.
- **One schema for both** (`test/fixtures/contract.prisma`): emitted for each target by `pnpm emit` into `test/fixtures/<target>/generated/`. The suites are typechecked twice, once against each target's emitted types (`tsconfig.json` for MySQL, `tsconfig.mariadb.json` for MariaDB, which map `#live-types` to `test/types/<target>.ts`), so no MariaDB contract is typed as MySQL's. `test/contracts-agree.test.ts` checks that the two contracts have the same models and tables, and type their fields, columns and aggregates alike.
- **Rendered SQL** (`test/rendered-statements.test.ts`): the SQL MySQL is sent for the suites' queries as they stood when the renderer became a class, replayed against a driver that answers without a database. It is a copy kept by hand.

## Testing

The live tests need `MYSQL_URL` and `MARIADB_URL` and skip a server whose URL is not set, except in CI, where `test/live-server.test.ts` fails without both. `docker compose up mysql mariadb` starts both servers.

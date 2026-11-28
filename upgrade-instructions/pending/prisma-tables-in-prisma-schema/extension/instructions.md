---
changes:
  - id: name-the-prisma-schema
    summary: |
      On PostgreSQL, Prisma's own tables (`marker`, `ledger` and `contract`) are now in the schema `_prisma`, not `prisma_contract`. Extension code and tests that name `prisma_contract` in SQL, such as a query of `prisma_contract.marker` or a test helper that drops the schema to reset the database, must name `_prisma`.
    detection:
      glob: "**/*"
      contains:
        - "prisma_contract"
  - id: prisma-tables-api-breaks
    summary: |
      `@prisma/orm-target-postgres` no longer exports `buildControlTableBootstrapQueries` or `buildSignMarkerBootstrapQueries`, and `PostgresControlAdapter.markerLocation` is typed `string`. A marker read (`MarkerReadResult`) can return the new kind `earlier-release`, the runner's error codes include `MIGRATION.PRISMA_TABLES_MISSING`, and `ControlClient` has a new required method, `bringPrismaSpaceUpToDate`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "buildControlTableBootstrapQueries"
        - "buildSignMarkerBootstrapQueries"
        - "markerLocation"
        - "MarkerReadResult"
        - "SqlMigrationRunnerErrorCode"
        - "ControlClient"
---

# Prisma's own tables are in the `_prisma` schema

## `name-the-prisma-schema`

Prisma 8 keeps a few tables of its own in a PostgreSQL database. The `marker` table records which contract each contract space was last brought to; a contract space is a set of tables with its own contract and migrations, such as the application's or the one an extension carries. The `ledger` table records each migration applied, and the `contract` table holds the contract of each migration. The release candidates kept these tables in a schema named `prisma_contract`. They are now in a schema named `_prisma`, and the table names are unchanged. Prisma creates them with migrations of its own, which `prisma db init`, `db update`, `db migrate` and `db sign` apply before anything else, and which rename `prisma_contract` to `_prisma` on a database a release candidate set up.

Search the extension's code, scripts and tests for `prisma_contract`, outside `node_modules` and build output, and replace it with `_prisma`. `_prisma` needs no quotes in SQL. The usual cases:

- A test helper that resets the database between tests by dropping the schema. If it dropped only `prisma_contract`, `_prisma` now survives the reset, and the next test finds the marker rows of the previous one.

  ```ts
  // Before
  await driver.query('drop schema if exists prisma_contract cascade');

  // After
  await driver.query('drop schema if exists _prisma cascade');
  ```

- A test that reads the marker to check which contract a space was brought to. The marker table now also has a row for the space `_prisma`, which holds Prisma's own tables, so leave it out of a query whose test expects only the application's and the extension's rows:

  ```sql
  -- Before
  select space, core_hash from prisma_contract.marker order by space;

  -- After
  select space, core_hash from _prisma.marker where space <> '_prisma' order by space;
  ```

- A test that creates Prisma's tables by hand must create them in `_prisma`. A test that runs the migration runner directly, without the commands above, now fails with `MIGRATION.PRISMA_TABLES_MISSING` until Prisma's tables exist. Create only Prisma's tables first, with the control client's `bringPrismaSpaceUpToDate()`, or with `applyInstalledContractSpace` from `@prisma/orm-toolchain/migration-tools/spaces` when the test has no control client. Do not use `prisma db init` or `dbInit` for this: they also bring the application's or the extension's own space to its contract, so a test of that space's first migration no longer starts from an empty database.

## `prisma-tables-api-breaks`

These changes reach code that uses the platform packages, or a facade's paths that re-export them, such as `@prisma/orm-postgres/target/contract-free`. Code that only builds and queries with a facade's client is not affected.

- **`buildControlTableBootstrapQueries` and `buildSignMarkerBootstrapQueries` are removed.** Prisma's own tables are now created by the Prisma space's migration. Code that ran these statements to prepare a database calls `bringPrismaSpaceUpToDate()` on the control client instead, or `applyInstalledContractSpace` from `@prisma/orm-toolchain/migration-tools/spaces` without a client.
- **`PostgresControlAdapter.markerLocation` is typed `string`.** It was the literal type `"prisma_contract.marker"`. Code that compared it with that literal compares with `"_prisma.marker"`, or uses the value it holds.
- **`MarkerReadResult` has a new kind, `earlier-release`.** A marker read returns it when Prisma's own tables are still in a release candidate's schema. Code that switches over the kinds exhaustively handles it, for example by reporting that the database needs `prisma db migrate`.
- **`SqlMigrationRunnerErrorCode` includes `MIGRATION.PRISMA_TABLES_MISSING`.** The runner returns it when asked to apply a space before Prisma's own tables exist. Code that switches over the codes exhaustively handles it.
- **`ControlClient` has a new required method, `bringPrismaSpaceUpToDate`.** Code that only calls a control client is not affected. Code that implements `ControlClient` itself, such as a test double or a `createClient` factory passed to `executeMigrateShowPlan`, adds the method; it may return `undefined` when the target carries no Prisma space.

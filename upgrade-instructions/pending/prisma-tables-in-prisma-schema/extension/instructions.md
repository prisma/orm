---
changes:
  - id: name-the-prisma-schema
    summary: |
      On PostgreSQL, Prisma's own tables (`marker`, `ledger` and `contract`) are now in the schema `_prisma`, not `prisma_contract`. Extension code and tests that name `prisma_contract` in SQL, such as a query of `prisma_contract.marker` or a test helper that drops the schema to reset the database, must name `_prisma`.
    detection:
      glob: "**/*"
      contains:
        - "prisma_contract"
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

- A test that reads the marker to check which contract a space was brought to:

  ```sql
  -- Before
  select space, core_hash from prisma_contract.marker order by space;

  -- After
  select space, core_hash from _prisma.marker order by space;
  ```

- A test that creates Prisma's tables by hand must create them in `_prisma`. A test that runs the migration runner directly, without the commands above, now fails with `MIGRATION.PRISMA_TABLES_MISSING` until Prisma's tables exist; set the database up with `prisma db init`, or with the control client's `dbInit`, first.

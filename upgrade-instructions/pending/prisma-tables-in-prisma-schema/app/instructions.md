---
changes:
  - id: prisma-tables-move-to-prisma-schema
    summary: |
      On PostgreSQL, Prisma's own tables (`marker`, `ledger` and `contract`) move from the schema `prisma_contract` to the schema `_prisma`. The first command that changes the database (`prisma db init`, `db update`, `db migrate` or `db sign`) renames the schema and keeps every row. Run one of them against each database once, with the new release, before the application on the new release reads it. It stops without changing anything when the role that runs it may not rename the schema, or when both schemas exist.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-postgres"\s*:'
  - id: name-the-prisma-schema
    summary: |
      Anything in the project that names the schema `prisma_contract` in its own SQL or scripts must name `_prisma` instead: grants in infrastructure code, scripts that drop or reset the database, monitoring queries, row-level-security setup, and tests that reset the database.
    detection:
      glob: "**/*"
      contains:
        - "prisma_contract"
---

# Prisma's own tables are in the `_prisma` schema

Prisma 8 keeps a few tables of its own in your PostgreSQL database. The `marker` table records which contract (the description of your data model that Prisma emits as `contract.json`) the database was last brought to, once for each contract space. A contract space is a set of tables with its own contract and migrations: the application's own, and one for each extension that brings tables, such as pgvector. The `ledger` table records each migration applied, and the `contract` table holds the contract of each migration. The release candidates kept these tables in a schema named `prisma_contract`. They are now in a schema named `_prisma`, and the table names are unchanged.

Prisma now creates and updates these tables with migrations of its own, which it applies before anything else. You run no extra command for this, and these migrations are not listed with your own.

## `prisma-tables-move-to-prisma-schema`

### What the database needs

The first command that changes the database, `prisma db init`, `prisma db update`, `prisma db migrate` or `prisma db sign`, run with the new release, brings Prisma's tables up to date before it reads anything else. On a database a release candidate set up, it renames the schema `prisma_contract` to `_prisma`. Every row is kept. Renaming a schema changes only PostgreSQL's catalogue, so it is instant however large the tables are.

For each database the project deploys to (development, staging, production), run the command the project already uses to change it, usually `prisma db migrate`, once with the new release. Do this before the application on the new release is deployed against that database.

Commands that only read the database do not rename anything: `prisma db verify`, `prisma migration status`, `prisma migration log`, a dry run of a command, and the check the client runs when it is first used. Pointed at a database that still has `prisma_contract`, they say that Prisma's own tables were written by an earlier release and name `prisma db migrate`. Run that command, then run the read again.

### When the command stops

The command checks the following before it renames, and stops without changing anything if one of them fails.

**The role that runs it may not rename the schema.** PostgreSQL lets a role rename a schema only if it has the privileges of the schema's owner and the CREATE privilege on the database. Creating tables never needed this. If an administrator role created `prisma_contract` and the role that runs migrations only has grants on it, the command stops and names the problem. This query names the owner:

```sql
SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'prisma_contract';
```

There are two fixes. Ask the user which one to use, because both need a person with the administrator role:

1. Run the command once as the role that owns `prisma_contract`. Later commands can run as the usual role again.
2. Give the schema to the role that runs migrations, then run the command as usual:

   ```sql
   ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>;
   ```

The migrating role also needs CREATE on the database. If it does not have it, grant it, or use the first fix.

**Both `prisma_contract` and `_prisma` exist.** Prisma cannot tell which schema holds the tables to keep, so it changes nothing. This happens when a release candidate's command-line tool was run against a database that the new release had already brought up to date: the older tool creates a new, empty `prisma_contract` beside `_prisma`. Count the rows of `marker` in each schema. If `prisma_contract.marker` has no rows and `_prisma.marker` has rows, the older tool created `prisma_contract`, and after a backup it can be dropped with `DROP SCHEMA "prisma_contract" CASCADE`. In every other case, stop and ask the user, because one of the schemas holds rows that would be lost.

**A table is in a form from before the release candidates.** Prisma checks the columns of each of its tables. A database set up by a `0.x` release can have tables in an older form, and those forms are not migrated. The command stops with an error that names the table and the column it expected. Stop and tell the user. Prisma's tables in such a database cannot be kept, but the application's own tables can: after a backup, drop the old schema (`DROP SCHEMA "prisma_contract" CASCADE`), then run `prisma db sign`, which checks that the database matches the contract and records it in a new `_prisma.marker`. The history of applied migrations in the old `ledger` is lost.

### After the database is brought up to date

A release candidate's application pointed at the database finds no marker in `prisma_contract`. It logs a warning and keeps running, so instances of the old application that run during a deploy keep working.

A release candidate's command-line tool must not be used against the database again. It would create a new, empty `prisma_contract` schema beside `_prisma`, and the next command of the new release then stops, as described above. Upgrade the `prisma` command-line tool in every place that runs it against the database, such as continuous integration and deploy scripts, together with the application.

## `name-the-prisma-schema`

Roles that were granted privileges on `prisma_contract`, such as `SELECT` on `prisma_contract.marker` for the application's role, keep them: PostgreSQL keeps grants when a schema is renamed. But anything that names the schema in its own text still names the old one.

Search the project for `prisma_contract`, outside `node_modules` and build output. Look in particular at:

- SQL files and migrations the project runs itself.
- Scripts that drop or reset the database, such as a `drop-db` or `reset` script, and test helpers that reset the database between tests.
- Infrastructure code that grants privileges, such as Terraform, Pulumi, Helm charts or SQL run by a provisioning step.
- Monitoring and alerting queries.
- Row-level-security setup.

Replace `prisma_contract` with `_prisma` in each. `_prisma` needs no quotes in SQL. For example:

```sql
-- Before
GRANT USAGE ON SCHEMA prisma_contract TO app;
GRANT SELECT ON prisma_contract.marker TO app;

-- After
GRANT USAGE ON SCHEMA _prisma TO app;
GRANT SELECT ON _prisma.marker TO app;
```

A script that drops Prisma's tables to reset a database should drop `_prisma`. If it also runs against databases that have not been brought up to date yet, keep a second statement that drops `prisma_contract`:

```ts
await client.query('DROP SCHEMA IF EXISTS _prisma CASCADE');
await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
```

A test that creates Prisma's tables by hand must create them in `_prisma`.

Prisma Studio reads these tables for its Migrations view. A version of Prisma Studio that reads `prisma_contract` does not find them once the database has been brought up to date. Update Prisma Studio to a version that reads `_prisma`.

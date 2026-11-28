---
changes:
  - id: prisma-tables-move-to-prisma-schema
    summary: |
      On PostgreSQL, Prisma's own tables move from the schema `prisma_contract` to the schema `_prisma`, and the `marker` table is replaced by two tables: `_prisma.signatures`, which records which contract each contract space was signed with, and `_prisma.config`, which holds the database's change policy and data protection policy. The first command that changes the database (`prisma db init`, `db update`, `db migrate` or `db sign`) renames the schema, moves the rows of `marker` into the two new tables, drops `marker`, and keeps everything Prisma recorded. Run one of them against each database once, with the new release, before the application on the new release reads it. After that, only the new release may change the database: a release candidate's command applies every migration again. The command stops without changing anything when the role that runs it does not own the schema and its tables or may not create in the database, when `_prisma` already exists beside `prisma_contract` and is not empty or is owned by another role, when one of Prisma's tables is in a form this release does not bring up to date, or when another object, such as a view, depends on `marker`.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-postgres"\s*:'
  - id: name-the-prisma-schema
    summary: |
      Anything in the project that names the schema `prisma_contract` in its own SQL or scripts must name `_prisma` instead: grants in infrastructure code, scripts that drop or reset the database, monitoring queries, row-level-security setup, and tests that reset the database. Anything that names the `marker` table must name `_prisma.signatures`, or `_prisma.config` for the policies. A grant on `marker` is dropped with the table. Once the database is brought up to date, a role that runs Prisma's commands (`prisma db verify`, `prisma migration status` and every command that changes the database) needs `SELECT` on both `_prisma.signatures` and `_prisma.config`. Only the application's client needs `SELECT` on `_prisma.signatures` alone. Migrations that have been planned are not edited.
    detection:
      glob: "**/*"
      contains:
        - "prisma_contract"
---

# Prisma's own tables are in the `_prisma` schema

Prisma 8 keeps a few tables of its own in your PostgreSQL database. The release candidates kept three, in a schema named `prisma_contract`:

- `marker` recorded which contract (the description of your data model that Prisma emits as `contract.json`) the database was last brought to, once for each contract space. A contract space is a set of tables with its own contract and migrations: the application's own, and one for each extension that brings tables, such as pgvector. From `8.0.0-rc.25` on, the application's row could also hold the database's policies, under its `meta` column.
- `ledger` records each migration applied.
- `contract` holds the contract of each migration.

They are now in a schema named `_prisma`, and `marker` is replaced by two tables:

- `_prisma.signatures` has one row for each contract space, with the columns `space`, `core_hash`, `profile_hash`, `invariants` and `signed_at`. `signed_at` is the release candidates' `updated_at`. The columns `contract_json`, `canonical_version`, `app_tag` and `meta` are gone.
- `_prisma.config` has at most one row, for the whole database. Its `policies` column holds the change policy and the data protection policy, in the form a ref's `policies` declares them, with every setting filled in. No row means the default policies.

`_prisma.ledger` and `_prisma.contract` are unchanged.

Prisma now creates and updates these tables with migrations of its own, which it applies before anything else. You run no extra command for this, and these migrations are not listed with your own.

## `prisma-tables-move-to-prisma-schema`

### What the database needs

The first command that changes the database, `prisma db init`, `prisma db update`, `prisma db migrate` or `prisma db sign`, run with the new release, brings Prisma's tables up to date before it reads anything else. On a database a release candidate set up, it renames the schema `prisma_contract` to `_prisma`. Then it copies each row of `marker` into `signatures`, copies the policies on the application's row, when it has them, into `config`, and drops `marker`. Everything Prisma recorded is kept; any other key a project wrote into `meta` is not. Renaming a schema changes only PostgreSQL's catalogue, so it is instant however large the tables are, and `marker` has only one row for each contract space.

For each database the project deploys to (development, staging, production), run the command the project already uses to change it, `prisma db migrate`, `prisma db update` or `prisma db sign`, once with the new release. Do this before the application on the new release is deployed against that database.

### Move every tool that changes the database to this release at once

Once a database has been brought up to date, a release candidate's `prisma db migrate`, or any other of its commands that change a database, does not see the records Prisma keeps in `_prisma`. It creates a new, empty `prisma_contract` schema, concludes that no migration was ever applied, and applies every migration again from the beginning. Operations whose result already holds are skipped. A data migration, or raw SQL with no check that its result already holds, runs again on live data.

So every service, deploy script and continuous-integration pipeline that changes the database must move to this release together, and from then on only the new release runs migrations against it. Tell the user this before the first database is brought up to date, and list every place in the project that runs a `prisma` command against a database.

The command renames the schema first, before its own checks. So a command that the database's change policy then refuses, such as `prisma db update` on a database whose policy permits only `db migrate`, or a command the user cancels at a prompt, has still renamed the schema. This is harmless: the rename and the move change only Prisma's own tables, keep every record, and are what the next command would do anyway. The command reads the policies it checks from `_prisma.config`, after the move.

Commands that only read the database do not rename anything: `prisma db verify`, `prisma migration status`, `prisma migration log`, `prisma db migrate --show` and a dry run of a command. Pointed at a database that still has `prisma_contract`, they stop with `CONTRACT.PRISMA_SPACE_BEHIND`, which says that the records Prisma keeps for itself are not up to date with the installed release of Prisma. It tells the user to run the command the project already uses to change its database: `prisma db migrate` in a project that applies migrations, `prisma db update` in one that changes its database with `db update`, or `prisma db sign` in one that only signs it. Each brings the records up to date before it does its usual work, so `prisma db migrate` also applies the pending migrations. This includes `prisma db verify --schema-only`. Run that command, then run the read again.

The application's check when the client is first used does not stop queries. On such a database it logs a warning with the same code, summary and advice, and runs the query. It logs the warning only when the application gives the client a `log`; by default the client says nothing.

### When the command stops

The command checks the following before it renames, and stops without changing anything if one of them fails.

**The role that runs it does not own the schema and its tables.** PostgreSQL lets a role rename a schema only if it has the privileges of the schema's owner and the CREATE privilege on the database. Later releases of Prisma change these tables with migrations of their own, such as one that adds a column, and this release drops `marker` after moving its rows; PostgreSQL lets a role alter or drop a table only if it has the privileges of the table's owner. So the command checks these privileges before it renames, though creating tables never needed either. If an administrator role created `prisma_contract` or its tables and the role that runs migrations only has grants on them, the command stops with `MIGRATION.PRECHECK_FAILED` and says that the role that runs it must have the privileges of the role that owns `prisma_contract`, or of the role that owns one of its tables. These queries name the owners:

```sql
SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'prisma_contract';
SELECT relname, relowner::regrole FROM pg_class WHERE relnamespace = to_regnamespace('prisma_contract') AND relkind = 'r';
```

Give the schema and its three tables to the role that runs migrations, then run the command as usual. This needs a person with the administrator role, so ask the user first:

```sql
ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>;
ALTER TABLE "prisma_contract"."marker" OWNER TO <migrating role>;
ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>;
ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>;
```

Running the command once as the role that owns them also works, but the schema and tables then stay owned by that role, so every later release whose migrations change Prisma's tables needs that role again. Prefer giving them to the role that runs migrations.

**The role that runs it does not have the CREATE privilege on the database.** The command stops with `MIGRATION.PRECHECK_FAILED` and says that the role that runs it must have the CREATE privilege on the database. This can happen even when the role owns `prisma_contract`. Ask the user whether to grant it, or to run the command once as a role that has it and also owns the schema and its tables. Only the rename needs it:

```sql
GRANT CREATE ON DATABASE <database> TO <migrating role>;
```

**Another object depends on `prisma_contract.marker`.** The command drops `marker` once its rows are moved, and PostgreSQL does not drop a table that a view, a function, a foreign key or another object depends on. The command stops with `MIGRATION.PRECHECK_FAILED` and changes nothing. Its message says that no object outside `prisma_contract.marker` may depend on it, then names each object with its schema, for example "In this database, those objects are view public.marker_view." A function that takes or returns `marker` rows, including an array of them, counts too. Show them to the user and ask whether to drop them; once the command has run, create each again over `_prisma.signatures`, or `_prisma.config` for the policies.

**`prisma_contract` exists and `_prisma` exists too.** When `_prisma` is empty, for example because someone created the schema by hand or provisioning code created it ahead of the upgrade, the command drops it before the rename, with a plain `DROP SCHEMA "_prisma"`. Any grants and default privileges set on that empty `_prisma` go with it; the renamed schema keeps the grants of `prisma_contract`. So apply changes to provisioning code that name `_prisma` after the first command has run against the database, or apply them again then.

The command checks two things first, and stops without changing anything if either fails:

- `_prisma` must be empty: it holds no object of any kind, not a table, view, sequence, function, type or anything else. When it holds anything, Prisma does not choose between the two schemas.
- The role that runs the command must have the privileges of the role that owns `_prisma`, because dropping a schema needs them. Ask the user whether to give the empty schema to the role that runs migrations, or to drop it:

  ```sql
  ALTER SCHEMA "_prisma" OWNER TO <migrating role>;
  -- or
  DROP SCHEMA "_prisma";
  ```

When `_prisma` is not empty, first list everything in it, as the check sees it. This lists every kind of object, including functions, types, sequences and extensions, which a list of tables does not show:

```sql
SELECT pg_describe_object(classid, objid, objsubid) FROM pg_depend
WHERE refclassid = 'pg_namespace'::regclass AND refobjid = to_regnamespace('_prisma') AND deptype = 'n';
```

If `_prisma` holds none of the tables `signatures`, `config`, `marker`, `ledger` and `contract`, what it holds is the project's own, not Prisma's records. Stop and ask the user, then either move each object to another schema (for example `ALTER FUNCTION "_prisma"."<function>"(<argument types>) SET SCHEMA <other schema>` or `ALTER TYPE "_prisma"."<type>" SET SCHEMA <other schema>`) and change the project's code that names it, or drop it. Then run the command again: it drops the now empty `_prisma` and renames `prisma_contract`.

If `_prisma` holds any of those tables, do not drop either schema before you know which holds the records. First list the tables in each:

```sql
SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('prisma_contract', '_prisma') AND c.relkind IN ('r', 'p', 'f', 'v', 'm') ORDER BY 1, 2;
```

This reads the catalogue, so it lists every table, partitioned table, foreign table and view whatever the role's privileges on it. Then count the rows of `marker`, `signatures` and `ledger` in each schema that has them. If the role may not read one of them, ask the user to run the count as a role that may. Stop and ask the user, because a schema that is dropped loses its rows.

**A table in `prisma_contract` is in a form from before the release candidates.** Prisma checks the columns of each of its tables. A database set up by a `0.x` release can have tables in an older form, and those forms are not migrated. The command stops with an error that names the table and the column it expected. Stop and tell the user. Prisma's tables in such a database cannot be kept, but the application's own tables can. First list everything in `prisma_contract` and show it to the user:

```sql
SELECT pg_describe_object(classid, objid, objsubid) FROM pg_depend
WHERE refclassid = 'pg_namespace'::regclass AND refobjid = to_regnamespace('prisma_contract') AND deptype = 'n';
```

The list also shows `sequence prisma_contract.ledger_id_seq`, which belongs to the `ledger` table and is dropped with it. If it holds anything other than Prisma's tables `marker`, `ledger` and `contract` and that sequence, ask the user whether to move each such object to another schema or drop it, and do neither without their approval. Then, after a backup and with the user's approval, drop Prisma's tables and the schema without `CASCADE`:

```sql
DROP TABLE IF EXISTS "prisma_contract"."marker", "prisma_contract"."ledger", "prisma_contract"."contract";
DROP SCHEMA "prisma_contract";
```

Without `CASCADE`, PostgreSQL refuses and names the object when something outside the schema, such as a view, a foreign key or a function, depends on one of these tables, or when the schema still holds something else. Show that error to the user and ask what to do; do not add `CASCADE`, which drops those objects too. Then run `prisma db sign`, which checks that the database matches the contract and records it in a new `_prisma.signatures`. The history of applied migrations in the old `ledger` is lost. No release before the release candidates recorded policies, so the database keeps the default policies it had.

**A table in `_prisma` is not in the form this release creates.** After the rename, Prisma checks the columns of each of its tables in `_prisma` too, because it reads and writes them only in the form it creates. The command stops with `MIGRATION.PRECHECK_FAILED`, names the table and the column it expected, and changes nothing. This happens when a table of that name in `_prisma` was not created by Prisma: for example, the project keeps a table of its own named `signatures`, `config`, `marker`, `ledger` or `contract` in a schema it created as `_prisma`. Stop and tell the user. Do not drop or change the table without asking. If it is the project's own table, it can be moved to another schema with `ALTER TABLE "_prisma"."<table>" SET SCHEMA <other schema>`, after which the command can run again; the project's code that names it must then name the other schema.

### After the database is brought up to date

A release candidate's application pointed at the database finds no marker in `prisma_contract` and keeps running, so instances of the old application that run during a deploy keep working. It logs a warning about the missing marker only when the application gives its client a `log`.

A release candidate's command-line tool must not be used against the database again. As the section on moving every tool at once says, it creates a new `prisma_contract` schema beside `_prisma`, writes its records there, and applies every migration again; the new release neither reads those records nor reports them. Its `prisma db verify` reports that the database is not signed and suggests `prisma db sign`, which would also write into a new `prisma_contract`.

If a release candidate's tool may have run against the database after it was brought up to date, check whether a `prisma_contract` schema exists again:

```sql
SELECT count(*) FROM pg_namespace WHERE nspname = 'prisma_contract';
```

If it does, the older tool ran migrations against the database from the beginning. List what it recorded:

```sql
SELECT space, migration_name, destination_core_hash FROM prisma_contract.ledger ORDER BY id;
```

Compare each row with `_prisma.ledger` by space and `destination_core_hash`, not by migration name. A database first set up by `prisma db init` has a ledger row with an empty `migration_name` for the contract `db init` reached, so a migration that leads to the same contract has a name only in `prisma_contract`.

- A row whose destination is also a destination in `_prisma.ledger` for the same space is a migration the older tool ran again. Its operations whose result already held were skipped, but its data migrations, and raw SQL with no such check, ran a second time.
- A row whose destination is not in `_prisma.ledger` is a migration only the older tool applied, and it is not in the new release's history.

Stop and tell the user what you found before dropping anything.

## `name-the-prisma-schema`

PostgreSQL keeps grants when a schema is renamed, so roles that were granted privileges on the schema `prisma_contract` or on its `ledger` and `contract` tables keep them. Grants on `prisma_contract.marker` do not carry over: the table is dropped once its rows are moved, and `_prisma.signatures` and `_prisma.config` are new tables, which only their owner and superusers may read, unless default privileges for the role that runs the command (`ALTER DEFAULT PRIVILEGES`) grant more. Anything that names the schema or the `marker` table in its own text still names the old one.

Search the project for `prisma_contract`, outside `node_modules` and build output. Look in particular at:

- SQL files the project runs itself.
- Migrations: do not edit a migration that has been planned. Its hash covers its SQL, so an edited migration fails to load with `MIGRATION.HASH_MISMATCH`. A migration that names `prisma_contract` and has already been applied to every database needs no change. If one will still run on a database that has not applied it, stop and tell the user: from this release it fails there, because the schema it names no longer exists, and the user decides how to replace it.
- Scripts that drop or reset the database, such as a `drop-db` or `reset` script, and test helpers that reset the database between tests.
- Infrastructure code that grants privileges, such as Terraform, Pulumi, Helm charts or SQL run by a provisioning step.
- Monitoring and alerting queries.
- Row-level-security setup.

Replace `prisma_contract` with `_prisma` in each of these, except planned migrations, which stay as they are. `_prisma` needs no quotes in SQL. Where one of them names the `marker` table, name the table that now holds what it uses:

- The contract a space was signed with, its hashes and its invariants: `_prisma.signatures`, which has the columns `space`, `core_hash`, `profile_hash`, `invariants` and `signed_at`. Use `signed_at` where it used `updated_at`. The columns `contract_json`, `canonical_version`, `app_tag` and `meta` are gone, and nothing replaces the first three.
- The change policy and the data protection policy, which it read from `meta` on the application's row (`meta -> 'policies'`): the `policies` column of `_prisma.config`, which has at most one row. No row means the default policies.

The application's role reads `_prisma.signatures` when the client is first used, to check which contract the database was signed with. It does not read `_prisma.config`. Without `SELECT` on `_prisma.signatures`, that check cannot read which contract the database was signed with, and queries still run. When the application gives its client a `log`, it logs a warning: `CONTRACT.MARKER_MISSING` ("Contract marker not found in database"), because Prisma looks for the table in `information_schema.tables`, which lists only tables the role has a privilege on. A client created with `verifyMarker: false` makes no such check.

A role that runs Prisma's commands reads more. `prisma db verify`, `prisma migration status` and every command that changes the database read the policies from `_prisma.config`, so that role needs `SELECT` on `_prisma.signatures` and on `_prisma.config`. Without `SELECT` on `_prisma.config`, the command stops with `CONTRACT.MARKER_READ_FAILED` and names `_prisma.config`; it never reads the default policies in their place. It stops the same way when row-level security applies to the role on `_prisma.config`, because a row that row-level security hides cannot be told apart from no row. For example, for the application's role:

For example, for the application's role, `app`:

```sql
-- Before
GRANT USAGE ON SCHEMA prisma_contract TO app;
GRANT SELECT ON prisma_contract.marker TO app;

-- After
GRANT USAGE ON SCHEMA _prisma TO app;
GRANT SELECT ON _prisma.signatures TO app;
```

Apply a change like this to each database after the first command of the new release has run against it: before that, `_prisma` and its new tables do not exist, and the grants on the schema `prisma_contract` carry over in the rename anyway. The grant on `signatures` is needed from the moment that command has run, so apply it right after it, before the application on the new release is deployed. Do not make provisioning code create `_prisma` ahead of the upgrade to make such a grant succeed; the command drops an empty `_prisma` before the rename, with its grants.

A script that drops Prisma's tables to reset a database should drop `_prisma`. If it also runs against databases that have not been brought up to date yet, keep a second statement that drops `prisma_contract`:

```ts
await client.query('DROP SCHEMA IF EXISTS _prisma CASCADE');
await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
```

A test that creates Prisma's tables by hand must create them in `_prisma`.

Prisma Studio reads the `ledger` and `contract` tables for its Migrations view. A version of Prisma Studio before 0.36.0 reads them only from `prisma_contract`, so it does not find them once the database has been brought up to date. Use Prisma Studio 0.36.0 or later (`@prisma/studio-core` 0.36.0, published on 2026-11-27), which reads them from `_prisma`, and from `prisma_contract` on a database that has not been brought up to date yet.

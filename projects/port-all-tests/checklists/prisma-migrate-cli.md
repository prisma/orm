# Checklist — prisma/prisma migrate + CLI packages

Source: prisma/prisma@a6d01554528e016bea1467a072776b0e2b94dcba — packages/migrate/src/__tests__/, packages/cli/src/__tests__/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

Excluded from this segment (per inventory, unit-level and out of scope): `packages/migrate/src/__tests__/utils/ai-safety.test.ts` and `packages/migrate/src/__tests__/utils/unixSocket.test.ts`.

## packages/migrate

### packages/migrate/src/__tests__/Baseline.test.ts

- [ ] `Baselining > SQLite > should succeed` — full baseline flow (db pull, reset, migrate dev create-only, migrate dev, resolve --applied, deploy) on dev/prod SQLite dbs [providers: sqlite]

### packages/migrate/src/__tests__/DbCommand.test.ts

- [ ] `no params should return help` — bare `db` invocation calls help() [providers: none]
- [ ] `wrong flag` — unknown flag `--something` calls help() [providers: none]
- [ ] `help flag` — `--help` calls help() [providers: none]
- [ ] `unknown command` — unknown subcommand resolves to throw [providers: none]

### packages/migrate/src/__tests__/DbDrop.test.ts

- [ ] `drop > prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config (no-config fixture) [providers: none]
- [ ] `drop > requires --preview-feature flag` — errors without --preview-feature [providers: none]
- [ ] `drop > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `drop > with missing db should fail (prompt)` — prompt input mismatch when dev.db removed [providers: sqlite]
- [ ] `drop > with missing db should fail (--force)` — --force fails to delete missing SQLite db [providers: sqlite]
- [ ] `drop > should work (prompt)` — drops db after matching prompt input [providers: sqlite]
- [ ] `drop > should work (--force)` — drops db with --force [providers: sqlite]
- [ ] `drop > should work (-f)` — drops db with -f shorthand [providers: sqlite]
- [ ] `drop > should work with nested config and schema` — drops db using nested config file [providers: sqlite]
- [ ] `drop > should be cancelled (prompt)` — cancel prompt exits 130 with "Drop cancelled." [providers: sqlite]
- [ ] `drop > should ask for --force if not provided if CI` — errors requiring --force in CI/unattended [providers: sqlite]

### packages/migrate/src/__tests__/DbExecute.test.ts

- [ ] `db execute > prisma.config.ts > should require a datasource in the config` — DbExecute with a config lacking datasource.url rejects requiring datasource.url [providers: none]
- [ ] `db execute > generic > should fail if missing --file and --stdin` — rejects when neither --file nor --stdin given [providers: none]
- [ ] `db execute > generic > should fail if both --file and --stdin are provided` — rejects when both --file and --stdin given [providers: none]
- [ ] `db execute > generic > should fail if --file does no exists` — rejects when --file path does not exist [providers: none]
- [ ] `db execute > mongodb > should fail with not supported error when using MongoDB` — dbExecute not supported on MongoDB [providers: mongodb]
- [ ] `db execute > SQLite > should pass with --stdin` — runs SQL script piped via stdin through the bin [providers: sqlite]
- [ ] `db execute > SQLite > should pass with --file` — executes SQL script file successfully [providers: sqlite]
- [ ] `db execute > SQLite > should pass with schema folder fixture` — executes script with schema folder fixture [providers: sqlite]
- [ ] `db execute > SQLite > should pass using a transaction with --file` — executes script wrapped in BEGIN/COMMIT [providers: sqlite]
- [ ] `db execute > SQLite > non driver adapter > should pass when datasource is provided programmatically` — executes script with programmatic datasource [providers: all (noDriverAdapters)]
- [ ] `db execute > SQLite > non driver adapter > should pass with datasource pointing to file:dev.db` — executes script with file:dev.db datasource [providers: all (noDriverAdapters)]
- [ ] `db execute > SQLite > non driver adapter > should pass with empty script` — executes empty script successfully [providers: all (noDriverAdapters)]
- [ ] `db execute > SQLite > non driver adapter > should fail with P1013 error when datasource URL is invalid` — rejects P1013 for invalid URL [providers: all (noDriverAdapters)]
- [ ] `db execute > SQLite > non driver adapter > should create the SQLite database if it does not exist` — creates SQLite db when missing and runs script [providers: all (noDriverAdapters)]
- [ ] `db execute > SQLite > should fail when there is a database error` — rejects with "no such table" on DROP of missing table [providers: sqlite]
- [ ] `db execute > SQLite > should fail with invalid SQL error from database` — rejects with syntax error for non-SQL input [providers: sqlite]
- [ ] `db execute > postgres > should pass with --file` — executes SQL script file successfully [providers: postgres]
- [ ] `db execute > postgres > should pass with schema folder fixture` — executes script with schema folder fixture [providers: postgres]
- [ ] `db execute > postgres > should pass using a transaction with --file` — executes script in BEGIN/COMMIT [providers: postgres]
- [ ] `db execute > postgres > should pass with empty script` — executes empty script successfully [providers: postgres]
- [ ] `db execute > postgres > should fail if DROP DATABASE is attempted` — rejects DROP DATABASE inside multi-command string [providers: postgres]
- [ ] `db execute > postgres > should fail with P1013 error when datasource URL is invalid` — rejects P1013 invalid port [providers: postgres]
- [ ] `db execute > postgres > should fail with P1013 error when datasource provider is invalid` — rejects P1013 unrecognized scheme [providers: postgres]
- [ ] `db execute > postgres > should fail with P1001 error when datasource is unreachable` — rejects P1001 unreachable server [providers: postgres]
- [ ] `db execute > postgres > should fail with P1003 error when database does not exist` — rejects P1003 database missing [providers: postgres]
- [ ] `db execute > postgres > should fail with invalid SQL error from database` — rejects with syntax error for non-SQL input [providers: postgres]
- [ ] `db execute > cockroachdb > should pass with --file` — executes SQL script file successfully [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should pass with schema folder fixture` — executes script with schema folder fixture [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should pass using a transaction with --file` — executes script in BEGIN/COMMIT [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should pass with empty script` — executes empty script successfully [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should succeed if DROP DATABASE is attempted` — DROP/CREATE/DROP DATABASE succeeds (no Postgres limitation) [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should fail with P1013 error when datasource URL is invalid` — rejects P1013 invalid port [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should fail with P1013 error when datasource provider is invalid` — rejects P1013 unrecognized scheme [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should fail with P1001 error when datasource is unreachable` — rejects P1001 unreachable server [providers: cockroachdb]
- [ ] `db execute > cockroachdb > should fail with invalid SQL error from database` — rejects with cockroach syntax error [providers: cockroachdb]
- [ ] `db execute > mysql > should pass with --file` — executes SQL script file successfully [providers: mysql]
- [ ] `db execute > mysql > should pass with schema folder fixture` — executes script with schema folder fixture [providers: mysql]
- [ ] `db execute > mysql > should fail with empty script` — rejects "Query was empty" (MySQL-only) [providers: mysql]
- [ ] `db execute > mysql > should pass using a transaction with --file` — executes script in START TRANSACTION/COMMIT [providers: mysql]
- [ ] `db execute > mysql > should fail with P1013 error when datasource URL is invalid` — rejects P1013 invalid port [providers: mysql]
- [ ] `db execute > mysql > should fail with P1013 error when datasource provider is invalid` — rejects P1013 unrecognized scheme [providers: mysql]
- [ ] `db execute > mysql > should fail with P1001 error when datasource is unreachable` — rejects P1001 unreachable server [providers: mysql]
- [ ] `db execute > mysql > should fail with SQL error from database` — rejects dropping nonexistent database [providers: mysql]
- [ ] `db execute > mysql > should fail with invalid SQL error from database` — rejects with MySQL syntax error [providers: mysql]
- [ ] `db execute > sqlserver > should pass with --file` — executes SQL script file successfully [providers: sqlserver]
- [ ] `db execute > sqlserver > should pass with schema folder fixture` — executes script with schema folder fixture [providers: sqlserver]
- [ ] `db execute > sqlserver > should pass with empty script` — executes empty script successfully [providers: sqlserver]
- [ ] `db execute > sqlserver > should pass using a transaction with --file --schema` — executes BEGIN TRANSACTION/SELECT/COMMIT [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail if DROP DATABASE in a transaction with --file --schema` — rejects DROP DATABASE inside user transaction [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail with P1013 error when datasource URL is invalid` — rejects P1013 invalid property key [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail with P1013 error when datasource provider is invalid` — rejects P1013 unrecognized scheme [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail with P1001 error when datasource is unreachable` — rejects P1001 unreachable server [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail with SQL error from database` — rejects dropping nonexistent database [providers: sqlserver]
- [ ] `db execute > sqlserver > should fail with invalid SQL error from database` — rejects "Could not find stored procedure" [providers: sqlserver]

### packages/migrate/src/__tests__/DbPull/cockroachdb.test.ts

- [ ] `cockroachdb > basic introspection (with cockroachdb provider)` — `--print` introspects setup DB and outputs cockroachdb schema [providers: cockroachdb]
- [ ] `cockroachdb > basic introspection (with postgresql provider) should fail` — introspecting cockroachdb DB with a `postgresql` provider schema rejects with a provider-mismatch error [providers: cockroachdb]

### packages/migrate/src/__tests__/DbPull/mongodb.test.ts

- [ ] `MongoDB > basic introspection` — introspects into no-model.prisma, reports 1 model + 2 embedded docs with multi-type warnings [providers: mongodb]
- [ ] `MongoDB > introspection --force (existing models)` — `--force` re-introspects schema.prisma over existing models [providers: mongodb]
- [ ] `MongoDB > introspection --print (no existing models)` — `--print` outputs schema and emits multi-type warnings to stderr [providers: mongodb]
- [ ] `MongoDB > introspection --print --composite-type-depth=0 (no existing models)` — depth 0 collapses composites to Json[] [providers: mongodb]
- [ ] `MongoDB > introspection --print --composite-type-depth=1 (no existing models)` — depth 1 expands one composite level [providers: mongodb]
- [ ] `MongoDB > introspection --force --composite-type-depth=-1 (existing models)` — `--force` with depth -1 fully expands composites [providers: mongodb]
- [ ] `MongoDB > introspection --print --composite-type-depth=-1 (no existing models)` — `--print` depth -1 fully expands nested composite types [providers: mongodb]
- [ ] `MongoDB > introspection with --force` — `--force` re-introspects into schema.prisma with warnings [providers: mongodb]
- [ ] `MongoDB > re-introspection should error (not supported) (existing models)` — plain re-introspection rejects since MongoDB re-introspection is unsupported [providers: mongodb]

### packages/migrate/src/__tests__/DbPull/mysql.test.ts

- [ ] `mysql > basic introspection` — `--print` introspects setup DB and outputs mysql schema with native types/indexes [providers: mysql]

### packages/migrate/src/__tests__/DbPull/postgresql-extensions.test.ts

- [ ] `postgresql-extensions > introspection should succeed and add extensions property to the schema.prisma file` — introspection adds `extensions = [citext(...)]` and postgresqlExtensions preview feature [providers: postgres]
- [ ] `postgresql-extensions > re-introspection should succeed and keep defined extension in schema.prisma file` — re-introspection preserves the citext extension in schema [providers: postgres]

### packages/migrate/src/__tests__/DbPull/postgresql-missing-database.test.ts

- [ ] `postgresql - missing database > basic introspection` — `--print` against a non-existent database rejects with P1003 [providers: postgres]

### packages/migrate/src/__tests__/DbPull/postgresql-multischema.test.ts

- [ ] `postgresql-multischema > without datasource property \`schemas\` it should error with P4001, empty database` — schema without `schemas` rejects with P4001 [providers: postgres]
- [ ] `postgresql-multischema > datasource property \`schemas=[]\` should error with P1012, array can not be empty` — empty `schemas` array rejects with P1012 [providers: postgres]
- [ ] `postgresql-multischema > datasource property \`schemas=["base", "transactional"]\` should succeed` — two-schema introspection succeeds with rename warnings for duplicate names [providers: postgres]
- [ ] `postgresql-multischema > datasource property \`schemas=["base"]\` should succeed` — single-schema introspection succeeds, no warnings [providers: postgres]
- [ ] `postgresql-multischema > datasource property \`schemas=["does-not-exist"]\` should error with P4001, empty database` — non-existent schema rejects with P4001 [providers: postgres]
- [ ] `postgresql-multischema > datasource property \`schemas=["does-not-exist", "base"]\` should succeed` — mix of existing and non-existent schema succeeds on the existing one [providers: postgres]

### packages/migrate/src/__tests__/DbPull/postgresql-views.test.ts

- [ ] `postgresql-views > engine output > no preview feature > \`views\` is null` — engine.introspect returns views=null without the views preview feature [providers: postgres]
- [ ] `postgresql-views > engine output > with preview feature and no views defined > \`views\` is [] and no views folder is created` — views=[] and no views folder written [providers: postgres]
- [ ] `postgresql-views > engine output > with preview feature and no views defined > \`views\` is [] and an empty existing views folder is deleted` — empty existing views dir deleted after introspect [providers: postgres]
- [ ] `postgresql-views > engine output > with preview feature and no views defined > \`views\` is [] and a non-empty existing views folder is kept` — non-empty views dir (README.md) preserved [providers: postgres]
- [ ] `postgresql-views > with preview feature, views defined and then removed > re-introspection with views removed` — views files created then folder removed after DB views dropped on re-introspect [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > basic introspection` — introspection writes public/work view .sql files [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > introspection from prisma/schema.prisma creates view definition files` — view .sql files created next to prisma/schema.prisma (needs move) [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > introspection from custom/schema/dir/schema.prisma creates view definition files` — view files created in custom schema dir via --schema arg [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > introspection from non-standard-schema.prisma creates view definition files` — view files created for non-standard schema filename via --schema arg [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > introspection from schema.prisma creates view definition files` — view files created for root schema.prisma, no move/args [providers: postgres]
- [ ] `postgresql-views > with preview feature and views defined > extraneous empty subdirectories should be deleted and top files kept in views directory on introspect` — empty subdirs pruned, top-level extraneous files kept in views dir [providers: postgres]
- [ ] `postgresql-views > no preview > basic introspection` — without preview feature no views folder is created [providers: postgres]
- [ ] `postgresql-views > no preview > introspect with already existing files in "views"` — without preview feature existing views files/dirs are left untouched [providers: postgres]

### packages/migrate/src/__tests__/DbPull/postgresql.test.ts

- [ ] `postgresql > basic introspection` — `--print` introspects setup DB and outputs postgres schema [providers: postgres]
- [ ] `postgresql > empty or incomplete schema > basic introspection config + empty schema` — empty schema rejects with "no datasource" error [providers: postgres]
- [ ] `postgresql > empty or incomplete schema > basic introspection config + schema with no linebreak after generator block` — generator-only schema rejects with "no datasource" error [providers: postgres]
- [ ] `postgresql > empty or incomplete schema > introspection with postgresql provider but schema has a sqlite provider should fail` — sqlite-provider schema with postgres URL rejects with P1013 invalid-protocol error [providers: postgres]

### packages/migrate/src/__tests__/DbPull/schema-folder.test.ts

- [ ] `reintrospection - no changes` — folder-schema re-introspection with no DB changes keeps split .prisma files [providers: sqlite] [skipped]
- [ ] `reintrospection - with --print` — `--print` outputs folder schema with per-file `// path` comments [providers: sqlite] [skipped]
- [ ] `reintrospection - new model` — new DB model written into introspected.prisma in schema folder [providers: sqlite]
- [ ] `reintrospection - new model - existing introspected.prisma` — new model appended to existing introspected.prisma [providers: sqlite]
- [ ] `reintrospection - new field` — new DB field merged into folder schema [providers: sqlite]
- [ ] `reintrospection - remove model` — removed DB model dropped from folder schema [providers: sqlite]
- [ ] `reintrospection - invalid schema with --force` — `--force` overwrites invalid folder schema into introspected.prisma [providers: sqlite]

### packages/migrate/src/__tests__/DbPull/sqlite.test.ts

- [ ] `D1 > should succeed with listLocalDatabases() when a single local Cloudflare D1 database exists` — `--print` introspects a single local D1 sqlite DB [providers: d1]
- [ ] `D1 > should succeed when reintrospecting with listLocalDatabases() when a single local Cloudflare D1 database exists` — re-introspection of single local D1 DB writes 2 models [providers: d1]
- [ ] `common/sqlite > basic introspection` — `--print` introspects sqlite DB and outputs schema [providers: sqlite]
- [ ] `common/sqlite > introspection --force` — `--print --force` introspects overwriting relation field names [providers: sqlite]
- [ ] `common/sqlite > using classic engine > basic introspection with config` — `--print` with `file:./dev.db` config introspects schema [providers: sqlite]
- [ ] `common/sqlite > using classic engine > basic introspection with schema missing file: prefix should fail` — URL without `file:` prefix rejects with P1013 [providers: sqlite]
- [ ] `common/sqlite > using classic engine > --url overrides config datasource URL when datasource exists in config` — `--url` overrides existing config datasource URL [providers: sqlite]
- [ ] `common/sqlite > using classic engine > --url works when no datasource exists in config` — `--url` works with no config datasource [providers: sqlite]
- [ ] `common/sqlite > should succeed when schema and db do match` — re-introspection succeeds with no output when schema matches DB [providers: sqlite]
- [ ] `common/sqlite > should succeed and keep changes to valid schema and output warnings` — re-introspection preserves @@map renames and warns [providers: sqlite]
- [ ] `common/sqlite > should succeed and keep changes to valid schema and output warnings when using --print` — `--print` keeps renames, warns on stderr, leaves file unchanged [providers: sqlite]
- [ ] `common/sqlite > should succeed when schema and db do not match` — re-introspection succeeds writing 3 models when histories diverge [providers: sqlite]
- [ ] `common/sqlite > should fail when db is missing` — missing DB rejects with P1003 [providers: sqlite]
- [ ] `common/sqlite > should fail when db is empty` — empty DB rejects with P4001 [providers: sqlite]
- [ ] `common/sqlite > should fail when Prisma schema is missing` — missing schema.prisma rejects with not-found error [providers: sqlite]
- [ ] `common/sqlite > should fail when schema is invalid` — invalid schema rejects with P1012 validation error [providers: sqlite]
- [ ] `common/sqlite > should succeed when schema is invalid and using --force` — `--force` overwrites invalid schema and succeeds [providers: sqlite]

### packages/migrate/src/__tests__/DbPull/sqlserver.test.ts

- [ ] `SQL Server > basic introspection` — `--print` introspects sqlserver DB and outputs schema (custom PK name) [providers: sqlserver]
- [ ] `sqlserver-multischema > without datasource property \`schemas\` it should error with P4001, empty database` — schema without `schemas` rejects with P4001 [providers: sqlserver]
- [ ] `sqlserver-multischema > datasource property \`schemas=[]\` should error with P1012, array can not be empty` — empty `schemas` array rejects with P1012 [providers: sqlserver]
- [ ] `sqlserver-multischema > datasource property \`schemas=["base", "transactional"]\` should succeed` — two-schema introspection with dup-name renames [providers: sqlserver] [skipped]
- [ ] `sqlserver-multischema > datasource property \`schemas=["base"]\` should succeed` — single-schema introspection succeeds with sanitized PK names [providers: sqlserver]
- [ ] `sqlserver-multischema > datasource property \`schemas=["does-not-exist"]\` should error with P4001, empty database` — non-existent schema rejects with P4001 [providers: sqlserver]
- [ ] `sqlserver-multischema > datasource property \`schemas=["does-not-exist", "base"]\` should succeed` — mix of existing/non-existent schema succeeds on existing [providers: sqlserver]
- [ ] `sqlserver-multischema > url with \`?schema=does-not-exist\` should error with P4001, empty database` — URL `?schema=does-not-exist` rejects with P4001 [providers: sqlserver]
- [ ] `sqlserver-multischema > url with \`?schema=base\` should succeed` — URL `?schema=base` scopes introspection to base schema [providers: sqlserver]

### packages/migrate/src/__tests__/DbPush.test.ts

- [ ] `push > prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config [providers: none]
- [ ] `push > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `push > should fail if nativeTypes VarChar on sqlite` — P1012 native type VarChar unsupported for sqlite [providers: sqlite]
- [ ] `push > already in sync` — no-op when db already in sync [providers: sqlite]
- [ ] `push > should work with nested config and schema` — pushes using nested config file [providers: sqlite]
- [ ] `push > should load extensions from the config` — --force-reset loads postgres extensions from config (inDockerIt, skipped if TEST_NO_DOCKER) [providers: postgres]
- [ ] `push > should ask for --accept-data-loss if not provided in CI` — errors requiring --accept-data-loss in CI [providers: sqlite]
- [ ] `push > dataloss warnings accepted (prompt)` — proceeds when data-loss prompt accepted [providers: sqlite]
- [ ] `push > dataloss warnings cancelled (prompt)` — cancel prompt exits 130 "Push cancelled." [providers: sqlite]
- [ ] `push > --accept-data-loss flag` — proceeds with data-loss via flag [providers: sqlite]
- [ ] `push > %s triggers the AI safety checkpoint` — flag triggers Claude Code safety abort [each] [providers: sqlite]
- [ ] `push > unexecutable - drop allowed (--force-reset)` — --force-reset resets and shrinks db size [providers: sqlite]
- [ ] `push > unexecutable - drop refused` — cancel prompt exits 130 "Push cancelled." [providers: sqlite]
- [ ] `push > unexecutable - should ask for --force-reset in CI` — errors requiring --force-reset for unexecutable change in CI [providers: sqlite]
- [ ] `push > --url overrides config datasource URL when datasource exists in config` — --url wins over config datasource [providers: sqlite]
- [ ] `push > --url works when no datasource exists in config` — --url used when config has no datasource [providers: sqlite]
- [ ] `postgres > --force-reset should succeed and display a log` — --force-reset resets postgres and logs [providers: postgres]
- [ ] `postgres > should exclude external tables` — external tables not modified/warned [providers: postgres]
- [ ] `postgres-multischema > multiSchema: --force-reset should succeed and display a log` — --force-reset resets multi-schema postgres [providers: postgres]
- [ ] `push existing-db with mongodb > --force-reset should succeed and print a log` — --force-reset resets mongodb and logs [providers: mongodb]
- [ ] `push existing-db with mongodb > does not create data loss warnings` — mongodb push produces no data-loss warnings [providers: mongodb]

### packages/migrate/src/__tests__/DbSeed.test.ts

- [ ] `seed > from prisma.config.ts > prints helpful message when no seed is configured` — helpful message when no seed configured [providers: none]
- [ ] `seed > from prisma.config.ts > skips deprecated package.json config` — ignores deprecated package.json seed, runs config seed.js [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.js` — runs node seed.js from config [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.js with -- extra args should succeed` — merges config + CLI extra args after -- [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.js with extra args but missing -- should throw with specific message` — errors suggesting -- separator [providers: sqlite]
- [ ] `seed > from prisma.config.ts > one broken seed.js file` — broken seed exits 1 with error message [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.ts` — runs ts-node seed.ts from config [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.ts - ESM` — runs ESM seed.ts via ts-node/esm loader after npm i [providers: sqlite]
- [ ] `seed > from prisma.config.ts > seed.sh` — runs shell seed.sh from config [providers: sqlite]

### packages/migrate/src/__tests__/ensureDatabaseExists.test.ts

- [ ] `SQLite > can create database - sqlite` — ensureDatabaseExists creates SQLite dev.db from schema-only-sqlite fixture [providers: sqlite]
- [ ] `SQLite > can create database - sqlite - folder` — ensureDatabaseExists creates SQLite dev.db from schema-folder-sqlite fixture [providers: sqlite]

### packages/migrate/src/__tests__/handlePanic.introspect.test.ts

- [ ] `introspection panic > force panic` — DbPull with FORCE_PANIC_SCHEMA_ENGINE throws artificial debugPanic error [providers: sqlite]

### packages/migrate/src/__tests__/handlePanic.migrate.test.ts

- [ ] `handlePanic migrate > engine panic no interactive mode in CI` — Migrate.createMigration with FORCE_PANIC_SCHEMA_ENGINE surfaces RustPanic (LIFT_CLI area, rustStack) non-interactively [providers: unknown (handle-panic fixture, forced panic, DB-agnostic)]

### packages/migrate/src/__tests__/introspection/introspection.test.ts

- [ ] `introspection basic` — engine.getDatabaseVersion + introspect on sqlite schema returns expected model files snapshot [providers: sqlite]

### packages/migrate/src/__tests__/listMigrations.test.ts

- [ ] `listMigrations > SQLite > lists migrations without error if the directory does not exist` — returns empty migrationDirectories and null lockfile when dir missing [providers: sqlite]
- [ ] `listMigrations > SQLite > lists migrations with directory contents, if they are readable` — returns lockfile content and 2 migration directories with SQL contents [providers: sqlite]
- [ ] `listMigrations > gracefully handles non accessible files` — non-readable migration file yields error tag (EACCES), readable one yields ok tag (non-win32) [providers: sqlite]

### packages/migrate/src/__tests__/local-clouflare-d1-db-e2e.test.ts

- [ ] `d1 local > d1 migration workflow > changing_all_referenced_columns_of_foreign_key_works` — migrate diff + wrangler apply for changing all FK-referenced columns (expected-fail: FK mismatch) [providers: d1]
- [ ] `d1 local > d1 migration workflow > migration_tests::existing_data::primary_key_migrations_do_not_cause_data_loss` — PK type change migration applies without data loss via migrate diff + wrangler [providers: d1]
- [ ] `d1 local > d1 migration workflow > relations::adding_mutual_references_on_existing_tables_works` — migrate diff adding mutual FK references (expected-fail: FK mismatch) [providers: d1]
- [ ] `d1 local > d1 migration workflow > issue #24208 - broken migrations with relations` — rename field migration with relations applies correctly (regression #24208) [providers: d1]
- [ ] `d1 local > d1 migration workflow > incremental changes succeed until foreign keys are violated` — incremental migrations apply until FK violation triggers rollback, verified via table_info [providers: d1]

### packages/migrate/src/__tests__/MigrateCommand.test.ts

- [ ] `no params should return help` — bare `migrate` invocation calls help() [providers: none]
- [ ] `wrong flag` — unknown flag `--something` calls help() [providers: none]
- [ ] `help flag` — `--help` calls help() [providers: none]
- [ ] `unknown command` — unknown subcommand resolves to throw [providers: none]

### packages/migrate/src/__tests__/MigrateDeploy.test.ts

- [ ] `prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config [providers: none]
- [ ] `common > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `SQLite > no unapplied migrations` — "No pending migrations to apply." with empty migrations [providers: sqlite]
- [ ] `SQLite > should work with nested config and schema` — deploy no-op via nested config [providers: sqlite]
- [ ] `SQLite > 1 unapplied migration` — applies one migration, second run no-op [providers: sqlite]
- [ ] `SQLite > 1 unapplied migration (folder)` — applies migration from schema folder, second run no-op [providers: sqlite]
- [ ] `SQLite > should throw if database is not empty` — P3005 non-empty db needs baseline [providers: sqlite]
- [ ] `postgres > should fail if url is prisma://` — errors on Accelerate/prisma:// URL [providers: postgres]
- [ ] `postgres > should work if direct URL is set via config` — deploy succeeds with direct URL in config [providers: postgres]

### packages/migrate/src/__tests__/MigrateDev.test.ts

- [ ] `prisma.config.ts > should require a datasource in the config` — MigrateDev with config lacking datasource.url rejects requiring datasource.url [providers: none]
- [ ] `common > invalid schema` — invalid config schema fails P1012 validation before connect [providers: none]
- [ ] `common > provider array should fail` — provider given as array fails P1012 validation [providers: none]
- [ ] `common > wrong flag` — unknown flag triggers help output [providers: none]
- [ ] `common > help flag` — --help triggers help output [providers: none]
- [ ] `common > should fail if no schema file` — rejects when no Prisma schema found [providers: none]
- [ ] `common > dev should error in unattended environment` — rejects because environment is non-interactive [providers: sqlite]
- [ ] `SQLite > empty schema` — already-in-sync message for empty schema config [providers: sqlite]
- [ ] `SQLite > should work with nested config and schema` — creates/applies migration with nested config path [providers: sqlite]
- [ ] `SQLite > --url overrides config datasource URL when datasource exists in config` — --url overrides config datasource and applies first migration [providers: sqlite]
- [ ] `SQLite > --url works when no datasource exists in config` — --url creates datasource and applies first migration [providers: sqlite]
- [ ] `SQLite > first migration (--name)` — creates first migration with --name and migration_lock.toml [providers: sqlite]
- [ ] `SQLite > first migration (--name) (folder)` — creates first migration in schema folder layout [providers: sqlite]
- [ ] `SQLite > first migration (prompt)` — prompts for name, truncates long name, applies migration [providers: sqlite]
- [ ] `SQLite > snapshot of sql` — snapshots generated migration.sql content [providers: sqlite]
- [ ] `SQLite > draft migration and apply (prompt)` — --create-only draft via prompt then apply [providers: sqlite]
- [ ] `SQLite > draft migration with empty schema (prompt)` — --create-only draft with empty schema via prompt [providers: sqlite]
- [ ] `SQLite > draft migration and apply (--name)` — --create-only draft with --name then apply [providers: sqlite]
- [ ] `SQLite > transition-db-push-migrate (refuses to reset)` — refuses reset on drift, exits 130 [providers: sqlite]
- [ ] `SQLite > edited migration and unapplied empty draft` — reset then dev reports already in sync [providers: sqlite]
- [ ] `SQLite > removed applied migration and unapplied empty draft` — reset after removing migration then prompt for new change [providers: sqlite]
- [ ] `SQLite > broken migration should fail` — broken migration fails P3006 syntax error [providers: sqlite]
- [ ] `SQLite > existingdb: has a failed migration` — failed migration fails P3006 shadow db [providers: sqlite]
- [ ] `SQLite > existing-db-1-migration edit migration with broken sql` — editing applied migration with broken SQL fails P3006 [providers: sqlite]
- [ ] `SQLite > existingdb: 1 unapplied draft` — applies single unapplied draft migration [providers: sqlite]
- [ ] `SQLite > existingdb: 1 unapplied draft + 1 schema change` — applies draft then creates migration for schema change [providers: sqlite]
- [ ] `SQLite > existingdb: 1 unexecutable schema change` — rejects unexecutable change (NULL values) [providers: sqlite]
- [ ] `SQLite > existingdb: 1 unexecutable schema change with --create-only should succeed` — --create-only succeeds with warning on unexecutable change [providers: sqlite]
- [ ] `SQLite > existingdb: 1 warning from schema change (prompt yes)` — warning accepted (prompt y) applies migration [providers: sqlite]
- [ ] `SQLite > existingdb: 1 warning from schema change (prompt no)` — warning declined cancels migration, exits 130 [providers: sqlite]
- [ ] `SQLite > one seed.ts file in prisma.config.ts` — runs migrate dev with seed configured in prisma.config.ts [providers: sqlite]
- [ ] `SQLite > provider switch: postgresql to sqlite` — provider switch fails P3019 [providers: sqlite]
- [ ] `postgres > schema only` — creates/applies first migration, stderr schema loaded [providers: postgres]
- [ ] `postgres > schema only with shadowdb` — creates/applies migration using shadowdb config [providers: postgres]
- [ ] `postgres > create first migration` — creates/applies first migration [providers: postgres]
- [ ] `postgres > create first migration with nativeTypes` — creates/applies first migration with native types [providers: postgres]
- [ ] `postgres > draft migration and apply (--name)` — --create-only draft with --name then apply [providers: postgres]
- [ ] `postgres > existingdb: create first migration` — creates/applies first migration with --name [providers: postgres]
- [ ] `postgres > need to reset prompt: (no) should succeed` — dbExecute then migrate dev reset prompt scenario [skipped] [providers: postgres]
- [ ] `postgres > regression: enum array column type is introspected properly (gh-22456)` — reset then dev creates migration, second run in sync [providers: postgres]
- [ ] `postgres > external tables` — external tables excluded from migration, FK references external table [providers: postgres]
- [ ] `cockroachdb > schema only` — creates/applies first migration [providers: cockroachdb]
- [ ] `cockroachdb > schema only with shadowdb` — creates/applies migration using shadowdb config [providers: cockroachdb]
- [ ] `cockroachdb > create first migration` — creates/applies first migration [providers: cockroachdb]
- [ ] `cockroachdb > create first migration with nativeTypes` — creates/applies first migration with native types [providers: cockroachdb]
- [ ] `cockroachdb > draft migration and apply (--name)` — --create-only draft with --name then apply [providers: cockroachdb]
- [ ] `cockroachdb > existingdb: create first migration` — creates/applies first migration with --name [providers: cockroachdb]
- [ ] `mysql > schema only` — creates/applies first migration [providers: mysql]
- [ ] `mysql > schema only with shadowdb` — creates/applies migration using shadowdb config [providers: mysql]
- [ ] `mysql > create first migration` — creates/applies first migration [providers: mysql]
- [ ] `mysql > draft migration and apply (--name)` — --create-only draft with --name then apply [providers: mysql]
- [ ] `mysql > existingdb: create first migration` — creates/applies first migration with --name [providers: mysql]
- [ ] `SQL Server > schema only` — creates/applies first migration [providers: sqlserver]
- [ ] `SQL Server > schema only with shadowdb` — creates/applies migration using shadowdb config [providers: sqlserver]
- [ ] `SQL Server > create first migration` — creates/applies first migration [providers: sqlserver]
- [ ] `SQL Server > draft migration and apply (--name)` — --create-only draft with --name then apply [providers: sqlserver]
- [ ] `SQL Server > existingdb: create first migration` — creates/applies first migration with --name [providers: sqlserver]

### packages/migrate/src/__tests__/MigrateDiff.test.ts

- [ ] `migrate diff > D1 > should succeed when --from-config-datasource and a single local Cloudflare D1 database exists` — diffs D1 db to empty --script, drops Post/User [providers: all (noDriverAdapters)]
- [ ] `migrate diff > D1 > should succeed when --to-config-datasource and a single local Cloudflare D1 database exists` — diffs empty to D1 config datasource --script [providers: all (noDriverAdapters)]
- [ ] `migrate diff > D1 > should succeed when --from-config-datasource and a single local Cloudflare D1 database exists` — diffs explicit D1 file datasource to empty --script (duplicate title, uses setDatasource file:) [providers: all (noDriverAdapters)]
- [ ] `migrate diff > D1 > should succeed when --to-config-datasource and a single local Cloudflare D1 database exists` — diffs empty to explicit D1 file datasource, creates tables/index (duplicate title, uses setDatasource file:) [providers: all (noDriverAdapters)]
- [ ] `migrate diff > generic > wrong flag` — unknown flag triggers help output [providers: none]
- [ ] `migrate diff > generic > help flag` — --help triggers help output [providers: none]
- [ ] `migrate diff > generic > should fail if missing --from-... and --to-...` — rejects when both endpoints missing [providers: none]
- [ ] `migrate diff > generic > should fail if only --from-... is provided` — rejects when only --from given [providers: none]
- [ ] `migrate diff > generic > should fail if only --to-... is provided` — rejects when only --to given [providers: none]
- [ ] `migrate diff > generic > should fail if more than 1 --from-... is provided` — rejects multiple --from options [providers: none]
- [ ] `migrate diff > generic > should fail if more than 1 --to-... is provided` — rejects multiple --to options [providers: none]
- [ ] `migrate diff > generic > should fail for empty/empty` — rejects "Could not determine the connector" [providers: none]
- [ ] `migrate diff > generic > should fail with a hint when providing a %s parameter` — each flag param fails with a hint snapshot [each] [providers: none]
- [ ] `migrate diff > sqlite > should diff --from-empty --to-schema=./prisma/schema.prisma` — diffs empty to schema, added Blog table [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff --from-empty --to-schema=./prisma/schema (folder)` — diffs empty to schema folder, added Blog/User [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff --from-empty --to-schema=./prisma/schema.prisma --script` — diffs to script, CREATE TABLE Blog [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff --from-schema=./prisma/schema.prisma --to-empty` — diffs schema to empty, removed Blog [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff --from-schema=./prisma/schema (folder) --to-empty` — diffs schema folder to empty, removed Blog/User [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff --from-schema=./prisma/schema.prisma --to-empty --script` — diffs to script, DROP TABLE Blog [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff and write to output path` — writes diff script to --output file [providers: sqlite]
- [ ] `migrate diff > sqlite > should diff and write to output path if directory does not exist` — writes diff to output in nonexistent subdir [providers: sqlite]
- [ ] `migrate diff > sqlite > should fail with EACCES/EPERM when writing to output path which is read only` — rejects writing to read-only output file [providers: sqlite]
- [ ] `migrate diff > sqlite > non driver adapter > should fail --from-empty --to-config-datasource` — rejects P1003 db does not exist [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should fail --from-config-datasource --to-empty` — rejects P1003 db does not exist [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should fail if directory in path & sqlite file does not exist` — rejects P1003 when path dir/file missing [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should diff --from-empty --to-config-datasource` — diffs empty to introspected db, added tables/indexes [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should diff --from-empty --to-config-datasource with nested config and schema` — no difference detected with nested config [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should diff --from-config-datasource --to-empty with nested config and schema` — no difference detected with nested config [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > non driver adapter > should diff --from-empty --to-config-datasource --script` — diffs to script, CREATE TABLEs and indexes [providers: all (noDriverAdapters)]
- [ ] `migrate diff > sqlite > --exit-code > should exit with code 2 when diff is not empty without --script` — exits 2 on non-empty diff [providers: sqlite]
- [ ] `migrate diff > sqlite > --exit-code > should exit with code 2 when diff is not empty with --script` — exits 2 on non-empty diff with script [providers: sqlite]
- [ ] `migrate diff > mongodb > should diff --from-empty --to-schema=./prisma/schema.prisma` — diffs empty to schema, added Collection User [providers: mongodb]
- [ ] `migrate diff > mongodb > should diff --from-schema=./prisma/schema.prisma --to-empty` — no difference detected [providers: mongodb]
- [ ] `migrate diff > mongodb > should fail with not supported error with --script` — rejects "Rendering to a script is not supported on MongoDB" [providers: mongodb]
- [ ] `migrate diff > cockroachdb > should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script` — diffs db to schema, CREATE TABLE Blog [providers: cockroachdb]
- [ ] `migrate diff > postgres > should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script` — diffs db to schema, CREATE TABLE Blog [providers: postgres]
- [ ] `migrate diff > postgres > should exclude external tables from diff` — external table excluded, no difference detected [providers: postgres]
- [ ] `migrate diff > mysql > should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script` — diffs db to schema, CREATE TABLE Blog [providers: mysql]
- [ ] `migrate diff > sqlserver > should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script` — diffs db to schema, CREATE TABLE Blog in TRY/CATCH [providers: sqlserver]

### packages/migrate/src/__tests__/MigrateReset.test.ts

- [ ] `prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config [providers: none]
- [ ] `common > wrong flag` — unknown flag `--something` calls help() [providers: none]
- [ ] `common > help flag` — `--help` calls help() [providers: none]
- [ ] `common > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `reset > should work (prompt)` — resets db and reapplies migration after prompt yes [providers: sqlite]
- [ ] `reset > should work (--force)` — resets db with --force [providers: sqlite]
- [ ] `reset > should work with nested config and schema` — resets via nested config [providers: sqlite]
- [ ] `reset > should work with folder (--force)` — resets with schema folder migrations [providers: sqlite]
- [ ] `reset > with missing db` — resets successfully when db file missing [providers: sqlite]
- [ ] `reset > without the migrations directory should fail (prompt)` — resets successfully with no migrations dir after prompt yes [providers: sqlite]
- [ ] `reset > should be cancelled if user send n (prompt)` — cancel prompt exits 130 "Reset cancelled." [providers: sqlite]
- [ ] `reset > reset should error in unattended environment` — errors requiring --force in non-interactive env [providers: sqlite]
- [ ] `reset > reset - seed.js in prisma.config.ts` — reset runs seed configured in prisma.config.ts [providers: sqlite]

### packages/migrate/src/__tests__/MigrateResolve.test.ts

- [ ] `prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config [providers: none]
- [ ] `common > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `common > should fail if no --applied or --rolled-back` — errors requiring one of the flags [providers: sqlite]
- [ ] `common > should fail if both --applied or --rolled-back` — errors when both flags passed [providers: sqlite]
- [ ] `SQLite > should fail if no sqlite db - empty schema` — P1003 db does not exist [providers: sqlite]
- [ ] `SQLite > --applied should fail if migration doesn't exist` — P3017 migration not found [providers: sqlite]
- [ ] `SQLite > --applied should fail if migration is already applied` — P3008 already applied [providers: sqlite]
- [ ] `SQLite > --applied should fail if migration is not in a failed state` — P3008 already applied (space form) [providers: sqlite]
- [ ] `SQLite > --applied should work on a failed migration` — marks failed migration as applied [providers: sqlite]
- [ ] `SQLite > --applied should work on a failed migration (schema folder)` — marks failed migration applied with schema folder [providers: sqlite]
- [ ] `SQLite > --rolled-back should fail if migration doesn't exist` — P3011 never applied [providers: sqlite]
- [ ] `SQLite > --rolled-back should fail if migration is not in a failed state` — P3012 not in failed state [providers: sqlite]
- [ ] `SQLite > --rolled-back should work on a failed migration` — marks failed migration rolled back [providers: sqlite]
- [ ] `SQLite > --rolled-back works if migration is already rolled back` — repeated rollback idempotent [providers: sqlite]
- [ ] `postgres > should fail if no db - invalid url` — P1001 can't reach postgres server [providers: postgres]
- [ ] `cockroachdb > should fail if no db - invalid url` — P1001 can't reach cockroach server [providers: cockroachdb]

### packages/migrate/src/__tests__/MigrateStatus.test.ts

- [ ] `prisma.config.ts > should require a datasource in the config` — errors when datasource.url missing in config [providers: none]
- [ ] `common > should fail if no schema file` — errors when no schema found (empty fixture) [providers: none]
- [ ] `SQLite > should fail if no sqlite db - empty schema` — P1003 db does not exist [providers: sqlite]
- [ ] `SQLite > existing-db-1-failed-migration` — exits 1, reports failed migration guidance [providers: sqlite]
- [ ] `SQLite > should error when database needs to be baselined` — exits 1, db not managed by Migrate [providers: sqlite]
- [ ] `SQLite > existing-db-1-migration` — "Database schema is up to date!" [providers: sqlite]
- [ ] `SQLite > schema-folder-db-exists` — up to date with schema folder config [providers: sqlite]
- [ ] `SQLite > existing-db-1-migration-conflict` — exits 1, migration not yet applied [providers: sqlite]
- [ ] `SQLite > existing-db-brownfield` — exits 1, db not managed by Migrate [providers: sqlite]
- [ ] `SQLite > existing-db-warnings` — exits 1, db not managed by Migrate [providers: sqlite]
- [ ] `SQLite > reset` — up to date after reset fixture [providers: sqlite]
- [ ] `SQLite > existing-db-histories-diverge` — exits 1, divergent local/db histories [providers: sqlite]
- [ ] `postgres > should fail if cannot connect` — P1001 can't reach postgres server [providers: postgres]

### packages/migrate/src/__tests__/rpc.test.ts

- [ ] `applyMigrations > should succeed` — engine.applyMigrations returns empty appliedMigrationNames on existing-db-1-migration [providers: sqlite]
- [ ] `applyMigrations > should fail on existing brownfield db` — engine.applyMigrations rejects P3005 on non-empty brownfield db [providers: sqlite]
- [ ] `createDatabase > should succeed - ConnectionString - sqlite` — engine.createDatabase creates dev.db from ConnectionString datasource [providers: sqlite]
- [ ] `createDatabase > should succeed - Schema - postgresql` — engine.createDatabase rejects P1009 (database already exists) for Schema datasource [providers: postgres]
- [ ] `createMigration > should succeed - existing-db-1-migration` — createMigration generates timestamped migration name (non-draft) [providers: sqlite]
- [ ] `createMigration > draft should succeed - existing-db-1-migration` — createMigration generates draft migration name [providers: sqlite]
- [ ] `dbExecute > should succeed - sqlite` — engine.dbExecute runs SQL script returning null [providers: sqlite]
- [ ] `devDiagnostic > createMigration` — engine.devDiagnostic returns createMigration action for schema-only-sqlite [providers: sqlite]
- [ ] `devDiagnostic > reset because drift` — engine.devDiagnostic returns reset action with drift reason on conflict fixture [providers: sqlite]
- [ ] `diagnoseMigrationHistory > optInToShadowDatabase true should succeed - existing-db-1-migration` — diagnoseMigrationHistory with shadow DB opt-in returns clean history [providers: sqlite]
- [ ] `diagnoseMigrationHistory >  optInToShadowDatabase false should succeed - existing-db-1-migration` — diagnoseMigrationHistory without shadow DB returns clean history [providers: sqlite]
- [ ] `ensureConnectionValidity > should succeed when database exists - SQLite` — ensureConnectionValidity resolves {} when dev.db exists [providers: sqlite]
- [ ] `ensureConnectionValidity > should succeed when database exists - PostgreSQL` — ensureConnectionValidity resolves {} for Schema datasource against Postgres [providers: postgres]
- [ ] `ensureConnectionValidity > should fail when database does not exist - SQLite` — ensureConnectionValidity rejects P1003 for missing dev.db [providers: sqlite]
- [ ] `ensureConnectionValidity > should fail when server does not exist - PostgreSQL` — ensureConnectionValidity rejects P1001 for unreachable Postgres server [providers: postgres]
- [ ] `evaluateDataLoss > should succeed - schema-only-sqlite` — evaluateDataLoss reports 1 migration step, no warnings (unapplied) [providers: sqlite]
- [ ] `evaluateDataLoss > should succeed - existing-db-1-migration` — evaluateDataLoss reports 0 steps for already-applied migration [providers: sqlite]
- [ ] `getDatabaseVersion - PostgreSQL > [No params] should succeed` — getDatabaseVersion() returns string containing PostgreSQL [providers: postgres]
- [ ] `getDatabaseVersion - PostgreSQL > [SchemaPath] should succeed` — getDatabaseVersion with Schema datasource returns PostgreSQL [providers: postgres]
- [ ] `getDatabaseVersion - PostgreSQL > [ConnectionString] should succeed` — getDatabaseVersion with ConnectionString returns PostgreSQL [providers: postgres]
- [ ] `markMigrationRolledBack > should fail - existing-db-1-migration` — markMigrationRolledBack rejects P3012 for non-failed migration [providers: sqlite]
- [ ] `markMigrationRolledBack > existing-db-1-migration` — failed migration can be rolled back then marked applied; re-marking rejects P3008 [providers: sqlite]
- [ ] `markMigrationApplied > existing-db-1-migration` — markMigrationApplied resolves {} for a draft migration [providers: sqlite]
- [ ] `schemaPush > should succeed if SQLite database file is missing` — schemaPush executes 1 step even when dev.db missing [providers: sqlite]
- [ ] `schemaPush > should succeed without warning` — schemaPush executes 1 step with no warnings on existing-db-1-draft [providers: sqlite]
- [ ] `schemaPush > should return executedSteps 0 with warning if dataloss detected` — schemaPush without force returns 0 steps plus dataloss warning [providers: sqlite]
- [ ] `schemaPush > force should accept dataloss` — schemaPush with force executes 2 steps despite dataloss warning [providers: sqlite]

## packages/cli

### packages/cli/src/__tests__/artificial-panic.test.ts

- [ ] `artificial-panic introspection > schema-engine` — DbPull --print with FORCE_PANIC_SCHEMA_ENGINE throws a rust panic tagged LIFT_CLI [providers: none]
- [ ] `artificial-panic formatter > formatter` — Format with FORCE_PANIC_PRISMA_SCHEMA throws prisma-schema-wasm rust panic [providers: none]
- [ ] `artificial-panic get-config > get-config` — Validate with FORCE_PANIC_GET_CONFIG throws prisma-schema-wasm rust panic [providers: none]
- [ ] `artificial-panic validate > validate` — Validate with FORCE_PANIC_GET_DMMF throws prisma-schema-wasm rust panic [providers: none]
- [ ] `artificial-panic validate > format` — Format with FORCE_PANIC_GET_DMMF throws prisma-schema-wasm rust panic [providers: none]
- [ ] `artificial-panic getDMMF > getDMMF` — getDMMF with FORCE_PANIC_GET_DMMF throws prisma-schema-wasm rust panic [providers: none]

### packages/cli/src/__tests__/checkpoint.test.ts

- [ ] `should redact --option [value]` — redacts value following each sensitive CLI option [providers: none]
- [ ] `should redact --option=[value]` — redacts inline --option=value form for each sensitive option [providers: none]
- [ ] `should redact a PostgreSQL connection string` — redacts a postgresql --url value [providers: none]
- [ ] `should redact a MySQL connection string` — redacts a mysql --url value [providers: none]
- [ ] `should redact a MongoDB connection string` — redacts a mongodb+srv --url value [providers: none]
- [ ] `should redact a SQLite connection string` — redacts a file: --url value [providers: none]
- [ ] `should redact a SQL Server connection string` — redacts a sqlserver --url value [providers: none]
- [ ] `should redact a path with for example --schema` — redacts a --schema path argument [providers: none]
- [ ] `should redact a name with for example --name` — redacts a --name argument [providers: none]
- [ ] `should read data from Prisma schema` — reads providers/previewFeatures/provider from schema fixture [providers: sqlite]
- [ ] `should redact token from Platform commands` — redacts --token in platform command array [providers: none]
- [ ] `should redact a database url from Platform accelerate enable command` — redacts --url in platform accelerate enable [providers: none]

### packages/cli/src/__tests__/commands/CLI.test.ts

- [ ] `CLI > ensureNeededBinariesExist > should download schema engine` — validate with query-compiler schema triggers download of schema-engine binary [providers: none]
- [ ] `CLI > no params should return help` — parsing [] calls help once [providers: none]
- [ ] `CLI > wrong flag` — parsing an unknown flag calls help once [providers: none]
- [ ] `CLI > help flag` — parsing --help calls help once [providers: none]
- [ ] `CLI > unknown command` — parsing an unknown command resolves to a thrown error [providers: none]

### packages/cli/src/__tests__/commands/DebugInfo.test.ts

- [ ] `debug > should succeed when env vars are NOT set (undefined)` — DebugInfo output matches snapshot with all env vars unset/dimmed [providers: none]
- [ ] `debug > should succeed when env vars are set to empty` — DebugInfo output matches snapshot with env vars set to empty strings [providers: none]
- [ ] `debug > should succeed when env vars are set` — DebugInfo output matches snapshot with env vars populated (testIf non-win32) [providers: none]
- [ ] `debug > should succeed with --schema` — output contains resolved schema path when --schema provided [providers: none]
- [ ] `debug > should load schema located next to a nested config` — output contains schema path resolved next to a nested config [providers: none]
- [ ] `debug > should succeed with incorrect --schema path` — resolves with a could-not-load error message for a nonexistent schema path [providers: none]

### packages/cli/src/__tests__/commands/Format.test.ts

- [ ] `format > multi-schema-files > valid schemas > should prefer single file to the multi-schema alternatives` — format resolves single vs multi-schema paths, --check reports formatted [providers: none]
- [ ] `format > multi-schema-files > invalid schemas > parses multi schemas when the file containing the config blocks (`generator`, `datasource`) is valid` — format rejects P1012 missing argument in valid_config_file [providers: none]
- [ ] `format > multi-schema-files > invalid schemas > parses multi schemas when the file containing the config blocks (`generator`, `datasource`) is valid` — format rejects P1012 now() on Int in invalid_config_file [providers: none]
- [ ] `format > multi-schema-files > invalid schemas > reports error when schemas when the config blocks (`generator`, `datasource`) are invalid` — format throws P1012 unknown property in invalid_config_blocks [providers: none]
- [ ] `format > multi-schema-files > invalid schemas > fixes invalid relations across multiple schema files` — format adds missing backrelation across files, then validate passes [providers: none]
- [ ] `format > should add a trailing EOL` — format appends trailing newline to schema [providers: none]
- [ ] `format > should add missing backrelation` — format inserts missing backrelation field [providers: none]
- [ ] `format > should throw if schema is broken` — broken schema causes format to reject [providers: none]
- [ ] `format > should succeed and show a warning on stderr (preview feature deprecated)` — deprecated preview feature warns but format succeeds [providers: none]
- [ ] `format > should throw with an error and show a warning on stderr (preview feature deprecated)` — deprecated preview + error rejects P1012 with warning [providers: none]
- [ ] `format > should succeed and NOT show a warning when PRISMA_DISABLE_WARNINGS is truthy` — PRISMA_DISABLE_WARNINGS suppresses warning [providers: none]
- [ ] `format > check should fail on unformatted code` — `--check` on unformatted schema reports unformatted files [providers: none]
- [ ] `format > should load and check schema located next to a nested config` — `--config` resolves nested schema, --check reports unformatted [providers: none]

### packages/cli/src/__tests__/commands/Generate.test.ts

- [ ] `prisma.config.ts > should not require a datasource in the config by default` — generate resolves without datasource in config [providers: none]
- [ ] `prisma.config.ts > using `--sql` should require a datasource in the config` — `--sql` rejects when datasource.url absent [providers: none]
- [ ] `using cli > should work with a custom output dir` — generate emits client to custom output, prints stdout/stderr [providers: none]
- [ ] `using cli > should work with prisma schema folder` — `--schema=./prisma/schema` folder generates client [providers: none]
- [ ] `using cli > should display the right yarn command for custom outputs` — yarn import hint for custom output [providers: none]
- [ ] `using cli > should display the right npm command for custom outputs` — npm import hint for custom output [providers: none]
- [ ] `using cli > should display the right pnpm command for custom outputs` — pnpm import hint for custom output [providers: none]
- [ ] `using cli > displays basic instructions in default outputs` — default output prints basic import instructions [providers: none]
- [ ] `prisma-client-js should work with no models > with sqlite` — generate succeeds with no models (sqlite) [providers: sqlite]
- [ ] `prisma-client-js should work with no models > with mysql` — generate succeeds with no models (mysql) [providers: mysql]
- [ ] `prisma-client-js should work with no models > with postgresql` — generate succeeds with no models (postgresql) [providers: postgres]
- [ ] `prisma-client-js should work with no models > with sqlserver` — generate succeeds with no models (sqlserver) [providers: sqlserver]
- [ ] `prisma-client-js should work with no models > with mongo` — generate succeeds with no models (mongo) [providers: mongodb]
- [ ] `prisma-client should work with no models > with sqlite` — prisma-client generator succeeds with no models (sqlite) [providers: sqlite]
- [ ] `prisma-client should work with no models > with mysql` — prisma-client generator succeeds with no models (mysql) [providers: mysql]
- [ ] `prisma-client should work with no models > with postgresql` — prisma-client generator succeeds with no models (postgresql) [providers: postgres]
- [ ] `prisma-client should work with no models > with sqlserver` — prisma-client generator succeeds with no models (sqlserver) [providers: sqlserver]
- [ ] `should hide hints with --no-hints` — `--no-hints` omits import hints from stdout [providers: none]
- [ ] `should call the survey handler when hints are not disabled` — survey handler invoked when hints enabled [providers: none]
- [ ] `should not call the survey handler when hints are disabled` — survey handler skipped with `--no-hints` [providers: none]
- [ ] `should error with exit code 1 with incorrect schema` — broken schema project exits code 1 [providers: none]
- [ ] `should work with a custom generator` — custom generator runs and outputs its message [providers: none]
- [ ] `prisma-client-ts validation > should throw errors for an unknown compilerBuild` — invalid compilerBuild rejects for prisma-client-ts [providers: none]
- [ ] `prisma-client-js validation > should throw errors for an unknown compilerBuild` — invalid compilerBuild rejects for prisma-client-js [providers: none]
- [ ] `--schema from project directory > --schema relative path: should work` — relative `--schema` generates client [providers: none]
- [ ] `--schema from project directory > --schema relative path: should fail - invalid path` — nonexistent relative `--schema` rejects not-found [providers: none]
- [ ] `--schema from project directory > --schema absolute path: should work` — absolute `--schema` generates client [providers: none]
- [ ] `--schema from project directory > --schema absolute path: should fail - invalid path` — nonexistent absolute `--schema` rejects not-found [providers: none]
- [ ] `--schema from project directory > should throw errors if schema does not exist at default path` — missing schema at defaults lists checked paths [providers: none]
- [ ] `--schema from parent directory > --schema relative path: should work` — relative subdirectory `--schema` generates client [providers: none]
- [ ] `--schema from parent directory > --schema relative path: should fail - invalid path` — nonexistent relative subdir `--schema` rejects [providers: none]
- [ ] `--schema from parent directory > --schema absolute path: should work` — absolute subdir `--schema` generates client [providers: none]
- [ ] `--schema from parent directory > --schema absolute path: should fail - invalid path` — nonexistent absolute subdir `--schema` rejects [providers: none]
- [ ] `--schema from parent directory > should load schema located next to a nested config` — `--config` resolves schema next to nested config [providers: none]
- [ ] `--schema from parent directory > --generator: should work - valid generator names` — multiple valid `--generator` names generate both clients [providers: none]
- [ ] `--schema from parent directory > --generator: should fail - single invalid generator name` — one unknown `--generator` rejects [providers: none]
- [ ] `--schema from parent directory > --generator: should fail - multiple invalid generator names` — multiple unknown `--generator` names reject [providers: none]
- [ ] `with --sql > should throw error on invalid sql` — invalid SQL file errors during `--sql` generate [providers: sqlite]
- [ ] `with --sql > throws error on mssql` — `--sql` unsupported on sqlserver [providers: sqlserver]
- [ ] `with --sql > throws error on mongo` — `--sql` unsupported on mongodb [providers: mongodb]

### packages/cli/src/__tests__/commands/Status.test.ts

- [ ] `status > should show help with --help` — `--help` prints status command help incl `--json` [providers: none]
- [ ] `status > should display all operational services` — all-operational summary renders service list [providers: none]
- [ ] `status > should display active incidents` — major-outage summary renders active incident details [providers: none]
- [ ] `status > should show latest incident update when API returns oldest-first` — picks latest update from oldest-first list [providers: none]
- [ ] `status > should display scheduled maintenances and hide completed ones` — shows scheduled maintenance, hides completed [providers: none]
- [ ] `status > should show under_maintenance status as Maintenance` — under_maintenance component renders as Maintenance [providers: none]
- [ ] `status > should display in_progress maintenance preferring scheduled update body` — in_progress maintenance prefers scheduled update body [providers: none]
- [ ] `status > should output raw JSON with --json` — `--json` outputs parseable raw summary [providers: none]
- [ ] `status > should handle network errors gracefully` — network error renders friendly message [providers: none]
- [ ] `status > should return JSON error on network failure with --json and set non-zero exit code` — `--json` network failure returns error JSON, sets exitCode 1 [providers: none]
- [ ] `status > should handle HTTP errors gracefully` — HTTP error renders friendly message [providers: none]
- [ ] `status > should return JSON error on HTTP failure with --json and set non-zero exit code` — `--json` HTTP failure returns error JSON, sets exitCode 1 [providers: none]
- [ ] `status > should handle parse errors gracefully` — unexpected response renders parse-error message [providers: none]
- [ ] `status > should return JSON error on parse failure with --json and set non-zero exit code` — `--json` parse failure returns error JSON, sets exitCode 1 [providers: none]
- [ ] `status > should filter out group components` — group components excluded from service list [providers: none]

### packages/cli/src/__tests__/commands/SubCommand.vitest.ts

- [ ] `@<version>` — parsing @0.0.0 --help runs the local sub-command fixture and logs expected args snapshot [providers: none]
- [ ] `@latest` — parsing --help resolves latest, runs cached sub-command, logs expected args snapshot [providers: none]
- [ ] `autoinstall` — missing package triggers execa install then runs sub-command with expected args [providers: none]
- [ ] `aborts on deno` — running under a faked Deno global aborts without calling execa [providers: none]

### packages/cli/src/__tests__/commands/Validate.test.ts

- [ ] `validate > multi-schema-files > valid schemas > should prefer single file to the multi-schema alternatives` — validate resolves single vs multi-schema paths implicitly/explicitly [providers: none]
- [ ] `validate > multi-schema-files > invalid schemas > parses multi schemas when the file containing the config blocks (`generator`, `datasource`) is valid` — validate rejects P1012 missing argument in valid_config_file [providers: none]
- [ ] `validate > multi-schema-files > invalid schemas > reports multiple errors` — validate reports 3 errors across multiple files [providers: none]
- [ ] `validate > multi-schema-files > invalid schemas > parses multi schemas when the file containing the config blocks (`generator`, `datasource`) is valid` — validate rejects P1012 now() on Int in invalid_config_file [providers: none]
- [ ] `validate > multi-schema-files > invalid schemas > correctly reports error if config blocks (`generator`, `datasource`) are invalid` — validate rejects P1012 unknown property in invalid_config_blocks [providers: none]
- [ ] `validate > should succeed if schema is valid` — valid schema resolves "is valid" [providers: none]
- [ ] `validate > should throw if schema is invalid` — invalid schema rejects with validation error [providers: none]
- [ ] `validate > should succeed and show a warning on stderr (preview feature deprecated)` — deprecated preview feature warns, validate succeeds [providers: none]
- [ ] `validate > should throw with an error and show a warning on stderr (preview feature deprecated)` — deprecated preview + error rejects P1012 with warning [providers: none]
- [ ] `validate > should succeed and NOT show a warning when PRISMA_DISABLE_WARNINGS is truthy` — PRISMA_DISABLE_WARNINGS suppresses warning [providers: none]
- [ ] `validate > should load and validate schema located next to a nested config` — `--config` resolves nested schema and validates [providers: none]
- [ ] `validate > referential actions > should reject NoAction referential action on Postgres when relationMode = "prisma"` — NoAction rejected on Postgres relationMode=prisma [providers: postgres]
- [ ] `validate > referential actions > should reject NoAction referential action on sqlite when relationMode = "prisma"` — NoAction rejected (uses postgres.prisma fixture) [providers: postgres]
- [ ] `validate > referential actions > should accept NoAction referential action on e.g. MySQL when relationMode = "prisma"` — NoAction accepted on MySQL relationMode=prisma [providers: mysql]

### packages/cli/src/__tests__/commands/Version.test.ts

- [ ] `version > does not download query-engine` — version command outputs sanitized version info snapshot and config/schema-loaded stderr without downloading query-engine [providers: none]

### packages/cli/src/__tests__/commandState.test.ts

- [ ] `command state > initialize with the date when the state file doesn't exist` — initializes state with a firstCommandTimestamp when readFile rejects with ENOENT and writes it [providers: none]
- [ ] `command state > return the date when the state file does exist` — returns stored firstCommandTimestamp without writing when the state file exists [providers: none]
- [ ] `command state > calculate the days since last command` — daysSinceFirstCommand returns 864 for the given start/end dates [providers: none]

### packages/cli/src/__tests__/config.test.ts

- [ ] `test 'prisma {command}' automatically detects config file` — running command with --help loads prisma.config.ts from the prisma-config fixture (exit 0, stderr confirms) [each] [providers: none]
- [ ] `test 'prisma {command}' picks up custom --config option` — running command with --config option loads nested prisma.config.ts (exit 0, sanitized stderr confirms) [each] [providers: none]

### packages/cli/src/__tests__/dependent-generator.test.ts

- [ ] `should error when dependent generator is missing` — running generate against dependent-generator fixture errors and stderr matches snapshot [providers: none]

### packages/cli/src/__tests__/incomplete-schemas.test.ts

- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-set-invalid > db push` — invalid env url makes db push throw (snapshot) [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-set-invalid > db pull` — invalid env url makes db pull throw P1013 [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-set-invalid > db execute` — invalid env url makes db execute throw P1013 [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-set-invalid > migrate reset` — invalid env url makes migrate reset throw P1013 [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-set-invalid > migrate dev` — invalid env url makes migrate dev throw P1013 [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > validate` — unset env var makes validate throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > db push` — unset env var makes db push throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > db pull` — unset env var makes db pull throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > db execute` — unset env var makes db execute throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > migrate reset` — unset env var makes migrate reset throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > migrate dev` — unset env var makes migrate dev throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > validate` — duplicate-title: validate again throws config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-url-env-unset > format` — unset env var makes format throw config load error [providers: none]
- [ ] `[wasm] incomplete-schemas > empty-schema > validate` — empty schema validate resolves without throwing [providers: none]
- [ ] `[wasm] incomplete-schemas > empty-schema > format` — empty schema format resolves without throwing [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-no-url > db push` — missing datasource.url makes db push throw required-url error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-no-url > db pull` — missing datasource.url makes db pull throw required-url error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-no-url > db execute` — missing datasource.url makes db execute throw required-url error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-no-url > migrate reset` — missing datasource.url makes migrate reset throw required-url error [providers: none]
- [ ] `[wasm] incomplete-schemas > datasource-block-no-url > migrate dev` — missing datasource.url makes migrate dev throw required-url error [providers: none]
- [ ] `[normalized library/binary] incomplete-schemas > empty-schema > db push` — empty schema db push throws "must contain a datasource block" [providers: none]
- [ ] `[normalized library/binary] incomplete-schemas > empty-schema > db pull` — empty schema db pull throws "no datasource in the schema" [providers: none]
- [ ] `[normalized library/binary] incomplete-schemas > empty-schema > migrate reset` — empty schema migrate reset throws datasource-block error [providers: none]
- [ ] `[normalized library/binary] incomplete-schemas > empty-schema > migrate dev` — empty schema migrate dev throws datasource-block error [providers: none]

### packages/cli/src/__tests__/Init.vitest.ts

- [ ] `is schema and env written on disk replace` — default init writes schema.prisma, .env, prisma.config.ts with expected contents [providers: none]
- [ ] `works with url param` — `--url file:dev.db` produces sqlite schema + env DATABASE_URL [providers: sqlite]
- [ ] `works with provider param - postgresql` — `--datasource-provider postgresql` scaffolds postgres schema/env [providers: postgres]
- [ ] `works with provider param - cockroachdb` — `--datasource-provider cockroachdb` scaffolds cockroach schema/env [providers: cockroachdb]
- [ ] `works with provider and url params - cockroachdb` — provider + url flags together yield cockroach schema [providers: cockroachdb]
- [ ] `works with provider param - mysql` — `--datasource-provider mysql` scaffolds mysql schema/env [providers: mysql]
- [ ] `works with provider param - SQLITE` — case-insensitive SQLITE yields sqlite schema/env [providers: sqlite]
- [ ] `works with provider param - SqlServer` — SqlServer yields sqlserver schema/env [providers: sqlserver]
- [ ] `works with provider param - MongoDB` — MongoDB yields mongodb schema/env [providers: mongodb]
- [ ] `errors with invalid provider param` — invalid `--datasource-provider` rejects [providers: none]
- [ ] `works with --with-model param postgresql` — `--with-model` adds example model (postgres default) [providers: postgres]
- [ ] `works with --with-model param mongodb` — `--with-model` with MongoDB provider adds model [providers: mongodb]
- [ ] `works with --with-model param cockroachdb` — `--with-model` with CockroachDB provider adds model [providers: cockroachdb]
- [ ] `works with generator param - `go run github.com/steebchen/prisma-client-go`` — `--generator-provider` sets custom generator in schema [providers: none]
- [ ] `works with preview features - mock test` — single `--preview-feature` written to schema [providers: none]
- [ ] `works with preview features - multiple` — multiple `--preview-feature` flags written to schema [providers: none]
- [ ] `works with custom output` — `--output ./db` sets generator output path [providers: none]
- [ ] `warns when DATABASE_URL present in .env ` — existing DATABASE_URL not overwritten, warns [providers: none]
- [ ] `appends when .env present` — appends DATABASE_URL to existing .env preserving content [providers: none]
- [ ] `writes a minimal .gitignore file` — init creates a .gitignore [providers: none]
- [ ] `do not replace .gitignore file if already present` — existing .gitignore left untouched [providers: none]
- [ ] `uses determineClientOutputPath when no output is specified` — infers client output from project lib dir [providers: none]
- [ ] `installs agent skills and lists them in the summary` — calls installSkills, spinner succeeds, summary lists skill dirs [providers: none]
- [ ] `--no-skills skips the skills install` — `--no-skills` bypasses installSkills and skills-lock output [providers: none]
- [ ] `failed skills install is non-fatal and prints the manual command` — install failure warns with manual command, init still succeeds [providers: none]
- [ ] `--help lists the --no-skills flag` — help text includes `--no-skills` [providers: none]

### packages/cli/src/__tests__/nps.test.ts

- [ ] `nps survey > should exit immediately if running in CI` — skips survey when CI env set, no reads/writes/prompts [providers: none]
- [ ] `nps survey > should exit immediately if running in a Podman container` — skips survey when /run/.containerenv exists [providers: none]
- [ ] `nps survey > should exit immediately if running in a Docker container` — skips survey when /.dockerenv exists [providers: none]
- [ ] `nps survey > should exit immediately if running in a Kubernetes pod` — skips survey when KUBERNETES_SERVICE_HOST set [providers: none]
- [ ] `nps survey > should exit immediately if running in a pre-commit git hook` — skips survey when GIT_EXEC_PATH set [providers: none]
- [ ] `nps survey > should exit immediately if running in a post-install npm hook or similar` — skips survey when npm_command/npm_lifecycle_event set [providers: none]
- [ ] `nps survey > should read the config and exit when the current survey has been acknowledged` — exits after reading config when survey already acknowledged [providers: none]
- [ ] `nps survey > should check the status if there is no config and exit if there is no survey` — checks status when config missing, exits when no active survey [providers: none]
- [ ] `nps survey > should check the status if the acknowledged survey has expired` — re-checks status when acknowledged timeframe expired [providers: none]
- [ ] `nps survey > should exit if the status is undefined` — exits when status returns no timeframe [providers: none]
- [ ] `nps survey > should exit if this command is within 24 hours of the first command issued` — skips survey for users within 24h of first command [providers: none]
- [ ] `nps survey > should prompt the user if the survey is active and update the config` — prompts, writes acknowledgedTimeframe, captures NPS feedback [providers: none]
- [ ] `nps survey > should allow the user to skip the survey and still update the config` — skip response still writes acknowledgedTimeframe, no capture [providers: none]
- [ ] `createSafeReadlineProxy > should handle an input stream that closes` — proxy answers a question then throws aborted after close [providers: none]

### packages/cli/src/__tests__/preinstall.test.ts

- [ ] `should exit 1 and print a message when Node.js major version is lower than minimum - %s` — prints unsupported-version error and calls process.exit(1) for too-old Node versions [each] [providers: none]
- [ ] `should exit 1 and print a message when Node.js major version is higher than supported - %s` — prints a warning (not error) and does not exit for too-new Node versions [each] [providers: none]
- [ ] `should do nothing when Node.js version is supported - %s` — no error output for supported Node versions [each] [providers: none]
- [ ] `should do nothing when Node.js version is supported - current` — no error output for the current process Node version [providers: none]

### packages/cli/src/__tests__/printUpdateMessage.test.ts

- [ ] `normal release` — prints the update-available box for a normal 4.5.0 -> 4.6.0 version bump [providers: none]
- [ ] `integration version with long name` — prints correctly sized update box for a long integration version string [providers: none]

### packages/cli/src/__tests__/skill-install.vitest.ts

- [ ] `command assembly > npm` — installSkills runs npx runner for npm user agent [providers: none]
- [ ] `command assembly > pnpm` — installSkills runs pnpm dlx runner for pnpm user agent [providers: none]
- [ ] `command assembly > yarn 2+` — installSkills runs yarn dlx runner for yarn 4 user agent [providers: none]
- [ ] `command assembly > yarn 1 routes through npx` — yarn 1 user agent routes to npx runner [providers: none]
- [ ] `command assembly > bun via runtime check` — bun runtime uses bunx runner [providers: none]
- [ ] `command assembly > creates agent-specific skills directories before running the skills CLI` — creates .claude/skills and .windsurf/skills before exec [providers: none]
- [ ] `runner detection > falls back to npm in a directory without package.json or lockfiles` — detectRunner defaults to npm/npx [providers: none]
- [ ] `runner detection > detects %s as %s` — detects package manager from each lockfile [each] [providers: none]
- [ ] `runner detection > npm_config_user_agent takes precedence over lockfiles` — user agent overrides lockfile detection [providers: none]
- [ ] `runner detection > routes a yarn 1 user agent to npm because classic yarn has no dlx` — yarn 1 agent detected as npm [providers: none]
- [ ] `runner detection > ignores unrecognized npm_config_user_agent` — unknown user agent falls back to lockfile (pnpm) [providers: none]
- [ ] `failure handling > resolves to the failure shape with a manual command instead of throwing` — exec rejection returns ok:false with npx manual command [providers: none]
- [ ] `failure handling > manual command matches the detected runner` — failure manual command uses pnpm dlx for pnpm agent [providers: none]
- [ ] `failure handling > manual command for a yarn 1 user agent uses npx` — failure manual command uses npx for yarn 1 agent [providers: none]

### packages/cli/src/__tests__/studio-server.vitest.ts

- [ ] `streams GET response bodies from the Node Studio server` — GET request returns 200 with the handler's body text [providers: none]
- [ ] `preserves HEAD semantics without dropping GET bodies` — HEAD request returns 200 with empty body [providers: none]
- [ ] `logs server errors and returns the error message in the response body` — thrown handler errors yield 500 with CORS header, error body, and logged error [providers: none]
- [ ] `does not log when the client disconnects before the response is written` — aborted request settles as AbortError without logging an error [providers: none]

### packages/cli/src/__tests__/Studio.vitest.ts

- [ ] `Studio MySQL URL compatibility > converts sslaccept=strict to mysql2 ssl JSON` — maps sslaccept=strict to ssl rejectUnauthorized:true [providers: mysql]
- [ ] `Studio MySQL URL compatibility > maps connection_limit to mysql2 connectionLimit` — renames connection_limit to connectionLimit [providers: mysql]
- [ ] `Studio MySQL URL compatibility > converts sslaccept=accept_invalid_certs to mysql2 ssl JSON` — maps accept_invalid_certs to ssl rejectUnauthorized:false [providers: mysql]
- [ ] `Studio BFF > routes sql-lint requests to executor.lintSql` — sql-lint procedure calls lintSql and returns diagnostics with CORS [providers: postgresql]
- [ ] `Studio BFF > unwraps RPC-serialized sql-lint errors` — unwraps @@error-wrapped sql-lint error without serializeError [providers: postgresql]
- [ ] `Studio BFF > passes through top-level serialized sql-lint errors` — passes through already-serialized top-level error [providers: postgresql]
- [ ] `Studio BFF > unwraps nested serialized sql-lint errors` — unwraps nested error field in sql-lint result [providers: postgresql]
- [ ] `Studio BFF > falls back to serializeError for unknown sql-lint error shapes` — calls serializeError for unrecognized error shape [providers: postgresql]
- [ ] `Studio BFF > routes transaction requests to executor.executeTransaction` — transaction procedure calls executeTransaction [providers: postgresql]
- [ ] `Studio BFF > returns an explicit error when query insights are unsupported` — query-insights returns unsupported error [providers: postgresql]
- [ ] `Studio BFF > serves the Prisma logo as the favicon` — /favicon.ico returns svg [providers: postgresql]
- [ ] `Studio BFF > serves the bundled Studio HTML shell without CDN dependencies` — / returns bundled HTML shell without CDN refs [providers: postgresql]
- [ ] `Studio BFF > serves the bundled Studio JavaScript and CSS assets` — /studio.js and /studio.css return bundled assets [providers: postgresql]
- [ ] `Studio BFF > responds to OPTIONS requests with CORS preflight headers` — OPTIONS /bff returns 204 CORS preflight [providers: postgresql]
- [ ] `Studio BFF > no longer serves adapter.js` — /adapter.js returns 404 [providers: postgresql]

### packages/cli/src/__tests__/update-message.test.ts

- [ ] `update available message > update available > dev tag - minor` — prints dev@dev minor update message with install commands [providers: none]
- [ ] `update available message > update available > dev tag - major` — prints dev major update message noting major update [providers: none]
- [ ] `update available message > update available > latest tag - minor` — prints latest minor update message with install commands [providers: none]
- [ ] `update available message > update available > latest tag - major` — prints latest major update message noting major update [providers: none]
- [ ] `update available message > prints nothing if the CLI is up to date` — no output when outdated:false [providers: none]
- [ ] `update available message > prints nothing if the checkResult.status is waiting` — no output when status waiting [providers: none]
- [ ] `update available message > prints nothing if the checkResult.status is disabled` — no output when status disabled [providers: none]
- [ ] `update available message > prints nothing if the checkResult.status is reminded` — no output when status reminded [providers: none]
- [ ] `update available message > prints nothing if process.env.PRISMA_HIDE_UPDATE_MESSAGE is set` — no output when PRISMA_HIDE_UPDATE_MESSAGE set [providers: none]

**Total: 596 tests**

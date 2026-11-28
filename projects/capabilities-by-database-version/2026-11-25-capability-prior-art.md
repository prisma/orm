# Prior art: how data tools represent what a database can do

Date: 2026-11-25. Sources are official docs or source code on each project's default branch, read on this date. Source links point at the default branch, so line positions may drift. Anything marked **Unconfirmed** was not verified from a primary source.

## Question

Prisma 8 adapters each carry one fixed list of capabilities, copied into the contract. We want the list to match the user's real database. This report records how other tools handle five things: how they name the database and dialect, whether they take a version, how version-, service- and setting-dependent features are represented, whether the connection can restrict features, and whether anything checks the real database against what the code assumes.

## TypeScript and JavaScript tools

### Kysely

Representation. A dialect is an object that implements the `Dialect` interface, with four factory methods: `createDriver()`, `createQueryCompiler()`, `createAdapter()` and `createIntrospector(db)` ([dialect.ts](https://github.com/kysely-org/kysely/blob/master/src/dialect/dialect.ts)). The driver owns connections. The query compiler turns the query tree into SQL. The adapter holds dialect facts. The introspector reads table and column metadata.

Version. Kysely takes no database version anywhere in its built-in dialects. A search of `src/dialect` found no version handling.

Features. The `DialectAdapter` has five boolean flags: `supportsCreateIfNotExists`, `supportsMultipleConnections`, `supportsTransactionalDdl`, `supportsReturning` and `supportsOutput` ([dialect-adapter.ts](https://github.com/kysely-org/kysely/blob/master/src/dialect/dialect-adapter.ts)). Each built-in adapter subclass fixes them: for example `PostgresAdapter` sets returning and transactional DDL, `MssqlAdapter` sets `supportsOutput`. The flags are runtime values, not types. The query builders use `supportsReturning` and `supportsOutput` only to decide how to read the result of an insert, update, delete or merge ([insert-query-builder.ts](https://github.com/kysely-org/kysely/blob/master/src/query-builder/insert-query-builder.ts)). The `.returning()` method itself is available on every dialect at the type level. The migrator uses `supportsTransactionalDdl` to decide whether to wrap migrations in a transaction ([migrator.ts](https://github.com/kysely-org/kysely/blob/master/src/migration/migrator.ts)).

Connection limits. `supportsMultipleConnections` is the one connection-shaped flag. `SqliteAdapter` and `PGliteAdapter` set it to false, and the runtime driver then serialises all work through one connection ([runtime-driver.ts](https://github.com/kysely-org/kysely/blob/master/src/driver/runtime-driver.ts)). Third-party dialects for HTTP drivers reuse a built-in adapter with their own driver; the adapter does not change.

Checking. None found.

### Knex

Representation. A string `client` option (`'pg'`, `'mysql'`, `'cockroachdb'`, and others) picks a client class ([guide](https://knexjs.org/guide/)).

Version. Optional `version` string option, for example `version: '7.2'` for PostgreSQL or `'5.7'` for MySQL. The docs describe it mainly for "a non-standard database" behind the PostgreSQL adapter ([guide](https://knexjs.org/guide/)). The base client stores `config.version` ([client.js](https://github.com/knex/knex/blob/master/lib/client.js)). When it is not set, the PostgreSQL client runs `select version()` on the first raw connection and stores the result ([postgres/index.js](https://github.com/knex/knex/blob/master/lib/dialects/postgres/index.js)). The MySQL client does the same; if detection fails or the string cannot be parsed, it logs "Assuming latest version" and sets the version to null, which the code treats as "allow everything" ([mysql/index.js](https://github.com/knex/knex/blob/master/lib/dialects/mysql/index.js)). A configured `version: 'latest'` skips detection.

Features. Version checks are scattered inline. Example: PostgreSQL `json`/`jsonb` columns fall back to `text` only when a version is known and is below 9.2, unless the client is CockroachDB or `jsonbSupport: true` is set ([pg-columncompiler.js](https://github.com/knex/knex/blob/master/lib/dialects/postgres/schema/pg-columncompiler.js)). `jsonbSupport` is a config flag for a single feature. There is no central feature object.

Connection limits. None modelled, beyond custom clients such as the Aurora Data API client shown in the guide.

Checking. Detection only. No minimum-version check found.

### Sequelize (v7, `main` branch)

Representation. One dialect class per database, in separate packages (`@sequelize/postgres` and so on). Each dialect declares a static `supports` object of type `DialectSupports` with nested booleans and strings, for example `returnValues: false | 'output' | 'returning'`, `inserts.onConflictWhere`, `constraints.deferrable` ([dialect.ts](https://github.com/sequelize/sequelize/blob/main/packages/core/src/abstract-dialect/dialect.ts)). Each dialect also declares `minimumDatabaseVersion`, for example PostgreSQL `11.0.0`, MySQL `8.0.20`, MariaDB `10.4.30`.

Version. Optional `databaseVersion` option. When it is not set, Sequelize fetches the version on the first connection; if the result is not valid semver it falls back to the dialect's minimum version ([sequelize-typescript.ts](https://github.com/sequelize/sequelize/blob/main/packages/core/src/sequelize-typescript.ts)). The v7 option docs say it is only needed for models defined with decorators ([API docs](https://sequelize.org/api/v7/interfaces/_sequelize_core.index._internal_.sequelizecoreoptions)).

Features. The `supports` object is fixed per dialect, not per version. Version is consulted in a few places inline: PostgreSQL uses `gen_random_uuid()` from version 13 and `uuid_generate_v4()` before it ([query-generator-typescript.internal.ts](https://github.com/sequelize/sequelize/blob/main/packages/postgres/src/query-generator-typescript.internal.ts)).

Checking. `setDatabaseVersion` warns, and records a deprecation, when the version is below `minimumDatabaseVersion`. It does not fail.

### TypeORM

Representation. A `type` string option selects a driver class (`PostgresDriver`, `MysqlDriver`, and so on). The `Driver` interface exposes capability methods such as `isReturningSqlSupported(type)`, `isUUIDGenerationSupported()`, `isFullTextColumnTypeSupported()` and a `cteCapabilities` object ([Driver.ts](https://github.com/typeorm/typeorm/blob/master/packages/typeorm/src/driver/Driver.ts)).

Version. No version option found. The driver queries the version on connect and stores it ([PostgresDriver.ts](https://github.com/typeorm/typeorm/blob/master/packages/typeorm/src/driver/postgres/PostgresDriver.ts)).

Features. After connecting, the driver sets capability fields from the detected version. `MysqlDriver` turns on `RETURNING` for delete from MariaDB 10.0.5 and for insert from 10.5.0, CTEs from MariaDB 10.2.0 or MySQL 8.0.0, and the UUID column type from MariaDB 10.7.0 ([MysqlDriver.ts](https://github.com/typeorm/typeorm/blob/master/packages/typeorm/src/driver/mysql/MysqlDriver.ts)). `PostgresDriver` sets `isGeneratedColumnsSupported` from version 12, and checks `pg_available_extensions` and installs needed extensions (`uuid-ossp` or `pgcrypto`, chosen by the `uuidExtension` option) unless `installExtensions: false`.

Checking. Detection at connect only.

### MikroORM

Representation. One `Platform` class per database, in separate packages (`@mikro-orm/postgresql`, `@mikro-orm/mysql`, `@mikro-orm/mariadb`, and others). The base class has capability methods such as `usesReturningStatement()`, `usesCascadeStatement()` and `supportsCreatingFullTextIndex()`, which subclasses override ([Platform.ts](https://github.com/mikro-orm/mikro-orm/blob/master/packages/core/src/platforms/Platform.ts)).

Version. A search of the packages found no server-version detection or version option. MySQL and MariaDB differences are handled by having separate platform packages.

Checking. None found.

### Drizzle

Representation. The dialect is chosen by import path. Table builders live in `drizzle-orm/pg-core`, `mysql-core`, `sqlite-core`, `singlestore-core` and `gel-core`, and each has its own query builders with different methods. For example MySQL has `$returningId()` where PostgreSQL has `.returning()`. The driver is a second import path: `drizzle-orm/node-postgres`, `neon-http`, `neon-serverless`, `planetscale-serverless`, `d1`, `libsql` and many more ([source tree](https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-orm/src)).

Version. None. A search of the three core dialect files found no version handling.

Connection limits. Modelled per driver session class, at runtime. The `neon-http` session's `transaction()` throws "No transactions support in neon-http driver"; it offers `batch()` instead ([neon-http/session.ts](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/neon-http/session.ts)). The PlanetScale serverless session throws "Streaming is not supported" ([planetscale-serverless/session.ts](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/planetscale-serverless/session.ts)). The method still exists in the types. drizzle-kit takes a separate `driver` option (`'aws-data-api'`, `'pglite'`, `'d1-http'`, and others) next to `dialect` ([drizzle-kit index.ts](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/index.ts)).

Checking. None found.

### Prisma 7 and earlier

Representation. The schema's `datasource.provider` string (`postgresql`, `cockroachdb`, `mysql`, `sqlite`, `sqlserver`, `mongodb`). Each provider's connector has a fixed `ConnectorCapability` bit set (42 variants), used during schema validation ([capabilities.rs](https://github.com/prisma/prisma-engines/blob/main/psl/psl-core/src/datamodel_connector/capabilities.rs), [postgres_datamodel_connector.rs](https://github.com/prisma/prisma-engines/blob/main/psl/psl-core/src/builtin_connectors/postgres_datamodel_connector.rs)). CockroachDB is a separate provider rather than a PostgreSQL version.

Version. No version option for the database. The schema engine detects facts at connect time and stores them as "circumstances" flags: for MySQL it runs `SELECT @@version, @@GLOBAL.version` and `SELECT @@lower_case_table_names`, and sets `IsVitess`, `IsMysql56`, `IsMysql57`, `IsMariadb` and `CheckConstraints` (from 8.0.16) ([flavour/mysql.rs](https://github.com/prisma/prisma-engines/blob/main/schema-engine/connectors/sql-schema-connector/src/flavour/mysql.rs)). For PostgreSQL it sets `IsCockroachDb` and `CanPartitionTables` ([flavour/postgres.rs](https://github.com/prisma/prisma-engines/blob/main/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs)). These flags affect migration planning and introspection, not the schema-language capabilities.

Extensions. The `postgresqlExtensions` preview lets the schema declare `extensions = [postgis(version: "2.1", schema: "public")]`, so an extension version is written in the schema ([postgres_datamodel_connector.rs](https://github.com/prisma/prisma-engines/blob/main/psl/psl-core/src/builtin_connectors/postgres_datamodel_connector.rs)).

Connection limits. Three mechanisms. The `pgbouncer=true` URL parameter turns off the prepared-statement cache ([quaint postgres/url.rs](https://github.com/prisma/prisma-engines/blob/main/quaint/src/connector/postgres/url.rs)). `relationMode = "prisma"` in the schema emulates foreign keys for services without them, historically PlanetScale. With driver adapters (Prisma 6 and 7), the adapter reports `provider` and `adapterName`, and may return `getConnectionInfo()` with `schemaName`, `maxBindValues` and `supportsRelationJoins` ([driver-adapter-utils types](https://unpkg.com/@prisma/driver-adapter-utils@6.19.0/dist/index.d.ts)). The MariaDB adapter computes `supportsRelationJoins` at connect from `SELECT VERSION()`: true only for MySQL, not MariaDB, at 8.0.13 or later ([adapter-mariadb dist](https://unpkg.com/@prisma/adapter-mariadb@6.19.0/dist/index.js)). Reading that code, the check `major === 8 && minor >= 0 && patch >= 13` would report false for 8.4.0; this is our reading of the published code, not a confirmed bug report. The PlanetScale adapter hard-codes `supportsRelationJoins: true` ([adapter-planetscale dist](https://unpkg.com/@prisma/adapter-planetscale@6.19.0/dist/index.js)). So in Prisma 6 and 7 one capability already moved from the provider to the connection, and is detected.

Checking. Schema validation checks the schema against the provider's fixed capabilities. Nothing checks the real database version against the schema at runtime. **Unconfirmed**: whether the query engine has any runtime version check.

## JVM tools

### Hibernate

Representation. One `Dialect` subclass per database (`PostgreSQLDialect`, `MySQLDialect`, `MariaDBDialect`, `CockroachDialect`, and others), each holding a `DatabaseVersion` ([dialect package](https://github.com/hibernate/hibernate-orm/tree/main/hibernate-core/src/main/java/org/hibernate/dialect)).

What Hibernate 6 changed. Before 6, users picked versioned classes such as `PostgreSQL91Dialect`. The 6.0 migration guide says "dialects can detect and adapt to the version of the database in use" and that version-specific dialects "should no longer be used" ([6.0 migration guide](https://docs.hibernate.org/orm/6.0/migration-guide/migration-guide.html)). Legacy versioned behaviour lives in a separate community module as `PostgreSQLLegacyDialect` and `MySQLLegacyDialect` ([community dialects](https://github.com/hibernate/hibernate-orm/tree/main/hibernate-community-dialects/src/main/java/org/hibernate/community/dialect)).

Version. Detected by default from JDBC metadata at startup through `DialectResolutionInfo`. If the database must not be contacted at boot, `hibernate.boot.allow_jdbc_metadata_access=false` plus `jakarta.persistence.database-product-name` and `database-major-version`/`database-minor-version` give it explicitly ([Introduction guide](https://docs.hibernate.org/orm/7.0/introduction/html_single/Hibernate_Introduction.html)). When no version is known, the dialect uses its minimum version; `PostgreSQLDialect` uses 15 ([PostgreSQLDialect.java](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/PostgreSQLDialect.java)).

Features. Many overridable `supports*` and `get*` methods on `Dialect`, with inline checks such as `getVersion().isSameOrAfter(17)` in `PostgreSQLDialect`.

Settings. `MySQLDialect` takes a `MySQLServerConfiguration` with bytes per character, whether `NO_BACKSLASH_ESCAPES` is on, and the storage engine. At startup it runs `SELECT @@character_set_database, @@sql_mode`; when that is unavailable it falls back to settings such as `MYSQL_BYTES_PER_CHARACTER` and `MYSQL_NO_BACKSLASH_ESCAPES` ([MySQLServerConfiguration.java](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/jdbc/spi/MySQLServerConfiguration.java)).

Driver. `PostgreSQLDialect` also takes a `PostgreSQLDriverKind` (`PG_JDBC`, `VERT_X`, `OTHER`), detected from the driver name, which changes parameter markers ([PostgreSQLDriverKind.java](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/jdbc/spi/PostgreSQLDriverKind.java)).

Checking. At construction, `Dialect.checkVersion()` logs a warning when the version is below the minimum supported version ([Dialect.java](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/Dialect.java)). It does not fail.

### jOOQ

Representation. A Java enum, `SQLDialect`. It has families (`POSTGRES`, `MYSQL`, `MARIADB`, `SQLITE`) and, in the commercial editions, versioned values (`POSTGRES_9_3`, `POSTGRES_9_4`, ..., `POSTGRES_11`, and so on). The open-source edition only has families, and each family "behaves like" its latest versioned dialect; for example `POSTGRES` behaves like `POSTGRES_19` and `MYSQL` like `MYSQL_8_0_31` ([SQLDialect.java](https://github.com/jOOQ/jOOQ/blob/main/jOOQ/src/main/java/org/jooq/SQLDialect.java)). There is a `DEFAULT` dialect "not intended to be used with any actual database".

Version. Taken through the enum value. Versioned values link to their predecessor, and `precedes()` answers "at least this version" questions.

Features. Every DSL method carries a `@Support({...})` annotation listing the dialects that support or emulate it ([dialects manual](https://www.jooq.org/doc/latest/manual/sql-building/dsl-context/sql-dialects/)). jOOQ emulates many features, for example `IS DISTINCT FROM` as a `CASE` expression.

Checking. An optional compile-time checker (Checker Framework) reads `@Allow` and `@Require` annotations on the user's packages, classes or methods and reports use of jOOQ API not supported by the allowed dialects ([checker manual](https://www.jooq.org/doc/latest/manual/tools/checker-framework/)). `JDBCUtils.dialect(Connection)` guesses the family from the connection URL and returns `DEFAULT` if it cannot ([JDBCUtils Javadoc](https://www.jooq.org/javadoc/latest/org/jooq/tools/jdbc/JDBCUtils.html)). **Unconfirmed**: whether it also detects the version.

## .NET tools

### Entity Framework Core with Npgsql (PostgreSQL)

Representation. The provider is chosen with `UseNpgsql(...)`.

Version. Explicit `SetPostgresVersion(major, minor)` on the options builder, documented as "the backend version to target" ([NpgsqlDbContextOptionsBuilder.cs](https://github.com/npgsql/efcore.pg/blob/main/src/EFCore.PG/Infrastructure/NpgsqlDbContextOptionsBuilder.cs)). When it is not set, the provider assumes `DefaultPostgresVersion`, currently 16.0 ([NpgsqlOptionsExtension.cs](https://github.com/npgsql/efcore.pg/blob/main/src/EFCore.PG/Infrastructure/Internal/NpgsqlOptionsExtension.cs)). It is not detected. `UseRedshift()` is a separate option, and setting it together with a version throws.

Features. Inline `_postgresVersion.AtLeast(n)` checks in migrations SQL, type mapping (multiranges from 14) and model validation.

Checking. The model validator throws at model build time when the model uses something the configured version lacks, for example a `WITHOUT OVERLAPS` key below version 18 ([NpgsqlModelValidator.cs](https://github.com/npgsql/efcore.pg/blob/main/src/EFCore.PG/Infrastructure/Internal/NpgsqlModelValidator.cs)). This checks the model against the declared version, not against the real database.

### EF Core with Pomelo (MySQL and MariaDB)

Representation and version. `UseMySql(connectionString, serverVersion)` requires a `ServerVersion`. The user builds it with `ServerVersion.AutoDetect(connectionString)`, which opens a connection and queries the server, or with `ServerVersion.Parse("8.0.36-mysql")`, or by constructing `MySqlServerVersion` or `MariaDbServerVersion` ([MySqlDbContextOptionsBuilderExtensions.cs](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql/blob/main/src/EFCore.MySql/Extensions/MySqlDbContextOptionsBuilderExtensions.cs), [ServerVersion.cs](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql/blob/main/src/EFCore.MySql/Infrastructure/ServerVersion.cs)). Server type (MySQL or MariaDB) is part of the version value.

Features. A `ServerVersionSupport` object with one virtual boolean per feature, such as `Json`, `Returning` and `CommonTableExpressions`. MySQL and MariaDB subclasses compute each from the version, for example MariaDB `Returning` from 10.5.0 and MySQL `Json` from 5.7.8 ([ServerVersionSupport.cs](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql/blob/main/src/EFCore.MySql/Infrastructure/ServerVersionSupport.cs), [MariaDbServerVersion.cs](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql/blob/main/src/EFCore.MySql/Infrastructure/MariaDbServerVersion.cs)).

Settings. `DisableBackslashEscaping()` tells the provider to assume `NO_BACKSLASH_ESCAPES`, and by default also turns on `SetSqlModeOnOpen()`, which runs `SET SESSION sql_mode` on every new connection so the assumption becomes true ([MySqlDbContextOptionsBuilder.cs](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql/blob/main/src/EFCore.MySql/Infrastructure/MySqlDbContextOptionsBuilder.cs)). This is an approach where the tool enforces the setting rather than detecting it.

### EF Core with SQL Server and SQLite

SQL Server. EF Core 8 added `UseCompatibilityLevel(n)`, which models the database's compatibility level, a database setting that can differ from the server version. The EF 8 breaking-changes page notes that an Azure SQL database migrated from an older server can carry an old compatibility level ([EF Core 8 breaking changes](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/breaking-changes)).

SQLite. The same page says EF 8 translates `Math` methods to SQLite math functions, which exist only when the native SQLite library is compiled with `SQLITE_ENABLE_MATH_FUNCTIONS`. EF's bundled library enables them; a different native library may not, and queries then fail with "no such function". EF does not detect this.

## Python, Ruby, Elixir and Rust tools

### Django

Representation. Each backend has a `DatabaseFeatures` class with many `supports_*`, `has_*` and `can_*` attributes, and a `minimum_database_version` ([postgresql/features.py](https://github.com/django/django/blob/main/django/db/backends/postgresql/features.py)).

Version. Detected from the connection. No version option. PostgreSQL features use `cached_property` helpers such as `is_postgresql_17` built from `connection.pg_version`.

Features from settings and services. MySQL features read live server state: `sql_mode` (for example `allows_group_by_selected_pks` depends on `ONLY_FULL_GROUP_BY` on MariaDB), the default storage engine (MyISAM turns off transactions and foreign keys), `lower_case_table_names`, and whether time-zone tables are loaded ([mysql/features.py](https://github.com/django/django/blob/main/django/db/backends/mysql/features.py)). MariaDB is a flag on the MySQL backend, not a separate backend. SQLite's `supports_json_field` runs `SELECT JSON('{"a": "b"}')` and returns false on error, which probes the SQLite library the driver embeds ([sqlite3/features.py](https://github.com/django/django/blob/main/django/db/backends/sqlite3/features.py)).

Connection limits. `DISABLE_SERVER_SIDE_CURSORS` in the database settings, documented for transaction-pooling poolers such as PgBouncer ([databases docs](https://docs.djangoproject.com/en/stable/ref/databases/#transaction-pooling-and-server-side-cursors)). The `server_side_binding` option changes PostgreSQL features at runtime.

Checking. `check_database_version_supported()` raises `NotSupportedError` when the real version is below `minimum_database_version`. It runs once per database alias, on the first connection ([base/base.py](https://github.com/django/django/blob/main/django/db/backends/base/base.py)).

### Rails / Active Record

Representation. One adapter class per database. The abstract adapter defines many `supports_*?` predicate methods, and each adapter overrides them ([postgresql_adapter.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/postgresql_adapter.rb)).

Version. Detected. `database_version` is fetched once per pool by `get_database_version` and cached ([pool_config.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/pool_config.rb)). No version option.

Features. Predicates compare the version inline. PostgreSQL: `supports_insert_on_conflict?` and others from given versions. MySQL: each predicate branches on `mariadb?` and a version string, for example `supports_insert_returning?` is `mariadb? && database_version >= "10.5.0"` ([abstract_mysql_adapter.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/abstract_mysql_adapter.rb)). One predicate probes an extension: `supports_optimizer_hints?` on PostgreSQL is true only when the `pg_hint_plan` extension is available.

Connection limits. `database.yml` options `prepared_statements: false` and `advisory_locks: false` ([abstract_adapter.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/abstract_adapter.rb)), commonly used with PgBouncer.

Checking. `configure_connection` calls `check_version` on each new connection. The PostgreSQL adapter raises when the version is below 10 ("Active Record supports PostgreSQL >= 10.0").

### SQLAlchemy

Representation. A dialect class per database plus DBAPI driver, named by URL (`postgresql+psycopg`, `mysql+pymysql`). The dialect has class-level flags such as `supports_native_enum`, `supports_identity_columns` and `insert_returning` ([postgresql/base.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/postgresql/base.py)).

Version. Detected in `initialize()` on first connect into `server_version_info`; set to None if the dialect cannot get it ([engine/default.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/engine/default.py)). Before a connection, for example when compiling SQL offline, the class defaults apply. The PostgreSQL dialect then overwrites flags: `supports_identity_columns` from 10, JSONB subscripting from 14.

Settings. The MySQL dialect reads `sql_mode` on connect and sets `_server_ansiquotes` and `_backslash_escapes` from `ANSI_QUOTES` and `NO_BACKSLASH_ESCAPES`, which change quoting and escaping in compiled SQL ([mysql/base.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/mysql/base.py)).

Driver-embedded library. The SQLite dialect reads `dbapi.sqlite_version_info`, the version of the SQLite library inside the Python driver, and turns off `insert_returning`, `update_returning` and `delete_returning` below 3.35 ([sqlite/base.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/sqlite/base.py)).

Connection limits. The asyncpg dialect documents a PgBouncer workaround for prepared-statement names through connect arguments ([asyncpg.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/postgresql/asyncpg.py)).

Checking. Detection only. No minimum-version error found.

### Ecto (ecto_sql)

Representation. An adapter module per database (`Ecto.Adapters.Postgres`, `Ecto.Adapters.MyXQL`, `Ecto.Adapters.Tds`), with callbacks such as `supports_ddl_transaction?` ([postgres.ex](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/postgres.ex)).

Version. Not taken and not detected. The MyXQL adapter docs tell users of old MySQL versions to choose `:text` instead of `:map` for JSON, and to check their version's datetime precision themselves ([myxql.ex](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/myxql.ex)).

Connection limits. The `:prepare` option (`:named` or `:unnamed`), documented for PgBouncer in pool modes other than session.

Checking. None found.

### Diesel

Representation. A backend is a Rust type (`Pg`, `Mysql`, `Sqlite`, and recently a separate MariaDB backend behind a `mariadb` cargo feature). Its `SqlDialect` trait has associated types for each feature, such as `ReturningClause`, `OnConflictClause` and `BatchInsertSupport` ([backend.rs](https://github.com/diesel-rs/diesel/blob/main/diesel/src/backend.rs)). Using `.returning()` on a backend whose `ReturningClause` is `DoesNotSupportReturningClause` is a compile error.

Version. Chosen at compile time with a cargo feature. SQLite's `ReturningClause` is unsupported unless the `returning_clauses_for_sqlite_3_35` feature is on ([sqlite/backend.rs](https://github.com/diesel-rs/diesel/blob/main/diesel/src/sqlite/backend.rs), [Cargo.toml](https://github.com/diesel-rs/diesel/blob/main/diesel/Cargo.toml)).

Checking. None found at runtime. **Unconfirmed**: whether Diesel warns when the linked SQLite is older than the enabled feature.

## Services and connection-level limits

Neon serverless driver. Over HTTP (`neon()`), there are no sessions or interactive transactions; `transaction()` takes an array of queries and runs them as one non-interactive transaction. Requests and responses are capped at 64 MB. WebSocket `Pool`/`Client` give sessions and interactive transactions ([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)).

PlanetScale serverless driver. A fetch-based HTTP driver for Vitess/MySQL. It does support `conn.transaction(async tx => ...)`. ([database-js README](https://github.com/planetscale/database-js)). **Unconfirmed**: our fetch of the README reported limits on how `execute` takes parameters; we did not verify this in source. Foreign-key support on PlanetScale is a property of the service, not the driver; Prisma's `relationMode = "prisma"` exists for it.

Cloudflare D1. Runs in auto-commit. `batch()` runs statements as one SQL transaction that rolls back on failure ([D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)). The import guide tells users to remove `BEGIN TRANSACTION` and `COMMIT` from dumps ([import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)). **Unconfirmed**: an explicit D1 statement that interactive transactions are unsupported; the closest primary statement is for Durable Objects SQLite, where `sql.exec()` cannot run `BEGIN TRANSACTION` or `SAVEPOINT` ([Durable Objects SQL API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)).

libSQL / Turso. The TypeScript client supports interactive transactions with modes `write`, `read` and `deferred`, which lock for writing with a 5-second timeout, and `batch()` as an implicit transaction ([Turso TS reference](https://docs.turso.tech/sdk/ts/reference)). Write transactions on a replica are forwarded to the primary. **Unconfirmed**: transport-specific limits for HTTP versus WebSocket.

PgBouncer transaction mode. The official table lists what breaks: `SET`/`RESET`, `LISTEN`, `WITH HOLD` cursors, SQL-level `PREPARE`/`DEALLOCATE`, temp tables that outlive a transaction, `LOAD`, and session-level advisory locks are "Never" supported. Protocol-level prepared statements work when `max_prepared_statements` is non-zero ([PgBouncer features](https://www.pgbouncer.org/features.html)). Tools model this with connection options: Prisma's `pgbouncer=true`, Rails's `prepared_statements: false` and `advisory_locks: false`, Ecto's `prepare: :unnamed`, Django's `DISABLE_SERVER_SIDE_CURSORS`.

PostgREST. Exposes no raw SQL; what a request can do is derived from a schema cache of database metadata, reloaded by `SIGUSR1` or `NOTIFY pgrst, 'reload schema'` ([schema cache](https://docs.postgrest.org/en/stable/references/schema_cache.html)). **Unconfirmed**: whether PostgREST changes behaviour by PostgreSQL version; its source has a `PgVersion` module but the file path we tried did not resolve.

MongoDB. Features depend on both version and topology. The wire-version table maps server versions to features: replica-set transactions at wire version 7 (server 4.0), sharded transactions at 8 (4.2) ([wire version feature list](https://github.com/mongodb/specifications/blob/master/source/wireversion-featurelist/wireversion-featurelist.md)). Drivers learn `maxWireVersion` from the `hello` handshake. Standalone servers do not support transactions at all, and transactions also need a minimum `featureCompatibilityVersion`, a setting that can hold a newer server to older behaviour ([transactions production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)).

## Other relevant tool

Atlas (schema migration tool). Plans and validates migrations against a "dev database", a temporary real database that must have "the same engine, version, and extensions as your target database", usually given as a Docker URL such as `docker://postgres/15` ([Atlas dev database](https://atlasgo.io/concepts/dev-database)). The version is stated by choosing the dev database, and the real engine does the checking.

## Approaches found

1. **Fixed facts per dialect, no version.** One capability set per database; differences between versions are ignored or left to the user. Kysely, Drizzle, MikroORM, Ecto, Prisma 7 schema-language capabilities, Sequelize's `supports` object.

2. **Separate dialect or backend for a variant, rather than a version.** MySQL and MariaDB as separate packages or types: MikroORM, Sequelize, Diesel. CockroachDB as its own provider or dialect: Prisma, Knex, Hibernate. Redshift as an option: Npgsql.

3. **Version in the dialect name.** jOOQ's enum values (`POSTGRES_9_4`), commercial editions only. Hibernate before 6 (`PostgreSQL91Dialect`), which Hibernate 6 deprecated in favour of detection.

4. **Explicit version option, with a default when missing.** Npgsql `SetPostgresVersion` (default 16, never detected). Pomelo `ServerVersion` (required; `AutoDetect` is a helper the user calls). Knex `version`, Sequelize `databaseVersion` and Hibernate's `database-major-version` (each optional, overriding detection). EF Core SQL Server `UseCompatibilityLevel`.

5. **Detect the version on first connection.** Knex, Sequelize, TypeORM, Hibernate, Django, Rails, SQLAlchemy, Prisma's schema engine, Prisma's MariaDB adapter. Fallbacks when detection fails differ: Knex assumes latest, Sequelize and Hibernate assume the minimum supported version, SQLAlchemy uses class defaults.

6. **Compile-time features.** Diesel associated types plus cargo features; jOOQ `@Support` plus an optional checker against `@Allow`.

7. **Features computed from detected server settings or extensions.** Django (`sql_mode`, storage engine, `lower_case_table_names`), SQLAlchemy (`sql_mode`), Hibernate (`sql_mode`, character set), Prisma schema engine (`lower_case_table_names`, Vitess), Rails (`pg_hint_plan`), TypeORM (available extensions). Prisma's schema can declare an extension version.

8. **Tool enforces the setting it assumes.** Pomelo sets `sql_mode` on every connection open.

9. **Probe the driver-embedded library.** SQLAlchemy reads the Python SQLite library version; Django runs a test `JSON()` query. EF Core documents the dependency but does not probe.

10. **Connection or driver restricts features.** Runtime errors on the driver session: Drizzle. Driver-reported info: Prisma's `getConnectionInfo()`, Kysely's `supportsMultipleConnections`, Hibernate's `PostgreSQLDriverKind`. User-set connection options for poolers: Prisma, Rails, Ecto, Django, SQLAlchemy. A schema-level mode for a service: Prisma `relationMode`.

11. **Checks against the real database.** Hard failure below a minimum version on connect: Django, Rails. Warning only: Sequelize, Hibernate. Check of the model against a declared version, not the live database: Npgsql model validator. Validation by running against a real database of the same version: Atlas. None found: Kysely, Drizzle, MikroORM, Ecto, Diesel, TypeORM, Knex.

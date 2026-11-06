# Slice 2a — MySQL target: codecs, driver, contract emit, schema introspection

**Linear:** [TML-3694](https://linear.app/prisma-company/issue/TML-3694) · **Branch:** `tml-3694-mysql-target-emit-and-introspection` (stacked on slice 1) · **Project:** [`../../spec.md`](../../spec.md) · **Research:** `wip/slice2-research.md` (local)

## At a glance

```text
packages/3-targets/mysql/
  1-target/    @internal/target-mysql    descriptor meta, data types, codecs, authoring, control tables
  2-adapter/   @internal/adapter-mysql   control adapter: introspection, marker and ledger reads, bootstrap DDL
  3-driver/    @internal/driver-mysql    mysql2 control driver that hands codecs the server's text
  9-facade/    @internal/mysql           defineConfig, defineContract, control client
```

With the project's example contract (`../../spec.md`, "At a glance"):

```text
$ prisma contract emit          # writes contract.json and contract.d.ts for target "mysql"
```

and a MySQL 8.4 database created by hand with the matching tables introspects into the family schema IR the contract's own `contractToSchema` produces: the same tables, columns, types, defaults, primary keys, unique and plain indexes and foreign keys. Migrations, `db verify` and `db sign` are slice 2b.

## Chosen design

- **Shape follows SQLite.** Copy SQLite's package structure, descriptor meta, data type and codec pattern, authoring and facade wiring (`packages/3-targets/sqlite/*`), changing what MySQL needs. `supportsNamespaces: false`, unbound default namespace ([`../../design-notes.md`](../../design-notes.md) section 6).
- **Codecs and data types (ADR 254).** Only what the example contract needs plus the control tables: `int`, `bigint` (autoincrement keys may need it; include if the PSL `Int @default(autoincrement())` path wants it), `varchar(n)` with PSL `String` → `varchar(191)`, `text`, `datetime(3)` for control tables, and a native `enum('A','B')` column type for PSL enums (design notes section 6). Each data type declares its DDL texts and canonical form; `projectJson` may refuse until slice 3.
- **Enum.** A PSL enum on a MySQL column lowers to the column type `enum(...)` with the members in declared order, through the target's column-type hook, and the column's value set. The target derives no CHECK constraint for it. Introspection reads the members back from `COLUMN_TYPE`.
- **Capabilities** (adapter-reported): `foreignKeys`, `orderBy`, `limit`, `enums`. Not `returning`, `lateral` or any `insertOnConflict*`.
- **Driver.** mysql2's `query()` (text protocol, client-side escaping, `multipleStatements` off) with a `typeCast` that returns the server's text: `field.string('utf8')` for text and JSON columns, `field.buffer()` for binary columns. Only the control driver (`SqlControlDriverInstance`) is needed in 2a.
- **Control adapter.** Introspection from `information_schema` filtered on `TABLE_SCHEMA = DATABASE()`: `COLUMNS.COLUMN_TYPE` for the type text; `EXTRA` for `auto_increment` and `DEFAULT_GENERATED`; `STATISTICS` for indexes; `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE` and `REFERENTIAL_CONSTRAINTS` for keys and their actions. Drop the index InnoDB creates for a foreign key when it matches the key's columns. Split unique constraints from plain indexes. Marker and ledger reads, `withTransaction` (`START TRANSACTION`), and the bootstrap DDL for `_prisma_marker` and `_prisma_ledger` (MySQL has no schema inside a database to hold them). Marker writes, the lock, and the runner are 2b; members 2b fills may throw "not yet supported on MySQL" in 2a.
- **Namespace refusal (coupling row 9).** PSL and TypeScript authoring stop naming `'sqlite'` and `'postgres'`: namespace blocks are refused when the target's `supportsNamespaces` is false, and the reserved `unbound` name comes from target data. Postgres and SQLite behaviour and messages stay the same.
- **Tests and CI.** A `withMysqlDatabase` helper in `test/utils` reads `MYSQL_URL`, creates a uniquely named database per test and drops it after, and skips when `MYSQL_URL` is unset. CI: `mysql:8.4` and `mariadb:10.11` service containers with a health check on the jobs that run MySQL tests (`test-packages`, `test-e2e`, and `test-integration` if a MySQL integration test exists), with `MYSQL_URL` set; `docker-compose.yaml` gets the same services on free ports. Unit tests cover type mapping, DDL text for control tables and the mapping of canned `information_schema` rows to schema IR, so coverage does not depend on a live server.
- **Registration.** Every new package registers in `architecture.config.json` with the recipe; `pnpm lint:deps` runs the registration and ordering checks. The MySQL facade gets no public shell in this slice.

## Coherence rationale

One reviewer can hold "a new target that emits and introspects" in one sitting: it adds files, touches shared code only for the namespace refusal, and has no migration logic. Migrations, verify and sign carry the atomicity redesign, which reviews better on its own.

## Scope

**In:** the four packages, codecs and data types above, the control driver, emit fixture, introspection, control-table DDL, the namespace refusal fix, CI and compose services, the test helper, registration.

**Out:** planner, runner, marker writes, lock, `db verify`, `db sign` (2b); query lowering, runtime driver, `projectJson`, codec testkit (slice 3); writes (slice 4); public shells; `contract infer`; the Prisma 7 reader for MySQL.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Unique index on `text` needs a key length | `String` is `varchar(191)` |
| InnoDB adds an index for every foreign key | Introspection drops it when it matches the key's columns |
| Every unique constraint is also an index | Split by `TABLE_CONSTRAINTS` |
| MySQL reports JSON as binary charset (63) | `typeCast` passes `'utf8'` for JSON |
| `COLUMN_DEFAULT` is unquoted in MySQL 8; expression defaults carry `DEFAULT_GENERATED` | Map both; `CURRENT_TIMESTAMP(3)` reads as the now() default |
| Integer display width: MySQL 8.0.19+ drops it except `tinyint(1)` | Read `COLUMN_TYPE` as reported; MariaDB differences are slice 5 |
| Shared code that names a target | Never add one; read target data (`no-target-branches.mdc`) |
| Tests share one server across CI shards | One database per test, unique name |
| Destructive git operations | Forbidden without orchestrator approval |

## Done when

`prisma contract emit` produces a committed MySQL fixture that `pnpm fixtures:check` keeps stable; a live test against MySQL 8.4 shows a hand-made database introspects to the same schema IR as the contract's `contractToSchema`; namespace blocks are refused on MySQL and SQLite through the descriptor flag; and build, typecheck, lint, `lint:deps`, the new packages' tests and the changed authoring packages' tests pass.

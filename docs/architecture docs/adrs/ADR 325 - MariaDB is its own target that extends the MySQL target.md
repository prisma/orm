# ADR 325 — MariaDB is its own target that extends the MySQL target

**Status:** Accepted
**Date:** 2026-11-18
**Domain:** Adapters / Targets
**Related:** [ADR 278 — Each database's packages live in one folder](ADR%20278%20-%20Each%20database's%20packages%20live%20in%20one%20folder.md), [ADR 164 — Repository Layer](ADR%20164%20-%20Repository%20Layer.md), [ADR 242 — Public npm surface: single @prisma scope with consolidated publish packages](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 065 — Adapter capability schema & negotiation v1](ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md)

---

## At a glance

A MariaDB application installs `@prisma/orm-mariadb` and creates its client with `mariadb()`, as a MySQL application uses `mysql()` from `@prisma/orm-mysql`:

```ts
import { contractFromJson } from '@prisma/orm-mariadb/static';
import mariadb from '@prisma/orm-mariadb/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);
export const db = mariadb({ contract, url: process.env.DATABASE_URL });
```

`mariadb()` is MySQL's client factory applied to MariaDB's target, adapter and driver (`packages/3-targets/mysql/2-mariadb/9-facade/src/runtime/mariadb.ts`):

```ts
const mariadb: MysqlClientFactory<MariadbTargetId> = createMysqlClient({
  target: mariadbTarget,
  adapter: mariadbAdapter,
  driver: mariadbDriver,
  urlSchemes: ['mariadb', ...mysqlUrlSchemes],
});
```

Where MariaDB's SQL differs, its renderer subclasses MySQL's and overrides a protected method (`packages/3-targets/mysql/2-mariadb/2-adapter/src/core/sql-renderer.ts`):

```ts
export class MariadbSqlRenderer extends MysqlSqlRenderer {
  protected override proposedRow(): ProposedRow {
    return { alias: undefined, column: (quotedColumn) => `VALUES(${quotedColumn})` };
  }

  protected override returningRefusal(statement: ReturningStatement): string {
    if (statement === 'update') {
      return `${this.target.displayName} has no UPDATE … RETURNING, so the ORM reads updated rows back with a select`;
    }
    return `The ${this.target.displayName} adapter does not write ${statement.toUpperCase()} … RETURNING: it reports no returning capability, since ${this.target.displayName} has no UPDATE … RETURNING, so the ORM reads written rows back with a select`;
  }

  protected override writtenTableReadRefusal(): undefined {
    return undefined;
  }

  protected override orderedJsonArrayRefusal(): string {
    return `The ${this.target.displayName} adapter does not build an ordered JSON array in SQL; the ORM loads includes with one query per relation`;
  }
}
```

So an upsert that MySQL sends as

```sql
INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) AS `new` ON DUPLICATE KEY UPDATE `role` = ?3
```

reaches MariaDB as

```sql
INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) ON DUPLICATE KEY UPDATE `role` = ?3
```

## Decision

1. **MariaDB is a target of its own, with the target id `mariadb`.** It has its own target, adapter, driver and facade packages, and its own published packages, `@prisma/orm-mariadb` and `@prisma/orm-target-mariadb`.
2. **MariaDB's packages are built from MySQL's, and copy no MySQL code.** Each MySQL package exposes factories that take what differs between the two servers. MySQL's own descriptors and functions are those factories applied to MySQL's values. MariaDB's are the same factories applied to MariaDB's.
3. **Every factory takes the target's metadata, which carries its target id.** No factory falls back to `mysql`, so a MariaDB package that forgot to pass its metadata would fail to build rather than write `mysql` into a contract.
4. **Where behaviour differs inside a class, MariaDB subclasses MySQL's.** `MysqlSqlRenderer` marks as `protected` only the methods a subclass may override. `MariadbSqlRenderer` overrides those four. `MariadbMigration` extends `MysqlMigrationBase` and sets `targetId = 'mariadb'`.
5. **MariaDB uses MySQL's data types and codecs under their `mysql/…` ids.** Those ids name MySQL's set of types, not the server. No shared code compares a codec id's prefix with the target id.
6. **MariaDB's packages live in `packages/3-targets/mysql/2-mariadb/`,** beside MySQL's in `1-mysql/`, and one private test package in `3-live-tests/` runs the same ORM suites against both servers.

## The factories

Each row names the MySQL factory and what MariaDB passes to it.

| Plane | MySQL factory | What MariaDB passes |
| --- | --- | --- |
| Control | `createMysqlControlTargetDescriptor` (target) | MariaDB's target metadata. MySQL's planner, runner, schema verifier and contract serializer run under the `mariadb` target id. |
| Control | `createMysqlControlAdapter` (adapter) | `readCatalog: readMariadbCatalog`, which reads MariaDB's catalog and converts its rows into MySQL's form. |
| Control | `createMysqlControlDriverDescriptor` (driver) | MariaDB's runtime metadata and `checkViolationErrors: [4025]`. |
| Control | `MysqlMigrationBase` (the base class of a `migration.ts`) | `MariadbMigration` extends it with `targetId = 'mariadb'`. |
| Runtime | `createMysqlRuntimeTargetDescriptor` (target) | MariaDB's runtime metadata. |
| Runtime | `createMysqlRuntimeAdapterDescriptor` (adapter) | MariaDB's adapter metadata, with its capabilities, and `renderer: (codecs, target) => new MariadbSqlRenderer(codecs, target)`. |
| Runtime | `createMysqlRuntimeDriverDescriptor` (driver) | MariaDB's runtime metadata and `checkViolationErrors: [4025]`. |
| Facade | `createMysqlClient` | MariaDB's runtime target, adapter and driver, and the URL schemes `mariadb` and `mysql`. |
| Facade | `createMysqlStatic` | MariaDB's runtime target and adapter. It gives `contractFromJson` and the client without a driver. |
| Facade | `createMysqlDefineConfig` | MariaDB's control components, its pack, and the modules generated files import from. |
| Facade | `createMysqlDefineContract` | MariaDB's pack and adapter contract contributions, so a TypeScript contract carries target `mariadb` and MariaDB's capabilities. |

MariaDB's metadata is MySQL's, spread, with its own `targetId`, `id` and `displayName` (`packages/3-targets/mysql/2-mariadb/1-target/src/core/descriptor-meta-runtime.ts`). Error messages read the display name from it, so a MariaDB user reads "MariaDB" in them.

## What differs, and where each difference lives

| Difference | MySQL 8.4 | MariaDB 10.11 | Where it lives |
| --- | --- | --- | --- |
| Upsert syntax | Declares the proposed row `AS new` and reads `` `new`.`column` `` | Has no row alias; reads `VALUES(column)` | `proposedRow()` in `MariadbSqlRenderer` |
| `RETURNING` | None | On `INSERT` and `DELETE`, not `UPDATE` | Both adapters report `returning: false`, because the capability covers every statement kind. `returningRefusal()` says why on each. |
| Outer reference inside a derived table | Resolved | Not resolved | MariaDB's adapter reports `outerReferencesInDerivedTables: false` |
| An oversized JSON array aggregate | Fails | Cut short, with only a warning | MariaDB's adapter reports `jsonAggWithoutTruncation: false` |
| Ordered JSON arrays for includes | Built with `GROUP_CONCAT` and an optimizer hint | Not built: MariaDB reads the hint as a comment and lacks the JSON cast | `orderedJsonArrayRefusal()` in `MariadbSqlRenderer` |
| An update or delete whose filter or values read the table it writes | Refused by the server (error 1093); the only form it accepts copies and locks the whole table, so concurrent writes deadlock | Runs | `writtenTableReadRefusal()`: MySQL's renderer refuses the statement with `RUNTIME.AST_UNSUPPORTED`; MariaDB's returns `undefined` and writes it |
| CHECK violation error number | 3819 | 4025 | `checkViolationErrors` passed to the driver factories; both are reported as SQLSTATE 23514 |
| Index catalog | `STATISTICS.EXPRESSION` exists, for functional indexes | No such column, and no functional indexes | `MARIADB_CATALOG_QUERIES` in `2-mariadb/2-adapter/src/core/migrations/catalog.ts` |
| Integer column types in the catalog | `int` | `int(11)`, with a display width | `asMysqlColumnRow`, which removes the width, except on a signed `tinyint(1)` and a `zerofill` column, where MySQL keeps it too |
| Column defaults in the catalog | A literal unquoted; a function flagged `DEFAULT_GENERATED` in `EXTRA` | No default reported as the text `NULL`; a literal quoted; a function such as `current_timestamp(3)` with no flag | `asMysqlColumnRow`, so MySQL's introspection and schema verifier read MariaDB's rows unchanged |
| Session settings | `time_zone = '+00:00'` | The same | Inherited from MySQL's runtime metadata; MariaDB sets none of its own |

The capabilities `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` make the ORM load MariaDB's includes with one query per relation instead of the one-query include. [ADR 164](ADR%20164%20-%20Repository%20Layer.md) describes both strategies and how the contract's capabilities choose between them.

## The folder layout

```text
packages/3-targets/mysql/
  1-mysql/
    1-target/        @internal/target-mysql
    2-adapter/       @internal/adapter-mysql
    3-driver/        @internal/driver-mysql
    9-facade/        @internal/mysql
  2-mariadb/
    1-target/        @internal/target-mariadb
    2-adapter/       @internal/adapter-mariadb
    3-driver/        @internal/driver-mariadb
    9-facade/        @internal/mariadb
  3-live-tests/      @internal/mysql-live-tests
```

MariaDB sits inside the `mysql` folder because its packages import MySQL's. [ADR 278](ADR%20278%20-%20Each%20database's%20packages%20live%20in%20one%20folder.md) numbers the folders inside one database folder by dependency order, and `scripts/lint-target-layering.mjs` refuses a dependency on a higher-numbered folder and any dependency on another database's folder. A `3-targets/mariadb/` folder could not import MySQL's packages. Inside `mysql/`, `2-mariadb/` may import `1-mysql/`, and `3-live-tests/` may import both.

## One test package for both servers

`@internal/mysql-live-tests` holds the ORM suites: reads, includes, writes, writes whose filter reads the written table, raw SQL and transaction ownership. Each suite takes a `LiveServer` (`test/live-server.ts`) and names no database. `test/mysql/` and `test/mariadb/` each run every suite against their server.

Where the servers give different SQL or different results, the suite reads the expectation from `server.expected`, which each server's definition states:

```ts
expected: {
  upsertStatement:
    'INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) ON DUPLICATE KEY UPDATE `role` = ?3',
  oversizedOrderedInclude: 'returns every row',
  havingAboveExactMean: 'keeps the group',
  writeReadingWrittenTable: 'runs',
},
```

That is MariaDB's definition (`test/mariadb/server.ts`). So every behaviour the two servers share is tested once and run twice, and every difference is a named field.

## Why a target, and not a mode of MySQL

The target id is part of what Prisma emits. `contract.json` records `"target": "mariadb"`, the contract's hashes are computed over it, and a migration's `migration.ts` imports from `@prisma/orm-mariadb/migration`, whose `Migration` class has `targetId = 'mariadb'`. The same PSL schema emitted for MySQL and for MariaDB gives two contracts with different hashes. `mariadb()` refuses a contract emitted for MySQL, and `mysql()` refuses one emitted for MariaDB, with `RUNTIME.CONTRACT_TARGET_MISMATCH`. Before that, `prisma contract emit` refuses a TypeScript contract built with the other target's `defineContract`, with `CONTRACT.TARGET_MISMATCH`, and names the module to import it from. So a MySQL contract or migration does not serve a MariaDB database, and each target has its own example app, `examples/prisma-8-demo-mysql` and `examples/prisma-8-demo-mariadb`.

Several differences between the servers are not capabilities a flag could turn on. They change the SQL the renderer writes (the upsert), the catalog rows introspection reads (display widths, quoted defaults), and the error numbers the driver maps. Each of these belongs to a target, its adapter or its driver.

Much more is shared: the wire protocol, the `mariadb` driver package, `ON DUPLICATE KEY UPDATE`, CTEs, window functions, identifier rules, and the commit each DDL statement makes. A subclass that overrides only what differs fits that split.

## Consequences

- A fix to MySQL's planner, runner, verifier, renderer, driver or client reaches MariaDB with no MariaDB change. A change to a protected method of `MysqlSqlRenderer` must keep MariaDB's override correct.
- `@prisma/orm-target-mariadb` publishes only MariaDB's packages and depends on `@prisma/orm-target-mysql` for MySQL's, so each module has one published home ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md)). `@prisma/orm-mariadb` also depends on `@prisma/orm-mysql`, whose configuration MariaDB's builds on.
- MariaDB's types are MySQL's types. When the MySQL target gains a data type whose catalog form differs on MariaDB, such as JSON, which MariaDB stores as `longtext` with a `json_valid` check, MariaDB needs its own data type for it, or its catalog reader must convert the form as it does for integer widths.
- **Not built: reading Prisma 7 schemas for MySQL or MariaDB.** The Prisma 7 schema reader (`packages/2-sql-family/2-authoring/contract-prisma7`) reads only `provider = "postgresql"` today. Prisma 7 used one provider, `mysql`, for both servers. A reader of Prisma 7 schemas for these targets should accept `provider = "mysql"` for either target, and take the target from the `defineConfig` the application's `prisma.config.ts` calls, not from the provider.

## Alternatives considered

- **A flag on the MySQL target, or detecting the server when the client connects.** Rejected. The contract would record `mysql` for a MariaDB database, so its hashes and migrations could not say which server they were written for. The ORM chooses its strategies from the contract's capabilities, deterministically and before any connection ([ADR 164](ADR%20164%20-%20Repository%20Layer.md)), so a difference detected at connection time could not choose how includes load. And every MySQL component would branch on the flag, where the factories keep each difference in one place.
- **Copying MySQL's packages for MariaDB.** Rejected: the copies drift, and every fix must be made twice.
- **A shared base that MySQL and MariaDB both extend.** Rejected. Almost everything MariaDB does is what MySQL does, so the base would be MySQL less a few methods, and MySQL's own package would become a thin layer over it. Every later change to MySQL would first need a decision about whether it belongs in the base. Extending MySQL needs no such decision: what MariaDB does not override, it shares.

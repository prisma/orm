# Slice 6a — MariaDB target: control plane, public packages, the example migrates

**Linear:** [TML-3697](https://linear.app/prisma-company/issue/TML-3697). **Research:** `wip/slice6-research.md` (gitignored; probes against MariaDB 10.11 on 2026-11-06).

## At a glance

```ts
// examples/prisma-8-demo-mariadb/prisma.config.ts
import { defineConfig } from '@prisma/orm-mariadb/config'

export default defineConfig({ contract: './prisma/contract.prisma', db: { url: process.env.MARIADB_URL } })
```

```bash
pnpm prisma-next contract emit   # contract.json has "target": "mariadb"
pnpm prisma-next migrate         # plans, applies and verifies on MariaDB 10.11
pnpm prisma-next db verify       # passes
pnpm prisma-next db sign
```

Before this slice there is no `mariadb` target. Pointed at MariaDB, the MySQL target fails on every connection (`transaction_isolation` is unknown before MariaDB 11.1), on every introspection (no `STATISTICS.EXPRESSION`), on every marker write (`AS incoming` row alias), and `db verify` rejects `int(11)` and `current_timestamp(3)`.

## Chosen design

1. **`mariadb` is a target of its own that extends MySQL** (project decision 4), in `packages/3-targets/mariadb/{1-target,2-adapter,3-driver,9-facade}`. `3-driver` is thin: it builds MySQL's driver with the target id `'mariadb'` and copies no driver code.
2. **MySQL takes the target id and the differing parts as parameters, without changing its behaviour.** Defaults are MySQL's values; types take a target-id parameter that defaults to `'mysql'`. The places:
   - the control target factory, with the target id and the migration module path (`@internal/mysql/migration` today, `render-typescript.ts:29-30`);
   - the planner's operations (`target.id`), `MysqlMigration.targetId` (`mysql-migration.ts:32`) and the operation renderer's id check (`render-ops.ts:14`);
   - the control adapter factory, with one options object: the target id and a catalog reader. The class stays private (`interface-factory-pattern.mdc`);
   - the driver descriptors and the driver classes (target id);
   - the facade's config factory, with the target's parts.

   The schema verifier needs no change: it does not read defaults or name a target.
3. **What MariaDB changes, each from a probe:**
   - Session setting `tx_isolation = 'READ-COMMITTED'` instead of `transaction_isolation`, which MariaDB 10.11 lacks.
   - **The catalog reader converts MariaDB's catalog rows to MySQL's form** before MySQL's introspection reads them, so MySQL's default reader and type mapping stay unchanged:
     - indexes are read without `STATISTICS.EXPRESSION` (MariaDB has no functional indexes);
     - integer display widths are removed from `tinyint`, `smallint`, `mediumint`, `int` and `bigint`, keeping `unsigned`, as MySQL 8.0.19 and later report them. A signed `tinyint(1)` and `zerofill` columns keep their width; `tinyint(1) unsigned` becomes `tinyint unsigned`, as MySQL 8.4 prints it. The rule applies to `column_type` before the type text and the reported type are built;
     - defaults: the text `NULL` becomes SQL NULL; a quoted literal is unquoted, with `''` and backslash escapes decoded; a function such as `current_timestamp(3)` is marked as generated, as MySQL's `DEFAULT_GENERATED` does; unquoted numbers stay literals.
4. **The marker upsert binds its values twice** in `ON DUPLICATE KEY UPDATE` instead of naming a row alias. It works on both servers, needs no override, and avoids `VALUES()`, which MySQL deprecates. `db sign` already uses insert and compare-and-swap, which MariaDB accepts.
5. **Data types and codecs are shared.** MariaDB's descriptor meta lists MySQL's data types and codecs with their `mysql/…` ids. No shared code compares a codec id's prefix with the target. A codec reads the same wire value on both servers.
6. **Public packages follow ADR 242's one-owner rule.** `@prisma/orm-target-mariadb` publishes only the MariaDB internal packages and depends on `@prisma/orm-target-mysql` for MySQL's. `@prisma/orm-mariadb` republishes every module MariaDB's emitted files import: its own `codec-types`, `/config`, `/migration` and the driver descriptors. `import-roots.test.ts` gets a MariaDB case. `mariadb()` comes in 6b.
7. **A second example, `examples/prisma-8-demo-mariadb`.** The target id is part of `contract.json`, both hashes, the migration snapshots, `ops.json` and each `migration.ts`, so one example cannot serve both servers. In 6a it holds the contract, the config, the migrations and the migration tests, without the runtime files (`db.ts`, the ORM client, queries, seed and their tests), which 6b adds.
8. **CI and local servers.** A `mariadb:10.11` service in the Package Tests and Test Examples jobs, on a port that does not clash with MySQL's, with `MARIADB_URL`; a matching `docker-compose.yaml` service. The example's `turbo.json` declares `MARIADB_URL`, and its tests fail in CI when the variable is missing instead of skipping. `withMysqlDatabase` takes the variable name.
9. **MariaDB reports `returning: false`**, as MySQL does. Splitting `returning` by statement kind is filed (`deferred.md`): the slice 4 read-back serves every write on MariaDB (probed), so the split saves round trips, not correctness.
10. **What a new target id changes:** MariaDB's hashes differ from MySQL's for the same schema; an extension pack built for `mysql` is refused on `mariadb`; `fixtures:emit` needs a filter for the new example. Error metadata still says `target: 'mysql'` for errors raised in shared MySQL code (`errors.ts:36`); 6b decides whether that matters at runtime.

## Coherence rationale

This slice makes MariaDB a target the CLI can emit, migrate, verify and sign against, and gives it its public packages and its example in CI. 6b adds the runtime (`mariadb()`, includes, upsert, the example reads and writes). The split follows the MySQL slices 2a–2c and 3–4: the research sized the whole MariaDB target at 3.8k–5.5k lines.

## Scope

**In:** the MySQL extension points above; `mariadb` target, control adapter and facade config; the session setting; introspection, default reader, marker upsert; public packages and their registration (`shells.ts`, `architecture.config.json`, turbo, publish tests, ADR 242's package count); CI and compose services; MariaDB live tests for the control adapter, introspection and migrate; the example emits, migrates, verifies and signs in CI.

**Deliberately out:** TypeScript contract authoring for `mariadb` (`defineConfig` takes PSL contracts only; the MySQL contract pack builds `'mysql'` contracts); the runtime adapter and SQL renderer, `mariadb()`, includes, upsert rendering, ORM live tests (6b); JSON and boolean data types (MySQL has none yet); `returning` split by statement kind; MariaDB-only types (`UUID`, `INET4`, `INET6`).

## Pre-investigated edge cases

| Case | Handling |
| --- | --- |
| The config loader rejects a driver whose `targetId` differs from the target's (`config-loader/src/orm-section.ts:146`) | The MySQL driver descriptors take the target id; MariaDB builds its own |
| A CHECK violation has SQLSTATE `23000` on MariaDB, `23514` on MySQL | Recorded in the MariaDB tests as a server difference; no mapping change in this slice |
| `regen-example-migrations` does not cover MySQL (coupling row 27) | It does not cover MariaDB either; the example's migrations are planned by the CLI |
| A new package name needs a hand-published placeholder before trusted publishing accepts it (`@prisma/orm-mysql` got `0.0.0-stage` a minute before its first release) | Stated in the PR as a step before the release that carries the packages |
| MariaDB's `JSON` is `longtext` with a `json_valid` check | Nothing to do: MySQL has no JSON data type yet. Recorded in `deferred.md` for when it gets one |

## Done when

`examples/prisma-8-demo-mariadb` emits, migrates, verifies and signs against MariaDB 10.11 in the Test Examples CI job, and the MySQL tests still pass unchanged. Type tests cover the `'mariadb'` target id, and no `'mysql'` literal appears in the MariaDB packages outside imports.

# Changelog

The rolling, newest-first index of Prisma Next releases. Each entry mirrors the release's committed notes file under [`docs/releases/`](docs/releases/) (the body of its GitHub Release) under a `## v<version>` header — see [`docs/releases/README.md`](docs/releases/README.md) for the convention and authoring template.

Changelog tracking starts at **v0.12.0**, the first release cut after this convention landed. For **v0.11.0 and earlier**, see the [GitHub Releases](https://github.com/prisma/prisma-next/releases) page — historical notes are not backfilled here.

<!-- New release entries go here, newest first, each mirroring docs/releases/v<version>.md under a `## v<version>` header. -->

## v8.0.0-rc.5

The ORM command family now ships the unified CLI's command paths directly, the Postgres runtime survives dropped idle connections, aggregation respects the chain it terminates, and the raw lane lets an outer query reuse an inner query's typed return columns.

The upgrade recipe for this hop: the [user recipe](https://github.com/prisma/prisma/tree/v8.0.0-rc.5/skills/prisma-next-upgrade/upgrades/8.0.0-rc.4-to-8.0.0-rc.5/).

### Breaking changes

- **The ORM command family is keyed by the unified CLI's mount paths** — `@prisma/orm-toolchain`'s command family now publishes the six moved commands under their unified spellings (`contract format`, `db migrate`, `migration ref list|set|delete`, `orm init`) instead of the retired standalone grammar (`format`, `migrate`, `ref …`, `init`), and every help example and error remediation names those paths (with the `{bin}` placeholder instead of a hardcoded binary name). Through the unified `prisma` CLI nothing moves — these were already the mounted paths — but a host that mounts the family by key, or a script driving the workspace binary with the old spellings, must respell the six commands. ([#30102](https://github.com/prisma/prisma/pull/30102))

  Before:

  ```bash
  prisma migrate --to production
  prisma ref set staging 4cb4256
  ```

  After:

  ```bash
  prisma db migrate --to production
  prisma migration ref set staging 4cb4256
  ```

### Features

- A row-spec'd raw query exposes `.returns`, a record of typed column refs, so an outer raw query can reuse an inner query's declared column (for example a CTE's aggregate) instead of restating its codec id. ([#30075](https://github.com/prisma/prisma/pull/30075))

### Fixes

- `aggregate()` now reduces over exactly the rows a chain's `take` / `skip` / `cursor` / `distinct` / `distinctOn` describes, instead of silently reducing over every matching row. ([#30067](https://github.com/prisma/prisma/pull/30067))
- `groupBy()` now scopes pre-group pagination to the rows it groups instead of dropping it, and `GroupedCollection` gained `take` / `skip` / `orderBy` to page the groups themselves. ([#30092](https://github.com/prisma/prisma/pull/30092))
- The Postgres runtime attaches `'error'` listeners to every pool and client it creates or receives, so a dropped idle connection (database restart, pooler timeout, network blip) no longer crashes the process as an uncaught exception. Pools your own code constructs and uses directly still need a listener — see the [upgrade recipe](https://github.com/prisma/prisma/tree/v8.0.0-rc.5/skills/prisma-next-upgrade/upgrades/8.0.0-rc.4-to-8.0.0-rc.5/). ([#30081](https://github.com/prisma/prisma/pull/30081))
- The PSL language server recognizes connection errors raised by any bundled copy of vscode-jsonrpc, instead of crashing when a duplicated copy raised them. ([#30077](https://github.com/prisma/prisma/pull/30077))
- CLI error text interpolates the configured migrations directory instead of assuming the default path. ([#30041](https://github.com/prisma/prisma/pull/30041))
- `orm init`'s failure messages no longer name retired flags or binaries (`--no-skill`, `--force`, `prisma-cli init`); they point at the flags that exist (`--skip-skills`, `--confirm <directory name>`) and the mounted `prisma orm init`. ([#30083](https://github.com/prisma/prisma/pull/30083))

## v8.0.0-rc.2


This release retires the `prisma-next` binary in favour of the unified `prisma` CLI, returns the default aggregates to plain JavaScript numbers with lossless variants beside them, makes CHECK constraints a declared part of the contract, and splits runtime row queries from non-returning writes. Almost every application will need to re-emit its contract and rename its config file, so read the breaking changes before upgrading.

Two upgrade recipes carry the mechanical translations for this hop: the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/) and the [extension-author recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-8-extension-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/).

### Breaking changes

- **This repository no longer publishes a CLI; the unified `prisma` CLI replaces it** — nothing published ships a `prisma-next` bin anymore. `@prisma/orm-toolchain` exposes the `orm` command family at `@prisma/orm-toolchain/cli` and no binary, and the database facades forward no launcher. Install `@prisma/cli` (the prisma-cli distribution, published under `next` for the v8 line) and replace `prisma-next <command>` in package scripts and CI with the unified CLI. The config file moves with it: `prisma-next.config.ts` is deprecated in favour of `prisma.config.ts`, and the config value is now engine-shaped, with your existing ORM config nested under an `orm` section. Both the old filename and the flat shape still load, each printing a deprecation warning on stderr, so the rename and the rewrap can land separately. See the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#30005](https://github.com/prisma/prisma/pull/30005))

  Before:

  ```ts
  // prisma-next.config.ts
  import { defineConfig } from '@prisma/orm-postgres/config';

  export default defineConfig({ contract: './contract.ts', output: './generated' });
  ```

  After:

  ```ts
  // prisma.config.ts
  import { defineConfig } from '@prisma/cli-engine';
  import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

  export default defineConfig({
    orm: ormConfig({ contract: './contract.ts', output: './generated' }),
  });
  ```

- **The default aggregates are JavaScript numbers again, with lossless variants beside them** — `count()`, `sum()` over an integer column, and `avg()` over an integer column all return `number`. In `8.0.0-rc.1` they returned a `bigint`, a `bigint` or decimal string depending on the column's width, and a decimal string respectively. The lossless results moved to three new operations: `countBigInt()` returns a `bigint`, `sumBigInt()` returns a `bigint`, and `avgDecimal()` returns an exact decimal string (PostgreSQL only — SQLite has no decimal type and contributes none). A `count()` or integer `sum()` whose value passes ±(2^53 − 1) now raises `RUNTIME.DECODE_FAILED` rather than returning a rounded number, so move those calls to the `BigInt` variants where the magnitude is real. Unchanged: `min`/`max`, `sum`/`avg` over a float column, `sum` over `Decimal`, `sum` over `UnboundedInt`, and the ORM's `having(...)` operands. The SQL builder's comparison operands do move, because `fns.gt(a, b)` types both sides from one codec. The same PR also makes the wide-integer codecs refuse the wrong JavaScript type: a `BigInt` or `UnboundedInt` column rejects a `number` and a `BigIntNumber` column rejects a `bigint`, with `RUNTIME.ENCODE_FAILED` naming the type that arrived, where previously a number was accepted and stringified — which let a fractional value reach an integer column unremarked. See the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#29930](https://github.com/prisma/prisma/pull/29930))

  Before:

  ```ts
  const { total } = await db.User.aggregate((a) => ({ total: a.count() }));
  total === 2n; // bigint

  const busy = await db.sql.public.user
    .groupBy('kind')
    .having((_f, fns) => fns.gt(fns.count(), 1n)); // bigint literal
  ```

  After:

  ```ts
  const { total } = await db.User.aggregate((a) => ({ total: a.count() }));
  total === 2; // number — countBigInt() returns the bigint

  const busy = await db.sql.public.user
    .groupBy('kind')
    .having((_f, fns) => fns.gt(fns.count(), 1)); // plain number literal
  ```

- **Which aggregate methods exist is now the contract's answer** — the aggregate methods are no longer declared on the ORM and SQL-builder surfaces outright. Each surface is derived from the operation names in the emitted `contract.d.ts`'s `AggregateTypes` block, so a target or extension can contribute an operation and it appears under its own name with no client change. PostgreSQL now contributes eight operations and SQLite seven. **Re-emit your contract** with the CLI's `contract emit`: against a contract with no `AggregateTypes` block — one authored in code with `defineContract(...)` and handed straight to the client, or emitted before `8.0.0-rc.1` — every aggregate surface resolves to `AggregateOperationsUnavailable`, an empty type, and each call becomes a compile error. What this release changes is compile-time only — the separate runtime guard introduced in `8.0.0-rc.1` still stands, rejecting an aggregate whose operation and input codec the composed target does not declare with `ORM.AGGREGATE_UNSUPPORTED` before the query runs. Separately, `count(field)` now renders `COUNT(<column>)` instead of accepting the argument and discarding it, so a call that got past the types — a `@ts-expect-error`, a `count(x as never)`, or dynamic dispatch — now counts that field's non-null values rather than rows. See the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/) and the [extension-author recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-8-extension-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#29922](https://github.com/prisma/prisma/pull/29922))

- **CHECK constraints are declared in the contract, and introspection now sees all of them** — the CHECK shape in `contract.json` changed from `{ name, column, valueSet }` to `{ name, prefix, expression }`, where `expression` is the raw SQL predicate and `name` is a content-addressed wire name (`<prefix>_<8hex>`, the convention indexes and RLS policies already use). An old-shape contract is rejected on read, so re-emitting is not optional. Three consequences to plan for. Your first migration plan after upgrading drops each old unsuffixed enum constraint and adds the wire-named one, which needs `destructive` to converge. Every list (`many`) column gains a declared element-non-null CHECK the planner previously created without declaring. And introspection stopped parsing predicates, so hand-written constraints earlier versions could not see are now visible — and an undeclared check is an extra that `db verify --strict` reports and a destructive-capable plan drops, so read the first plan for `dropCheckConstraint` operations naming constraints you wrote yourself, and declare each one you want to keep with `@@check(expression: "…", map: "<physical name>")`. Two API changes ride along: `addCheckConstraint` in committed migration files takes an `expression` instead of a `column`/`values` pair, and the `typescriptContract` options bag now requires `createNamespace` whenever it passes `defaultControlPolicy`. An `enumType()` whose codec is numeric now throws `CONTRACT.ENUM_INVALID` while the contract is being built rather than failing later at migrate time. See the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/) and the [extension-author recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-8-extension-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#29892](https://github.com/prisma/prisma/pull/29892))

  Before:

  ```ts
  this.addCheckConstraint({ schema, table, constraint, column: 'kind', values: ['admin', 'user'] });
  ```

  After:

  ```ts
  this.addCheckConstraint({ schema, table, constraint, expression: `"kind" IN ('admin', 'user')` });
  ```

- **Runtime row queries and non-returning writes are separate calls** — `query()` streams rows and `execute()` resolves `{ affectedRows }`, which is how a write now reports its affected count without a preceding `SELECT`. Classify each call site by the result it consumes rather than replacing every `execute`: a select, a returning write, or any plan whose rows are iterated, indexed, or decoded moves to `query`, while an insert, update, or delete that returns nothing stays on `execute` and reads `affectedRows`. Prepared row consumption moves from `target.queryPrepared(prepared, params)` to `prepared.query(target, params)`. Runtime middleware splits the same way, into `beforeQuery` / `interceptQuery` / `afterQuery` and `beforeExecute` / `interceptExecute` / `afterExecute` with a shared `beforeCompile`; query interception returns `{ rows }` and execute interception returns `{ stats }`. There is no operation discriminator, compatibility alias, or generic fallback hook. On Mongo, `db.query` stays the static builder and the row-executing `db.execute` facade method is gone — build with `db.query`, then execute through `(await db.runtime()).query(plan)`. See the [user recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-next-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#29921](https://github.com/prisma/prisma/pull/29921))

- **`raw` is a reserved storage namespace** — the SQL surface exposes the whole-query raw statement tag as `db.sql.raw`, so a storage namespace of that name would be unreachable through the builder while the emitted types still promised its tables. Building the client now raises `ORM.NAMESPACE_RESERVED` naming the namespace. Rename it in your schema, re-emit the contract, and plan the rename against the database as you would any other namespace rename. Only `raw` is reserved. ([#29997](https://github.com/prisma/prisma/pull/29997))

  Before:

  ```prisma
  model Event {
    id String @id
    @@schema("raw")
  }
  ```

  After:

  ```prisma
  model Event {
    id String @id
    @@schema("ingest")
  }
  ```

- **Codec ids are checked where you write them** — a codec id in a prepared declaration or in a contract-bound raw fragment is now checked against your contract's codec map, so an id the contract does not carry is a compile error instead of an execution-time `RUNTIME.PARAM_REF_MISSING_CODEC`. The usual cause is an unversioned id. Read the correct spelling off your emitted `contract.d.ts` — every id it carries now completes at both positions. A raw fragment built through a contract-free lane is unaffected, since it has no map to check against. ([#30011](https://github.com/prisma/prisma/pull/30011))

  Before:

  ```ts
  await db.prepare({ id: 'pg/int4' }, (sql, params) => /* … */);
  const upper = fns.raw`UPPER(${f.email})`.returns('pg/text');
  ```

  After:

  ```ts
  await db.prepare({ id: 'pg/int4@1' }, (sql, params) => /* … */);
  const upper = fns.raw`UPPER(${f.email})`.returns('pg/text@1');
  ```

- **`db update` takes consent by database name, and `--yes` no longer grants it** — a plan that would destroy data is refused until you type the name of the connected database, and the consent binds to that exact plan by hash. `--yes` never grants it; the CLI style guide has always said a blanket confirmation flag must not stand in for a destructive confirmation. Non-interactive runs grant with `--confirm <database>`. A dry run, or a plan with nothing destructive in it, never asks. Update any CI invocation that relied on `-y` to apply a destructive plan. ([#29986](https://github.com/prisma/prisma/pull/29986))

- **The diagnostic commands exit 4 on findings and 2 on errors** — `db verify`, `db sign`, and `migration check` now distinguish "I ran and found problems" (exit 4) from "I could not run" (exit 2). Exit 1 is reserved for a bug in the CLI itself, and exit 0 still means the check ran and found nothing. `db verify` and `db sign` previously exited 1 on findings, and `migration check` exited 2. Scripts that test for any non-zero exit are unaffected; scripts that match a specific code must be updated. ([#29984](https://github.com/prisma/prisma/pull/29984))

- **Four `migration status` flags are retired** — `--graph`, `--all`, `--limit`, and `--ref` moved to their own commands. An old invocation now gets a typed `CLI.COMMAND_MOVED` error naming the replacement rather than failing as an unknown flag. ([#29982](https://github.com/prisma/prisma/pull/29982))

- **Prepared statements split by their declared result** — `runtime.prepare()` returns one of two handles chosen from the plan the callback builds: a rows plan gives the `PreparedStatement` you already have, consumed with `.query(target, params)`, while a plan whose declared result is an affected-row count gives a `PreparedExecution`, consumed with `.execute(target, params)`. This matters to extension authors: a facade that redeclares `prepare()` changes its return type to `PreparedFor` with no logic change, and a scope that installs the prepared-query bridge must also install the execute bridge or `prepared.execute` throws on the bridge invariant. See the [extension-author recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.2/skills/prisma-8-extension-upgrade/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/). ([#30006](https://github.com/prisma/prisma/pull/30006))

### Features

- Whole-query raw SQL replaces the classic `$queryRaw` / `$executeRaw` use case. A whole statement is authored with the same tagged template the fragment mechanism already used, terminated with `.returnsRow(rowSpec)` for decoded, typed rows or `.affectedCount()` for a mutation count, and built into an ordinary query plan that flows through the existing lowering, codec, guardrail, and execution machinery — no new query lane and no new execution surface. Row-returning raw queries interpolate into other raw templates as subqueries, which gives CTEs, including data-modifying ones, for free. ([#29997](https://github.com/prisma/prisma/pull/29997))
- `@@check(expression: "…")` declares a CHECK constraint in the schema, and `contract infer` adopts the ones your database already has. Use `name:` for a wire-name prefix, so the physical constraint is `name_<8hex>` hashed over the predicate and compared by name — which means Postgres reprinting the expression never causes drift. Use `map:` to adopt a constraint under its existing physical name, comparing the predicate byte-for-byte. Pulling a database now emits `@@check` for every live check Prisma Next did not derive, so a hand-written constraint is declared from the first pull instead of reading as an undeclared extra. ([#29972](https://github.com/prisma/prisma/pull/29972))
- `@noCheck` opts a column out of the CHECK constraints Prisma Next derives for it, per kind: `@noCheck` suppresses all of them, `@noCheck(membership)` keeps the element-non-null check on a list column while dropping the membership check, and `@noCheck(elementNotNull)` does the reverse. The TypeScript builder equivalent is `.noCheck(...)`. `contract infer` emits the attribute too, so a pulled schema passes `db verify --schema-only` immediately instead of needing one migration first. ([#29928](https://github.com/prisma/prisma/pull/29928))
- Two new column types make integer representation a per-column choice without changing the lossless `BigInt` default. `BigIntNumber` reads and writes as a JavaScript `number`, throwing outside ±(2^53 − 1) instead of rounding. `UnboundedInt` uses PostgreSQL unconstrained `numeric` storage and round-trips integral values as exact `bigint` values at arbitrary magnitude. PostgreSQL contributes both; SQLite contributes `BigIntNumber`. ([#29902](https://github.com/prisma/prisma/pull/29902))
- The minimum supported PostgreSQL version drops from 17 to 15, the oldest version CI has been exercising all along. `init` scaffolds and the `--probe-db` warning threshold follow the new floor. The reasoning is recorded in ADR 244. ([#29971](https://github.com/prisma/prisma/pull/29971))
- Renaming a model or column whose CHECK constraint content is unchanged now plans a single `ALTER TABLE … RENAME CONSTRAINT`, classed `widening`, instead of a drop plus an add. A cosmetic rename no longer needs a destructive-capable plan or a full table revalidation. ([#29894](https://github.com/prisma/prisma/pull/29894))
- Errors carry typed next actions. A failure that has a remedy now ships it as structured data — `nextActions`, each naming a command to run — raised at the site that holds the arguments rather than spelled out in English prose a caller would have to parse. The binary name is templated at the raise site and substituted when rendered, so the suggestion stays correct as the CLI is renamed. ([#29977](https://github.com/prisma/prisma/pull/29977))
- CLI failures report their real error code. `envelope.code` is the stable surface consumers branch on, and a dozen failures previously reported `CONTRACT.VERIFY_FAILED` while hiding the true code in metadata. Every construction site now declares its code explicitly, fourteen new codes were added for the failures that had none, and the generic error path gained `cause` support. ([#29919](https://github.com/prisma/prisma/pull/29919))
- Config loading reports diagnostics per section instead of throwing on the first problem it finds. A command fails only when a section it actually reads is broken, so a malformed `formatter` section no longer blocks `db init`. Each diagnostic is tagged with the config section and field it concerns. ([#29936](https://github.com/prisma/prisma/pull/29936))

### Fixes

- `init` no longer fails at its contract-emit step against the published packages. The step now runs the scaffolded project's own CLI binary as a subprocess rather than loading the new config in-process with the running CLI's bundled loader, and its failure message carries the child's stderr so a real cause is visible. The schema-path prompt also shows its default as placeholder text instead of looking blank until a keypress. ([#30018](https://github.com/prisma/prisma/pull/30018))
- `contract emit` picks the import specifier for the emitted `contract.d.ts` by reading the nearest `package.json` above the file it is writing, rather than falling back to the process working directory. Running the command from the wrong directory previously wrote an unresolvable internal specifier into the generated file. ([#29981](https://github.com/prisma/prisma/pull/29981))
- Synthesized foreign-key-backing index name prefixes are truncated to fit PostgreSQL's 63-byte identifier limit, so a mapped explicit join table no longer fails `contract emit` before the content hash can be appended. User-authored over-budget index prefixes still fail loudly. ([#30025](https://github.com/prisma/prisma/pull/30025))
- A raw row spec column named `__proto__` is now refused loudly instead of silently vanishing — bracket assignment onto an object literal hit the inherited setter, so the key never became an own property and the record was quietly re-parented. `constructor` and `prototype` create ordinary own properties and round-trip faithfully. ([#30014](https://github.com/prisma/prisma/pull/30014))
- The PostgreSQL direct driver no longer ends a caller's transaction. A driver-level read issued while its connection held an open transaction reported no transaction in progress, took the cursor portal-protection path, and wrapped itself in `BEGIN`/`COMMIT` — and that `COMMIT` ended the caller's transaction, so later statements ran autocommit and `ROLLBACK` undid nothing. The driver and its connection now share the transaction-open flag. ([#29920](https://github.com/prisma/prisma/pull/29920))
- ORM mutation reloads encode `Bytes` identities through the column codec, so a repeated upsert keyed on a `Bytes` column no longer raises `ORM.MUTATION_ROW_MISSING`. Every unbound literal entering a select through raw collection state now becomes a typed parameter. ([#29910](https://github.com/prisma/prisma/pull/29910))

### New contributors

- [@EmaToplek](https://github.com/EmaToplek) made their first contribution in [#29903](https://github.com/prisma/prisma/pull/29903)

## v8.0.0-rc.1

This is the first release on the v8 release-candidate line: releases are now versioned `8.0.0-rc.N` instead of `0.x` minors. It also makes every aggregate read back through the codec its target declares — `count()` returns a `bigint` — splits the SQL driver interface into a row-streaming call and a statistics call, and fixes four defects in query planning, emit, and driver error reporting.

### The v8 release-candidate line

Releases are now versioned `8.0.0-rc.1`, `8.0.0-rc.2`, and so on, with the counter advancing on every release. "The v8 RC" is the product name; the number underneath iterates freely, so there is no promise that the last RC before `8.0.0` final is numbered `rc.1`. There are no further `0.x` minors. The policy is written up in [`docs/oss/versioning.md`](https://github.com/prisma/prisma/blob/v8.0.0-rc.1/docs/oss/versioning.md). ([#29899](https://github.com/prisma/prisma/pull/29899))

For every package this repository publishes, `latest` keeps tracking the newest release, RC included. These package names have no pre-v8 stable audience to protect — a bare `npm install` of one of them was already an early-access install, and still is. The bare `prisma` package is not published from this repository; its v8 CLI shim lives in [prisma/prisma-cli](https://github.com/prisma/prisma-cli).

**Existing installs are not moved onto the RC line by `npm update`.** Lockfiles pin resolved versions, and a `^0.x` range can never match a `8.0.0-rc.N` pre-release, because pre-releases do not satisfy stable ranges. Only a fresh install, or an explicit version change on your side, lands on the RC.

Development builds move to the same line: every push to `main` that does not change the root version publishes `8.0.0-rc.X-dev.N` under the `dev` dist-tag.

**An RC respin may still contain breaking changes.** Until `8.0.0` final ships, the pre-1.0 latitude documented in [`docs/oss/versioning.md`](https://github.com/prisma/prisma/blob/v8.0.0-rc.1/docs/oss/versioning.md) carries over: a new `rc.N` may remove or rename APIs, change the semantics of existing ones, or change the contract format. Read the breaking-changes section of each release before you upgrade.

### Breaking changes

- **Aggregate results carry the codec their target declares** — an aggregate is now read back through the codec its target declares for that result rather than through whatever the driver handed over, so aggregate application types change. `count()` is a `bigint` on both PostgreSQL and SQLite, at the top level and inside an include, and an empty relation reads `0n`. On PostgreSQL, `sum` over `int2`/`int4` widens to a `bigint`, while `sum(int8)` and `avg` over any integer are `numeric` and read as exact decimal **strings**; `min`/`max` keep the column's own type, except over `varchar`, which returns `text`. On SQLite, `sum` over an integer column is a `bigint` and `avg` is always a `number`. Sweep your code for equality and arithmetic against an aggregate result (`count === 2` is false when `count` is `2n`) and for `JSON.stringify` over one (it throws on a bigint). `having(...)` operands are the exception and stay plain numbers — they are compared inside SQL and never cross a codec. Regenerate your contracts (`prisma-next contract emit`): `contract.d.ts` gains an `AggregateTypes` block that both the ORM and the SQL builder resolve result types from, and against an older contract an aggregate resolves to `never` in the ORM and `unknown` in the SQL builder. The type is not the only guard: an aggregate whose operation and input codec the composed target does not declare is rejected before the query runs, with the error code `ORM.AGGREGATE_UNSUPPORTED`. See the [upgrade recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.1/skills/prisma-next-upgrade/upgrades/0.17-to-8.0.0-rc.1/) and the [extension-author recipe](https://github.com/prisma/prisma/blob/v8.0.0-rc.1/skills/prisma-8-extension-upgrade/upgrades/0.17-to-8.0.0-rc.1/). ([#29867](https://github.com/prisma/prisma/pull/29867))

  Before:

  ```ts
  const rows = await posts.include('comments', (comments) => comments.count()).all();
  rows[0].comments === 2; // number; 0 when the relation is empty
  ```

  After:

  ```ts
  const rows = await posts.include('comments', (comments) => comments.count()).all();
  rows[0].comments === 2n; // bigint; 0n when the relation is empty
  ```

- **The SQL driver interface splits row streaming from statement statistics** — `SqlQueryable` (exported from `@internal/sql-relational-core/ast`) is now two methods wide: `query()` streams rows and `execute()` returns `{ affectedRows }`. The separate prepared-execution method is gone; a prepared plan is expressed by an optional `preparedStatementHandle` on the request instead, and a driver branches on whether that property is `undefined`. Application code, query results, and the contract format are unaffected — this only matters if you implement or wrap `SqlQueryable` yourself, in which case update your implementation to the two-method shape. There is no upgrade recipe entry for this; the change is the interface itself. ([#29907](https://github.com/prisma/prisma/pull/29907))

  Before:

  ```ts
  interface SqlQueryable {
    execute<Row>(request: SqlExecuteRequest): AsyncIterable<Row>;
    executePrepared<Row>(request: PreparedExecuteRequest): AsyncIterable<Row>;
    query<Row>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
  }
  ```

  After:

  ```ts
  interface SqlQueryable {
    query<Row>(request: SqlExecuteRequest): AsyncIterable<Row>;
    execute(request: SqlExecuteRequest): Promise<SqlStatementStats>;
  }
  ```

### Features

- `prisma-next init` installs one `prisma-8` skill instead of eleven per-workflow skills, and removes the retired skill directories from every agent's install root on each run. Each skill is now installed by name — `prisma-8`, `prisma-next-upgrade`, and `prisma-8-extension-upgrade` — rather than by matching a wildcard against a directory, so a new skill landing beside them is not picked up by accident. ([#29853](https://github.com/prisma/prisma/pull/29853))

### Fixes

- A column, table, or model mapped to a name that is not a bare TypeScript identifier — `@map("has space")`, `@@map("data rows")` — now emits a quoted property key in `contract.d.ts` instead of producing a syntactically invalid file that killed `contract emit`. String literals in emitted TypeScript also survive control characters and line separators, which previously produced the same failure by a different route. ([#29889](https://github.com/prisma/prisma/pull/29889), [#29898](https://github.com/prisma/prisma/pull/29898))
- Nested `some`/`every`/`none` predicates over a self-referential relation now keep a distinct SQL alias at every level, so an inner scope no longer shadows the parent it is supposed to correlate against. This covers one-to-one, many-to-one, one-to-many, implicit many-to-many, and explicit-junction many-to-many relations in both directions, and relations whose physical tables share a bare name across namespaces. ([#29900](https://github.com/prisma/prisma/pull/29900))
- Scalar reducers on a many-to-many include — `count()`, `sum()`, `avg()`, `min()`, `max()` — now traverse the junction table instead of emitting a predicate against a foreign-key column that only exists on the junction, so a filtered relation count over a many-to-many relation returns the right number. ([#29888](https://github.com/prisma/prisma/pull/29888))
- A failed retry of a stale PostgreSQL prepared statement now surfaces a structured error envelope with the code `DRIVER.PREPARE_FAILED`, carrying the normalized driver error as its cause, instead of an unlabelled failure. ([#29907](https://github.com/prisma/prisma/pull/29907))

## v0.17.0

This is the namespace release: Prisma Next now publishes as 17 packages under the `@prisma` scope, and an application depends on exactly one database facade. It also completes the structured error-code scheme across every plane, makes relation-loading lossless for big numbers and temporal values, and gives every SQL index and RLS policy an exact, migratable name.

### Breaking changes

- **One `@prisma` package per application** — the `@prisma-next/*` scope is retired; nothing publishes under it again. An application depends on exactly one database facade — `@prisma/orm-postgres`, `@prisma/orm-sqlite`, or `@prisma/orm-mongo` — plus any extension packs it uses (now named `@prisma/orm-extension-*`); everything else arrives as the facade's exact-pinned dependencies. Regenerating your contract rewrites generated imports to facade entrypoints with no `contractHash` change. See the [0.16-to-0.17 upgrade recipe](https://github.com/prisma/prisma/blob/v0.17.0/skills/upgrade/prisma-next-upgrade/upgrades/0.16-to-0.17/) and the [extension-author recipe](https://github.com/prisma/prisma/blob/v0.17.0/skills/extension-author/prisma-8-extension-upgrade/upgrades/0.16-to-0.17/). ([#29864](https://github.com/prisma/prisma/pull/29864), [#29880](https://github.com/prisma/prisma/pull/29880), [#29883](https://github.com/prisma/prisma/pull/29883), [#29884](https://github.com/prisma/prisma/pull/29884))

  Before:

  ```jsonc
  "dependencies": {
    "@prisma-next/postgres": "0.16.0",
    "@prisma-next/framework-components": "0.16.0",
    "@prisma-next/sql-runtime": "0.16.0"
  }
  ```

  After:

  ```jsonc
  "dependencies": {
    "@prisma/orm-postgres": "0.17.0"
  }
  ```

- **Every published error is a structured envelope with a dotted code** — the four legacy error systems (`PN-CLI-4001`-style codes, `RUNTIME.DECODE_FAILED`-style codes, and codeless error classes) consolidate into one scheme: a structural envelope carrying a `NAMESPACE.SUBCODE` code, recognized by the `isStructuredError` type predicate instead of `instanceof`. The ORM, contract-authoring, adapter/target, extension, and framework planes are all swept; legacy error classes (`PslFormatError`, the Supabase and SQL-escape classes, framework classes) are deleted. Prisma 7's `P1001`-style codes are not carried over. ([#1016](https://github.com/prisma/prisma-next/pull/1016), [#1021](https://github.com/prisma/prisma-next/pull/1021), [#1025](https://github.com/prisma/prisma-next/pull/1025), [#1049](https://github.com/prisma/prisma-next/pull/1049), [#1053](https://github.com/prisma/prisma-next/pull/1053), [#1063](https://github.com/prisma/prisma-next/pull/1063))

  Before:

  ```ts
  if (error instanceof PslFormatError) {
    report(error.diagnostics);
  }
  ```

  After:

  ```ts
  if (isStructuredError(error) && error.code === 'PSL.PARSE_FAILED') {
    report(error.meta.diagnostics);
  }
  ```

- **Content hashes are bare hex** — the `sha256:` prefix is gone from every surface (emitted contracts, migration manifests, refs, CLI output, and the database marker), and loaders reject the prefixed form. Contract hash values are unchanged; `migrationHash` values change. A codemod in the [0.16-to-0.17 recipe](https://github.com/prisma/prisma/blob/v0.17.0/skills/upgrade/prisma-next-upgrade/upgrades/0.16-to-0.17/) converts checked-in migration trees. ([#1033](https://github.com/prisma/prisma-next/pull/1033))

- **Migration contract snapshots move into a content-addressed store** — per-migration sibling snapshot files and ref-paired copies are replaced by a single `migrations/snapshots/<hex>/` store per migrations root; every distinct contract is stored once, and `migration.ts` imports its bookend contracts from the store. This is a clean break with no fallback reader; a one-shot migrator (`scripts/migrate-migrations-layout.mjs`) converts existing trees and re-verifies every `migrationHash` unchanged. ([#1018](https://github.com/prisma/prisma-next/pull/1018), [#1024](https://github.com/prisma/prisma-next/pull/1024))

- **PostgreSQL native types are authored in type position; the `@db.*` attribute channel is removed** — write the native type directly (`VarChar(255)`, `Uuid`, `Timestamptz`) instead of a base type plus `@db.*` attribute; remaining `@db.X(args)` usage fails with the exact replacement spelled out. `Json` re-binds to native `json` storage, with a new `Jsonb` scalar for jsonb (what every pre-0.16 `Json` field meant — switch those fields to keep a byte-identical contract), and `Date` re-binds to the correct `pg/date@1` codec. ([#1022](https://github.com/prisma/prisma-next/pull/1022), [#1036](https://github.com/prisma/prisma-next/pull/1036), [#1054](https://github.com/prisma/prisma-next/pull/1054))

  Before:

  ```prisma
  model User {
    id    String @id @db.Uuid
    name  String @db.VarChar(255)
  }
  ```

  After:

  ```prisma
  model User {
    id    Uuid         @id
    name  VarChar(255)
  }
  ```

- **Relation-loading and aggregates are lossless** — values read through `.include()` no longer pass through lossy JSON: every codec gains an explicit lossless JSON form produced inside the database. 64-bit integers arrive as `bigint` instead of silently rounding, decimals as exact strings, and temporal columns decode correctly. Aggregate result types change accordingly: `count()` is a `bigint`, decimal sums are strings. Regenerate your contract after upgrading. ([#29844](https://github.com/prisma/prisma/pull/29844), [#1023](https://github.com/prisma/prisma-next/pull/1023), [#1051](https://github.com/prisma/prisma-next/pull/1051))

- **SQL indexes and RLS policies are name-identified** — every index and RLS policy carries an exact name in the contract, names travel on the wire, live objects can be adopted by exact name (`@@map`), and a rename converges by renaming instead of drop-and-recreate. ([#1047](https://github.com/prisma/prisma-next/pull/1047), [#29807](https://github.com/prisma/prisma/pull/29807), [#29865](https://github.com/prisma/prisma/pull/29865))

- **`extensionPacks` config key renamed to `extensions`** — in `prisma-next.config.ts`, the TS builder, client options, and the emitted contract's top-level key. The old key fails loudly. Because the key sits in the hashed contract bytes, all contract hashes change: re-emit and re-anchor migrations per the recipe. Two smaller key renames ride along: `contract.source.sourceFormat` → `format`, and the facade `defineConfig` option `outputPath` → `output`. ([#1032](https://github.com/prisma/prisma-next/pull/1032))

- **Count-only mutation terminals renamed** — `createCount(...)` / `updateCount(...)` / `deleteCount()` become `createAndCount(...)` / `updateAndCount(...)` / `deleteAndCount()`; behavior and `Promise<number>` results are unchanged, with no compatibility aliases. ([#1044](https://github.com/prisma/prisma-next/pull/1044))

### Features

- Expression, partial, and unique indexes are authorable in both PSL and the TypeScript builder. ([#1048](https://github.com/prisma/prisma-next/pull/1048))
- `contract infer` reaches full fidelity — indexes, policy blocks, and `@@rls` are captured — and signs the database, so introspect-then-verify works end to end on an adopted database. It also infers 1:1 relations from unique indexes. ([#29808](https://github.com/prisma/prisma/pull/29808), [#1038](https://github.com/prisma/prisma-next/pull/1038))
- Every error code is documented on an in-repo reference page (221 codes), kept complete by a CI check, and error envelopes carry a `docsUrl` pointing at their per-code anchor. ([#1027](https://github.com/prisma/prisma-next/pull/1027), [#29806](https://github.com/prisma/prisma/pull/29806))

### Fixes

- MongoDB write results decode through their type codecs instead of returning raw wire values. ([#29879](https://github.com/prisma/prisma/pull/29879))
- The Postgres runtime driver serializes queries per pinned client, fixing interleaved-query failures on a shared connection. ([#29839](https://github.com/prisma/prisma/pull/29839))
- Mixed-case native-enum casts are quoted, so PascalCase enum type names survive Postgres case-folding. ([#1034](https://github.com/prisma/prisma-next/pull/1034))
- Driver cursor streaming runs inside an explicit transaction, fixing dropped-portal failures under load. ([#1017](https://github.com/prisma/prisma-next/pull/1017))
- Published type declarations name only dependencies a consumer will actually have installed. ([#29862](https://github.com/prisma/prisma/pull/29862))


## v0.16.0

This release makes `contract infer` output round-trip cleanly through `contract emit`, materializes foreign keys and indexes as discrete contract entities, fixes the first-run experience of the Supabase extension end to end, and adds per-codec temporal presets that spell column type and auto-update behavior together.

### Breaking changes

- **Foreign keys and indexes are discrete contract entities** — `contract emit` now materializes each foreign key's `constraint`/`index` authoring booleans into separate persisted entities: a `foreignKeys[]` entry is the referential constraint only, and every backing index (including one backing a foreign key) is its own named `indexes[]` entry. The authoring surface is unchanged (`@relation(index:)`, TS `fk({ constraint, index })`, `foreignKeyDefaults`), and re-running `contract emit` regenerates the new shape with no source change. TypeScript that read `.constraint` / `.index` off a contract's `foreignKeys[]` entry must read the discrete `indexes[]` entry instead. No migration or DDL change — the schema the planner and `db verify` derive is identical. See the [0.15-to-0.16 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.16.0/skills/upgrade/prisma-next-upgrade/upgrades/0.15-to-0.16/) and the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.16.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.15-to-0.16/). ([#989](https://github.com/prisma/prisma-next/pull/989))

  Before:

  ```jsonc
  "foreignKeys": [ { "source": { "columns": ["user_id"] }, ..., "constraint": true, "index": true } ],
  "indexes": []
  ```

  After:

  ```jsonc
  "foreignKeys": [ { "source": { "columns": ["user_id"] }, ... } ],
  "indexes": [ { "columns": ["user_id"], "name": "identities_user_id_idx" } ]
  ```

- **A singular back-relation over a non-unique foreign key is rejected at emit** — a schema declaring a 1:1 relation whose foreign-key columns are not covered by a unique constraint previously emitted a contract claiming a guarantee the database cannot enforce. Emit now fails with `PSL_NON_UNIQUE_BACKRELATION`; add `@unique`/`@@unique` to the foreign-key fields, or make the back-relation field a list. ([#1015](https://github.com/prisma/prisma-next/pull/1015))

  Before (accepted, emitted `cardinality: '1:1'`):

  ```prisma
  model Profile {
    id     Int  @id
    userId Int              // no @unique
    user   User @relation(fields: [userId], references: [id])
  }

  model User {
    id      Int      @id
    profile Profile?
  }
  ```

  After: the same schema fails emit with `PSL_NON_UNIQUE_BACKRELATION`. Add `@unique` to `userId` (or make `profile` a `Profile[]` list).

- **`contract infer` declares identity-column defaults, and `db verify --strict` now sees them** — infer emits `@default(autoincrement())` for a Postgres `GENERATED ... AS IDENTITY` column (previously nothing), and `db verify` introspecting a live identity column resolves its default to `autoincrement()` too. If you run `db verify --strict` against a table with an identity column whose contract predates this fix, verify reports that default as an unexpected extra — re-run `contract infer` for the affected table, or add `@default(autoincrement())` by hand. Without `--strict`, nothing changes. ([#1011](https://github.com/prisma/prisma-next/pull/1011))

- **`contract infer` back-relation names no longer double-pluralize** — the hand-rolled pluralization rule turned already-plural table names into `sessionses`; infer now uses real inflection (`sessions` stays `sessions`, `status` still becomes `statuses`). Already-generated `.prisma` files are untouched, but the next `contract infer` run against a database with already-plural table names renames the affected back-relation fields — public field names your code reaches via `.include()`/`.select()` and the generated types — so diff the regenerated file and update call sites. ([#1011](https://github.com/prisma/prisma-next/pull/1011))

- **`@prisma-next/extension-supabase` no longer exports `./test/utils`** — the `bootstrapSupabaseShim` subpath typechecked but never worked from npm (it reads fixture files that were never published, so every call failed with ENOENT). Delete the import and any test setup that called it. ([#997](https://github.com/prisma/prisma-next/pull/997))

### Features

- Per-codec temporal presets carry execution-default behavior as arguments, so a column's exact type and its auto-update behavior can finally be spelled together — e.g. the `timestamp(3)` columns Prisma ORM migrations generate for `@updatedAt`. `temporal.updatedAt()` survives as shorthand for `temporal.timestamptz(onCreate: now, onUpdate: now)`. ([#1003](https://github.com/prisma/prisma-next/pull/1003))

  ```prisma
  model Page {
    updatedAt temporal.timestamp(3, onCreate: now, onUpdate: now)
    lastSeen  temporal.timestamp(3)
    touched   temporal.timestamptz(onUpdate: now)
  }
  ```

- The Postgres target registers its built-in index types (`btree`, `hash`, `gin`, `gist`, `spgist`, `brin`), so `@@index(..., type: "gin")` — which `contract infer` already printed — now emits instead of throwing `unregistered index type`. ([#1011](https://github.com/prisma/prisma-next/pull/1011))

### Fixes

- Using `@prisma-next/extension-supabase` against a stock Supabase project now works first-try: generated migrations for RLS contracts import, typecheck, and run (RLS operations render as methods on the migration base class); `migrate`'s remediation for a missing extension-space migration works when followed verbatim; `db verify` no longer reports phantom missing constraints; `db.asUser(jwt)` supports the ES256/JWKS signing current Supabase uses; and `db.asServiceRole()` queries succeed with the grants a real project provides. ([#997](https://github.com/prisma/prisma-next/pull/997))
- More `contract infer` round-trip fixes: a plain `Decimal` field on Postgres no longer throws `CODEC_PARAMETERIZATION_MISMATCH` at connect, the 1:1 back-relation shape infer prints is accepted by emit, literal-shaped `dbgenerated(...)` defaults compare equal in `db verify` instead of reporting permanent drift, and foreign keys pointing outside the introspected scope are explained in infer's output instead of vanishing silently. ([#1011](https://github.com/prisma/prisma-next/pull/1011))
- MTI variant-narrowed `updateCount`, `deleteCount`, and include-backed `deleteAll` now compile their predicates through a correlated subquery that joins the variant table — previously the generated SQL could reference the variant table without it being in scope. ([#940](https://github.com/prisma/prisma-next/pull/940))
- An explicit `.select(...)` on a polymorphic query or include now restricts MTI variant fields to the selection; unselected variant fields no longer leak into results. Omitting the selection keeps the full default shape. ([#984](https://github.com/prisma/prisma-next/pull/984))
- The language server surfaces config-load failures as a diagnostic on the config file (`PRISMA_NEXT_CONFIG_LOAD_FAILED`) and keeps serving schema diagnostics from the last working configuration when a reload fails, instead of silently wiping every marker. ([#974](https://github.com/prisma/prisma-next/pull/974))
- Migration operations are now ordered by a dependency graph over schema-diff issues instead of a hand-maintained per-kind integer table, fixing drop-order defects (e.g. a column dropping before its own constraint). For code reading the migration-diff internals: `SchemaDiffIssue.reason` is removed — discriminate via the presence of `expected`/`actual`, or the `issueOutcome` helper from `@prisma-next/framework-components/control`. ([#992](https://github.com/prisma/prisma-next/pull/992))

## v0.15.0

This release ships Postgres row-level security end-to-end (policies for every operation, explicit `@@rls` enablement, role declarations — authored in PSL or TypeScript, planned by `migration plan`, drift caught by `db verify`), native Postgres enums (external adoption and a managed lifecycle), the complete introspected Supabase contract, a PSL language server (`prisma-next lsp`) with formatting, completions, and semantic highlighting, native scalar-list columns, PSL many-to-many authoring, and one unified schema differ behind `db verify` and migration planning. SQL ORM includes now decode through codecs, matching top-level reads.

### Breaking changes

- **SQL ORM includes decode through codecs** — every scalar field of an included relation now decodes through its contract-bound codec, matching top-level query results. Code that relied on included fields keeping the database's raw JSON representation must be updated: Postgres `bytea` include fields return `Uint8Array` instead of `\x`-prefixed hex text, timestamp fields return `Date` instead of strings, and custom codec-backed fields return whatever the codec's `decodeJson` produces. Custom SQL codec authors: `encodeJson` / `decodeJson` now use the exact scalar shape the database produces inside JSON values — see the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.15.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.14-to-0.15/) for the built-in representation changes. ([#942](https://github.com/prisma/prisma-next/pull/942))

  Before:

  ```ts
  const [post] = await db.orm.public.Post.find({ include: { author: true } });
  post.author.avatar;    // '\\x89504e…' (raw hex text)
  post.author.createdAt; // '2026-07-01T12:00:00' (string)
  ```

  After:

  ```ts
  post.author.avatar;    // Uint8Array
  post.author.createdAt; // Date
  ```

- **`db verify --json` reports a single `schema.issues` list** — the split `schema.issues` / `schema.schemaDiffIssues` pair collapses into one `schema.issues` array of `{ path, reason, message, expected?, actual? }`, and the retired `outcome` field is replaced by `reason` (`'missing'` → `'not-found'`, `'extra'` → `'not-expected'`, `'mismatch'` → `'not-equal'`). The same collapse applies to `schema.warnings`. Update scripts or CI steps that read `schemaDiffIssues` or compare `.outcome`. See the [0.14→0.15 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.15.0/skills/upgrade/prisma-next-upgrade/upgrades/0.14-to-0.15/). ([#921](https://github.com/prisma/prisma-next/pull/921))

  Before:

  ```json
  { "schema": { "issues": [], "schemaDiffIssues": [{ "outcome": "missing", "message": "…" }] } }
  ```

  After:

  ```json
  { "schema": { "issues": [{ "reason": "not-found", "path": ["…"], "message": "…" }] } }
  ```

- **RLS policies require `@@rls` on the target model** — RLS enablement is an explicit, authored table attribute. A `policy_*` block's `target` model must declare `@@rls`, or `contract emit` fails with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`. Plan semantics follow the marker: a marked table with RLS off plans `ENABLE ROW LEVEL SECURITY`, removing every policy keeps RLS enabled (fail-closed deny-all), and removing `@@rls` plans `DISABLE ROW LEVEL SECURITY` (requires the destructive allowance). Renaming only a policy's name plans a single `ALTER POLICY … RENAME TO` instead of drop+create. Extension authors constructing `PostgresTableSchemaNode` by hand must supply the now-required `rlsEnabled` boolean. ([#945](https://github.com/prisma/prisma-next/pull/945))

  Before:

  ```prisma
  model Profile {
    id     Uuid   @id
    userId Uuid   @unique
  }
  ```

  After:

  ```prisma
  model Profile {
    id     Uuid   @id
    userId Uuid   @unique
    @@rls
  }
  ```

- **Extension authors: SQL contract authoring requires a target `createNamespace`** — the SQL family no longer materialises a placeholder namespace, so `prismaContract(...)` / `defineContract(...)` from `@prisma-next/sql-contract-psl` / `@prisma-next/sql-contract-ts` need the target's namespace factory (`postgresCreateNamespace` / `sqliteCreateNamespace`); target-pack `defineContract` wrappers already supply it, so app authors are unaffected. `SqlNamespace` is now an abstract class; `buildSqlNamespace`, `buildSqlNamespaceMap`, `SqlBoundNamespace`, and `SqlUnboundNamespace` are removed, and hand-written namespace literals carry the target `kind` (e.g. `'postgres-schema'`) instead of `'sql-namespace'`. See the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.15.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.14-to-0.15/). ([#864](https://github.com/prisma/prisma-next/pull/864))

- **Extension authors: the coordinate-based schema-diff SPI is retired** — the migration planner and `db verify` now run on one generic node differ. `collectSqlSchemaIssues` / `collectSqlSchemaIssuesPerNamespace`, `diffPostgresDatabaseSchema`, and `SqlControlTargetDescriptor.diffDatabaseSchema` are removed (use `diffSchemas` or a target's `buildXPlanDiff`); `MigrationPlanner.plan()`'s `keepDiffIssue` predicate is replaced by an `ownership` oracle; the issue types `BaseSchemaIssue` / `SchemaIssue` / `EnumValuesChangedIssue` are gone — `SchemaDiffIssue` is the single issue shape everywhere, including the codec `verifyType` hook; and `graphWalkStrategy` is renamed `resolveRecordedPath` in `@prisma-next/migration-tools/aggregate`. See the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.15.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.14-to-0.15/). ([#921](https://github.com/prisma/prisma-next/pull/921), [#894](https://github.com/prisma/prisma-next/pull/894))

- **Extension authors: restricted-column typing goes through the codec** — a column restricted to a value set derives its TS literal union by rendering each stored value through the codec's `renderValueLiteral(value, side)`, replacing the framework's deleted domain-enum override. Custom codec descriptors used by enum/restricted columns must implement it, or the column widens to the codec's output type. ([#896](https://github.com/prisma/prisma-next/pull/896))

- **Extension authors: Mongo `deriveJsonSchema` sources enums from value sets** — the fourth argument of `deriveJsonSchema` / `derivePolymorphicJsonSchema` changes from a domain-enum map to a value-set map (`contract.storage.namespaces[<ns>].entries.valueSet`). Callers through `mongoContract(...)` / `defineContract(...)` need no change. ([#900](https://github.com/prisma/prisma-next/pull/900))

- **Extension authors: `ScalarFieldState`'s first generic is the column descriptor** — `ScalarFieldState<'pg/text@1', …>` becomes `ScalarFieldState<ColumnTypeDescriptor<'pg/text@1'>, …>`, so field states preserve the whole descriptor type (including native-enum member tuples). Built contract types also keep literal `nativeType` / `typeParams` instead of widening to `string`. ([#958](https://github.com/prisma/prisma-next/pull/958))

- **Extension authors: `native_enum` entities serialize into `contract.json`, keyed by physical type name** — packs declaring native Postgres enums must re-emit their bundled contract so the `entries.native_enum` maps land in the published artifacts (this is what lets a consumer's `contract infer` subtract pack-owned enum types). Code addressing an entry by key switches from the PascalCase name to the physical Postgres type name (`entries.native_enum.aal_level`, not `.AalLevel`). ([#946](https://github.com/prisma/prisma-next/pull/946), [#954](https://github.com/prisma/prisma-next/pull/954))

### Features

- **Postgres row-level security, end-to-end** — PSL gains `policy_select`, `policy_insert`, `policy_update`, `policy_delete`, and `policy_all` blocks (with `using` / `withCheck` predicates and per-role targeting), the `@@rls` enablement attribute, and standalone `role` declarations inside `namespace unbound { }`. `migration plan` plans the full lifecycle (`ENABLE` / `DISABLE ROW LEVEL SECURITY`, policy create/drop, rename via `ALTER POLICY`), and `db verify` fails on policy drift and on declared roles the live cluster lacks. The same surface is authorable in the TypeScript DSL (`policySelect(...)`, `rlsEnabled(model)`, `role(name)`), producing wire-name-identical contracts. ([#771](https://github.com/prisma/prisma-next/pull/771), [#868](https://github.com/prisma/prisma-next/pull/868), [#945](https://github.com/prisma/prisma-next/pull/945), [#950](https://github.com/prisma/prisma-next/pull/950), [#957](https://github.com/prisma/prisma-next/pull/957), [#959](https://github.com/prisma/prisma-next/pull/959))

- **Native Postgres enums** — `CREATE TYPE … AS ENUM` types are first-class again, this time as explicit entities. External types the database already owns (e.g. Supabase's `auth.aal_level`) are declared via `native_enum` blocks, typed as member-value literal unions, adopted by `contract infer`, and read at runtime through the new Postgres-only `db.nativeEnums` accessor. Managed native enums get a migration lifecycle: create/delete, and member addition via `ALTER TYPE … ADD VALUE` (other member changes are refused with a converting-migration hint). Also authorable in the TypeScript DSL via `nativeEnum(name, ...values)` + `field.column(pg.enum(handle))`, with the member union visible in `typeof contract` without an emit. ([#906](https://github.com/prisma/prisma-next/pull/906), [#944](https://github.com/prisma/prisma-next/pull/944), [#949](https://github.com/prisma/prisma-next/pull/949), [#970](https://github.com/prisma/prisma-next/pull/970), [#935](https://github.com/prisma/prisma-next/pull/935), [#958](https://github.com/prisma/prisma-next/pull/958))

- **The complete Supabase contract** — `@prisma-next/extension-supabase` now ships the full introspected description of everything Supabase owns: every `auth` and `storage` table, all native enum types, and the three platform roles (`anon`, `authenticated`, `service_role`), up from the previous 5-table minimum. A secondary `db.asServiceRole().supabase.{sql,orm}` admin root reads Supabase-internal tables as `service_role`, and the extension ships with docs, a real-Supabase acceptance harness, and a user-facing `prisma-next-supabase` skill. ([#845](https://github.com/prisma/prisma-next/pull/845), [#960](https://github.com/prisma/prisma-next/pull/960), [#985](https://github.com/prisma/prisma-next/pull/985), [#987](https://github.com/prisma/prisma-next/pull/987))

- **PSL language server** — a new `prisma-next lsp` subcommand serves diagnostics, formatting, completions (types and block templates), semantic highlighting, folding regions, and symbol-table diagnostics over LSP, backed by the fault-tolerant CST parser (which now fully replaces the legacy parser). `prisma format` formats PSL from the CLI, and a browser playground wires a Monaco editor to the language server. ([#852](https://github.com/prisma/prisma-next/pull/852), [#851](https://github.com/prisma/prisma-next/pull/851), [#850](https://github.com/prisma/prisma-next/pull/850), [#857](https://github.com/prisma/prisma-next/pull/857), [#862](https://github.com/prisma/prisma-next/pull/862), [#871](https://github.com/prisma/prisma-next/pull/871), [#878](https://github.com/prisma/prisma-next/pull/878), [#869](https://github.com/prisma/prisma-next/pull/869), [#856](https://github.com/prisma/prisma-next/pull/856), [#887](https://github.com/prisma/prisma-next/pull/887), [#972](https://github.com/prisma/prisma-next/pull/972))

- **PSL native scalar lists** — scalar-list fields (`String[]`, `Int[]`, …) lower to native array storage columns instead of a JSONB fallback, end-to-end: author, migrate, and infer, gated on the adapter-reported `scalarList` capability. ([#870](https://github.com/prisma/prisma-next/pull/870), [#846](https://github.com/prisma/prisma-next/pull/846))

- **PSL authors many-to-many** — an `N:M` relation with a `through` junction is now authorable in PSL, completing the M:N surface whose read side landed in 0.14. ([#819](https://github.com/prisma/prisma-next/pull/819))

- **Per-migration contract snapshots** — each applied migration persists its contract snapshot in a 1:1 ledger companion table, and the `Migration` base class takes typed start/end contract JSON, exposing `this.startContract` / `this.endContract` views for data-transform migrations. ([#908](https://github.com/prisma/prisma-next/pull/908), [#879](https://github.com/prisma/prisma-next/pull/879))

- **Client-safe static surface** — new `@prisma-next/{postgres,sqlite,mongo}/static` entrypoints export `<target>Static({ contractJson })`, a driver-free `ExecutionContext` plus derived `enums`, query builder, `raw`, and `contract` — safe to import in client bundles. The runtime facades also expose `db.context` and `db.contract`. ([#888](https://github.com/prisma/prisma-next/pull/888))

- **Mongo enums, end-to-end** — enums are authorable for MongoDB in PSL and the TypeScript builder, enforced at the database layer via a planner-generated `$jsonSchema` validator, and typed from a stored value set the same way SQL enums are. The Mongo client also gains `db.raw` and `db.execute(plan)`. ([#834](https://github.com/prisma/prisma-next/pull/834), [#900](https://github.com/prisma/prisma-next/pull/900), [#880](https://github.com/prisma/prisma-next/pull/880))

- **Extension-aware `contract infer`** — `contract infer` omits database elements a stack extension pack's contract already describes, and resolves a foreign key into pack-owned space as a qualified cross-space relation (e.g. `supabase:auth.AuthUser`) instead of re-declaring the pack's tables. ([#919](https://github.com/prisma/prisma-next/pull/919))

- **Variant-declared relations in the ORM** — the `.variant('X')`-narrowed accessor surfaces relations the variant model declares (filterable and includable), alongside the base model's relations. ([#933](https://github.com/prisma/prisma-next/pull/933), [#976](https://github.com/prisma/prisma-next/pull/976))

- **Enum `@@type` inference** — a PSL `enum` block may omit `@@type`; the codec is inferred from the member values (text for string members, int for integers). ([#905](https://github.com/prisma/prisma-next/pull/905))

- **`@relation(index: false)` and `inet` columns** — PSL's `@relation` gains an optional `index` argument for foreign keys whose columns genuinely have no backing index (`contract infer` emits it automatically), and the Postgres target gains a `pg/inet@1` codec so `inet` columns are authorable as `String @db.Inet` and inferrable. ([#960](https://github.com/prisma/prisma-next/pull/960))

### Fixes

- **`@default(false)` survives emission** — the contract canonicalizer no longer strips `value: false` from resolved defaults, so a boolean-`false` column default is present in the emitted `contract.json` and round-trips against live introspection. Re-emitting an affected contract changes its storage hash. ([#904](https://github.com/prisma/prisma-next/pull/904))

- **Mongo reshaping reads decode through codecs** — aggregation reads through `$project` / `$addFields` stages decode their output fields instead of returning raw BSON (a projected `_id` now comes back decoded, not as a raw `ObjectId`). ([#897](https://github.com/prisma/prisma-next/pull/897))

- **`pg` bindings resolve by structure** — a caller-supplied Pool/Client from a duplicated `pg` copy in a bundle now resolves correctly instead of throwing `Unable to determine pg binding type` at boot; new `isPgPool` / `isPgClient` guards are exported from `@prisma-next/postgres/runtime`. ([#969](https://github.com/prisma/prisma-next/pull/969))

- **Array columns verify cleanly** — a scalar-list column's derived schema IR keeps the bare element type with `many: true` (previously every list column verified `not-equal` against live introspection); Postgres introspection also excludes expression-keyed indexes and no longer collides unique and non-unique indexes over identical columns. ([#960](https://github.com/prisma/prisma-next/pull/960))

- **Stack-missing migration errors name the failing operation** — the error raised when a migration references an operation the stack doesn't provide now says which operation. ([#953](https://github.com/prisma/prisma-next/pull/953))

### New contributors

- [@sorenbs](https://github.com/sorenbs) made their first contribution in [#912](https://github.com/prisma/prisma-next/pull/912)

## v0.14.0

This release reshapes the enum surface (PSL `enum` is now a domain concept backed by a value-set CHECK constraint, not a native Postgres type), makes the SQL builder always-qualified by namespace, adds native UUID storage on Postgres, ships a new fault-tolerant PSL parser, completes the read side of many-to-many (correlated includes plus `some` / `every` / `none` filters through the junction), and adds a Supabase façade alongside several runtime-class renamings. Most breaking changes have a matching codemod or upgrade recipe.

### Breaking changes

- **PSL `enum` becomes the domain enum** — an `enum` block now authors a text-class column whose value set is enforced by a CHECK constraint, not a native `CREATE TYPE … AS ENUM`. Each block must declare `@@type("<codec-id>")` (typically `pg/text@1`) and map members to database values with `Name = "value"`. The transitional `enum2` keyword is retired (rename to `enum` — emitted contract is identical). Native enum machinery is deleted: `enumType(name, values[])` / `enumColumn` from `@prisma-next/adapter-postgres/column-types`, the `pg/enum@1` codec, and adoption of native enum types in `contract infer` are all gone. Databases carrying a native enum type need a one-time converting migration (ALTER column to `text` USING `::text`, add the value-set CHECK, `DROP TYPE`) — `contract infer` refuses native enum types and names them. See the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/) and the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.13-to-0.14/). ([#817](https://github.com/prisma/prisma-next/pull/817))

  Before:

  ```prisma
  enum user_type {
    admin
    user
  }
  ```

  After:

  ```prisma
  enum user_type {
    @@type("pg/text@1")
    admin = "admin"
    user  = "user"
  }
  ```

- **Query builder and ORM are always qualified by namespace** — the flat by-bare-name accessors are removed at the builder layer; the Postgres facade exposes the namespaced surface. On Postgres, `db.sql.<table>` becomes `db.sql.<namespace>.<table>` and `db.orm.<Model>` becomes `db.orm.<namespace>.<Model>` (`public` for a standard single-schema project). Direct builder calls (`sql.<table>`, `orm.<Model>`) migrate the same way. SQLite and Mongo are unaffected — their single-namespace facade keeps the flat surface working. No codemod: the correct namespace is the one each table/model is declared in. The generated `contract.d.ts` also drops the flat top-level `export type Models` — read models per-namespace as `Contract['domain']['namespaces']['<namespace>']['models']` and re-emit. See the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#778](https://github.com/prisma/prisma-next/pull/778))

  Before:

  ```ts
  const users = await db.sql.user.select('id', 'email').build().execute();
  const alice = await db.orm.User.find({ where: { id } });
  ```

  After:

  ```ts
  const users = await db.sql.public.user.select('id', 'email').build().execute();
  const alice = await db.orm.public.User.find({ where: { id } });
  ```

- **UUID field presets renamed by storage encoding** — `field.uuid()` → `field.uuidString()`, `field.id.uuidv4()` → `field.id.uuidv4String()`, `field.id.uuidv7()` → `field.id.uuidv7String()`. The new names describe the `char(36)` storage encoding (the emitted codec, `sql/char@1`, is unchanged). Postgres-native `uuid` columns use the new `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` presets from `@prisma-next/postgres/contract-builder`. The rename is mechanical — a colocated codemod ships in the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#810](https://github.com/prisma/prisma-next/pull/810))

  Before:

  ```ts
  id: field.id.uuidv7(),
  externalId: field.uuid(),
  ```

  After:

  ```ts
  id: field.id.uuidv7String(),
  externalId: field.uuidString(),
  ```

- **Postgres migration op factories become methods on `Migration`** — the bare op factory functions previously exported from `@prisma-next/postgres/migration` (and the `@prisma-next/target-postgres/migration` alias) are removed. Each is now a protected method on the `PostgresMigration` base class — call it as `this.<op>(...)`. Positional arguments are replaced by a single options object. A codemod ships in the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#813](https://github.com/prisma/prisma-next/pull/813))

  Before:

  ```ts
  import { addForeignKey, dropColumn } from '@prisma-next/postgres/migration';

  override get operations() {
    return [
      dropColumn('public', 'user', 'legacyName'),
      addForeignKey('public', 'post', { name: 'post_userId_fkey', columns: ['userId'], references: { schema: 'public', table: 'user', columns: ['id'] } }),
    ];
  }
  ```

  After:

  ```ts
  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'user', column: 'legacyName' }),
      this.addForeignKey({ schema: 'public', table: 'post', foreignKey: { name: 'post_userId_fkey', columns: ['userId'], references: { schema: 'public', table: 'user', columns: ['id'] } } }),
    ];
  }
  ```

- **SQL runtime class renames** — `@prisma-next/sql-runtime` exports `abstract class SqlRuntimeBase` (previously `SqlRuntime`). The bare names `PostgresRuntime` and `SqliteRuntime` are now **interfaces** — the types to depend on in extension and app code. The concrete classes are `PostgresRuntimeImpl` (from `@prisma-next/postgres/runtime`) and `SqliteRuntimeImpl` (from `@prisma-next/sqlite/runtime`). Code that referenced the class names to subclass them switches to the `Impl` names. Code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected. ([#806](https://github.com/prisma/prisma-next/pull/806))

- **`createRuntime` removed from `@prisma-next/sql-runtime`** — use the target facade factory (`postgres(...)` / `sqlite(...)`) or construct the target class directly (`new PostgresRuntimeImpl({...})` / `new SqliteRuntimeImpl({...})`). The constructor options match what `createRuntime` accepted, except `stackInstance` is not taken — pass `adapter` directly. App code using the facade factories is unaffected. ([#806](https://github.com/prisma/prisma-next/pull/806))

- **`SqlContractSerializer` no longer accepts Postgres contracts** — the family serializer's entries registry only knows SQL-family built-ins (`table`, `valueSet`) and rejects the Postgres-specific `type` key that every Postgres namespace carries. Migration files and app code that deserialize a Postgres-emitted contract must use `PostgresContractSerializer` from `@prisma-next/target-postgres/runtime`. SQLite and family-only contracts are unaffected. ([#812](https://github.com/prisma/prisma-next/pull/812))

  Before:

  ```ts
  import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
  const contract = new SqlContractSerializer().deserializeContract(json) as Contract;
  ```

  After:

  ```ts
  import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
  const contract = new PostgresContractSerializer().deserializeContract(json) as Contract;
  ```

- **Extension authors: `SqlNamespace.entries` is an open dictionary** — the closed shape (`{ table?, valueSet? }`) is gone. `entries` is now `Readonly<Record<string, Readonly<Record<string, unknown>>>>`, so dot-access like `.entries.table` no longer compiles. Read tables via the `namespaceTables(ns)` helper from `@prisma-next/sql-contract/types`, or via bracket notation `entries['table']`; the concrete class instances still expose typed getters (`ns.table`). See the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.13-to-0.14/). ([#812](https://github.com/prisma/prisma-next/pull/812))

### Features

- **Postgres-native UUID storage** — `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` from `@prisma-next/postgres/contract-builder` author columns backed by the native `uuid` type. The cross-target `*String()` presets continue to emit `char(36)`. ([#810](https://github.com/prisma/prisma-next/pull/810))

- **Many-to-many reads land** — `N:M` relations through a `through` junction can now be eagerly loaded via `include()` (correlated reads, slice 1) and filtered with `some` / `every` / `none` through the junction (slice 2). M:N validation arrived in 0.13; the runtime read surface is wired up in this release. ([#679](https://github.com/prisma/prisma-next/pull/679), [#680](https://github.com/prisma/prisma-next/pull/680))

- **Supabase façade** — `@prisma-next/extension-supabase` ships a `supabase()` façade and `SupabaseRuntime` that composes the cross-contract foreign keys introduced in 0.13 into a runnable extension. ([#792](https://github.com/prisma/prisma-next/pull/792))

- **Fault-tolerant PSL parser** — a new recursive-descent parser produces a full syntax tree (`SourceFile`) even when the input contains errors, so editor integrations can report diagnostics and surface partial structure without bailing on the first failure. ([#795](https://github.com/prisma/prisma-next/pull/795))

- **Custom and parameterized codecs in control-path queries** — adapters now honor custom and parameterized codecs when encoding values on the control path (catalog reads, schema-verification queries, migration-state lookups), matching how user-data queries already handled them. ([#807](https://github.com/prisma/prisma-next/pull/807))

- **`contract infer` writes a `pragma` header** — inferred PSL contracts now carry a `pragma` block recording the inference source and options, so re-running infer or auditing a generated schema is unambiguous. ([#801](https://github.com/prisma/prisma-next/pull/801))

- **Per-namespace typed resolution in the builder** — the emitted `contract.d.ts` TypeMaps nest by namespace, so the query builder and ORM client resolve each namespace's own columns and fields — fixing same-bare-name models declared in more than one namespace. Re-emit picks up the new shape. ([#803](https://github.com/prisma/prisma-next/pull/803))

- **Enum input types are exhaustively typed in the emitted `.d.ts`** — an enum-restricted field's input type renders as the literal member union (matching the output side), so create/update calls are exhaustiveness-checked at compile time. Re-emit picks up the new shape. ([#797](https://github.com/prisma/prisma-next/pull/797))

- **Typed `db.enums.<namespace>.<Name>` accessor** — the emitter generates a `domain` block in `contract.d.ts` that exposes each PSL-authored enum as a literal-typed `ContractEnumAccessor` (`values`, `names`, `members`). `contract.json` is unchanged; re-emit picks up the new types. ([#809](https://github.com/prisma/prisma-next/pull/809))

- **Enum member defaults via `@default(EnumType.Member)`** — the PSL interpreter and contract-ts authoring surface resolve a member default to the corresponding database value literal. ([#808](https://github.com/prisma/prisma-next/pull/808))

### Fixes

- **`sql-orm-client` model accessors typed by selected variant** — accessing a model on the ORM client narrows the result type to the selected variant rather than the union of all variants. ([#790](https://github.com/prisma/prisma-next/pull/790))

- **Emitter emits enum input literals** — fixes a hole where enum-restricted input types fell back to the codec's broad input type instead of the literal member union. ([#797](https://github.com/prisma/prisma-next/pull/797))

- **Un-namespaced Postgres models default to `public`** — un-namespaced models in a Postgres contract correctly default to the `public` namespace per ADR 223; the spurious empty `__unbound__` storage slot is gone. Re-emit picks up the shape change. ([#838](https://github.com/prisma/prisma-next/pull/838))

## v0.13.0

This release makes namespaces a first-class part of the query surface, adds cross-contract foreign keys to the SQL ORM, makes many-to-many a validatable contract shape, introduces a per-object control policy (`@@control`) that decides what Prisma manages, ships domain enums backed by storage value-sets, and gives the migration CLI a unified graph-tree view across `list` / `log` / `status` / `show`. Telemetry also flips from opt-in to opt-out. A few changes require a one-time contract re-emit — all are covered by the linked upgrade recipes.

### Breaking changes

- **Telemetry is now opt-out** — anonymous CLI telemetry is collected by default and you opt out, where previously you opted in. Set `PRISMA_NEXT_DISABLE_TELEMETRY=1` (or `DO_NOT_TRACK=1`) to turn it off. See [`docs/Telemetry.md`](https://github.com/prisma/prisma-next/blob/v0.13.0/docs/Telemetry.md) for what is collected and every opt-out signal. ([#676](https://github.com/prisma/prisma-next/pull/676))

- **MTI variant tables materialize a base-PK link column** — a PSL `@@base(Parent, "tag")` variant that carries its own `@@map` (and is therefore stored in its own table) now emits a base-PK link column in storage: the variant table gains a copy of the base table's primary-key column(s), a primary key over them, and a cascading foreign key (`ON DELETE CASCADE`) referencing the base table's primary key. Previously the variant table held only the variant-specific columns with no primary key and no link to its base. This changes the emitted `contract.json` / `contract.d.ts` and the contract's `storageHash`. Re-emit your contract, then plan and apply the matching migration. Variants that share the base table (no own `@@map`) are unaffected. See the [0.12→0.13 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/upgrade/prisma-next-upgrade/upgrades/0.12-to-0.13/). ([#669](https://github.com/prisma/prisma-next/pull/669))

  Before (emitted `contract.json`, variant table `bug`):

  ```json
  "bug": {
    "columns": {
      "severity": { "codecId": "pg/text@1", "nullable": false }
    }
  }
  ```

  After:

  ```json
  "bug": {
    "columns": {
      "id": { "codecId": "sql/char@1", "nullable": false },
      "severity": { "codecId": "pg/text@1", "nullable": false }
    },
    "primaryKey": { "columns": ["id"] },
    "foreignKeys": [
      {
        "name": "bug_id_fkey",
        "columns": ["id"],
        "references": { "table": "task", "columns": ["id"] },
        "onDelete": "cascade"
      }
    ]
  }
  ```

- **Contract storage IR moved to a namespace envelope** — the SQL/Mongo storage IR is now keyed by namespace (`storage.namespaces.<ns>.entries.<kind>`), and cross-references are explicit `{ namespace, model }` objects in `domain`. Consumer impact is mechanical: re-emit with `prisma-next contract emit` to pick up the new shape. No codemod or source change is required, but the contract's `storageHash` changes, so plan and apply a migration afterward. ([#715](https://github.com/prisma/prisma-next/pull/715))

- **Extension authors: codec-resolution SPI takes a leading `namespaceId`** — `CodecDescriptorRegistry.codecRefForColumn(table, column)` is now `codecRefForColumn(namespaceId, table, column)`, and the free `codecRefForStorageColumn(storage, table, column)` is now `codecRefForStorageColumn(storage, namespaceId, table, column)` (both in `@prisma-next/sql-relational-core`). Thread the namespace the table lives in through every call site that stamps `codec` onto AST nodes. There is no codemod — the right namespace is call-site-specific. See the [0.12→0.13 extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.12-to-0.13/). ([#715](https://github.com/prisma/prisma-next/pull/715))

  Before:

  ```ts
  const ref = descriptors.codecRefForColumn('document', 'embedding');
  ```

  After:

  ```ts
  const ref = descriptors.codecRefForColumn('public', 'document', 'embedding');
  ```

- **Extension authors: empty `typeParams` stripped from `storage.types`** — the canonicalizer now omits `typeParams` from `storage.types` entries when it is an empty object (e.g. a `types { Uuid = String @db.Uuid }` named-type alias). Runtime behaviour is unchanged, but the emitted `contract.json` and its `storageHash` differ. If your extension shipped a `contract.json` with `"typeParams": {}`, re-emit and re-pin your migration baselines. See the [0.12→0.13 extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.12-to-0.13/). ([#753](https://github.com/prisma/prisma-next/pull/753))

### Features

- **Namespace-aware DSL/ORM surface** — the typed query and ORM surface now exposes namespaced accessors so models in different namespaces are addressed explicitly and two same-named tables in different namespaces no longer collide. Additive — existing single-namespace code is unchanged. ([#720](https://github.com/prisma/prisma-next/pull/720))

- **Many-to-many is now a validatable contract shape** — `N:M` relations carrying a `through` junction descriptor are now a first-class, validatable part of the contract (they previously failed validation). The ORM runtime surface for M:N — `.include()` across the junction, `some`/`every`/`none` filters, and junction writes — is not wired up yet and lands in a follow-up release; nested M:N mutations currently throw. ([#669](https://github.com/prisma/prisma-next/pull/669), [#678](https://github.com/prisma/prisma-next/pull/678))

- **Cross-contract foreign keys** — a relation field can reference a model owned by another contract space (e.g. `supabase:auth.AuthUser`), with named-type aliases (`types { Uuid = String @db.Uuid }`) for database-native column types. The planner and verifier resolve the cross-space reference and emit the foreign key, including cascading deletes. See the [0.12→0.13 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/upgrade/prisma-next-upgrade/upgrades/0.12-to-0.13/) for the authoring pattern. ([#745](https://github.com/prisma/prisma-next/pull/745), [#752](https://github.com/prisma/prisma-next/pull/752), [#756](https://github.com/prisma/prisma-next/pull/756), [#765](https://github.com/prisma/prisma-next/pull/765))

  ```prisma
  types {
    Uuid = String @db.Uuid
  }

  namespace public {
    model Profile {
      id       String @id @default(uuid())
      username String
      userId   Uuid   @unique
      user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
      @@map("profile")
    }
  }
  ```

- **Per-object control policy (`@@control`)** — a model or other contract object can declare whether Prisma manages its schema, and a contract can set a `defaultControlPolicy`. Migration DDL generation and schema verification react to each object's policy, so you can keep externally-owned objects out of Prisma's managed surface. ([#717](https://github.com/prisma/prisma-next/pull/717), [#711](https://github.com/prisma/prisma-next/pull/711))

- **Domain enums with storage value-sets** — enums are now a domain concept backed by storage value-sets. On Postgres, `enum` blocks lower to a native enum type (`CREATE TYPE … AS ENUM`); SQL targets without native enum support approximate the allowed values with check constraints. ([#750](https://github.com/prisma/prisma-next/pull/750), [#755](https://github.com/prisma/prisma-next/pull/755))

- **Unified migration graph view in the CLI** — `migration list`, `log`, `status`, and `show` now render the migration history as a consistent graph tree with colored lanes, a `--legend`, and one schema-locked `--json` shape across the read commands. `migrate --show` previews the migration path read-only before you apply it. ([#706](https://github.com/prisma/prisma-next/pull/706), [#704](https://github.com/prisma/prisma-next/pull/704), [#705](https://github.com/prisma/prisma-next/pull/705), [#735](https://github.com/prisma/prisma-next/pull/735), [#741](https://github.com/prisma/prisma-next/pull/741), [#767](https://github.com/prisma/prisma-next/pull/767))

- **Readable per-migration ledger** — the migration apply ledger is now a per-migration journal, read back as one flat chronological table by `migration log`. ([#665](https://github.com/prisma/prisma-next/pull/665), [#704](https://github.com/prisma/prisma-next/pull/704))

- **`db.transaction()` on the SQLite facade** — `@prisma-next/sqlite` gains a facade-level transaction API (`db.transaction(async (tx) => …)`), mirroring the Postgres facade. ([#737](https://github.com/prisma/prisma-next/pull/737))

- **Declarative SPI for extension-contributed PSL blocks** — extensions can declare top-level PSL blocks declaratively, and `contract infer` round-trips them through a generic PSL printer. ([#753](https://github.com/prisma/prisma-next/pull/753), [#754](https://github.com/prisma/prisma-next/pull/754), [#757](https://github.com/prisma/prisma-next/pull/757))

- **`@prisma-next/extension-supabase`** — a new extension package and an `examples/supabase` walking skeleton that wires a cross-contract foreign key from an app model to Supabase's `auth` schema. ([#746](https://github.com/prisma/prisma-next/pull/746), [#765](https://github.com/prisma/prisma-next/pull/765))

- **STI variants can declare their own fields** — a PSL `@@base(Parent, "tag")` variant with no own `@@map` (single-table inheritance) may now declare its own scalar fields. Each is materialized as a (nullable) column on the shared base table, and the variant no longer emits a stray shadow table. Previously such a contract failed to emit with `references non-existent column`. Existing contracts re-emit identically. ([#669](https://github.com/prisma/prisma-next/pull/669))

- **Backward cursor pagination** — `OrderByItem.reverse()` flips an order-by direction for fetching the previous page. ([#671](https://github.com/prisma/prisma-next/pull/671))

- **Postgres JSON defaults emit a `::jsonb` / `::json` cast** — JSON column defaults now carry the explicit cast in generated DDL. ([#763](https://github.com/prisma/prisma-next/pull/763))

### Fixes

- Constraintless foreign keys are skipped in offline schema projection. ([#744](https://github.com/prisma/prisma-next/pull/744))
- Storage-sort comparison is now collation-independent. ([#721](https://github.com/prisma/prisma-next/pull/721))

## v0.12.0

Namespaces become first-class: un-namespaced Postgres models now live in `public`, the application plane is symmetric with storage, and every cross-namespace reference is explicit. This release also ratifies a version-support policy (Node 24+), simplifies runtime marker verification, closes MongoDB validators by default, and adds raw SQL to the typed builder. Several contract-shape changes require a one-time re-emit — most are mechanical and covered by the linked upgrade recipes.

### Breaking changes

- **Supported-version floors raised** — the supported floor for each dependency is now the latest GA release we test against: Node.js `>=24` (declared in every package's `engines`), TypeScript `>=5.9`, PostgreSQL `17`, and MongoDB `8.0`. Bump your runtime and toolchain to meet these floors before upgrading. ([#659](https://github.com/prisma/prisma-next/pull/659))
- **Un-namespaced Postgres models default to `public`** — models without an explicit namespace now emit under the `public` namespace instead of the `__unbound__` sentinel (`postgres-unbound-schema` → `postgres-schema`); explicit `namespace unbound { … }` still round-trips to `__unbound__`. Re-emit your contract so `contract.json` / `contract.d.ts` pick up the new namespace key. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#662](https://github.com/prisma/prisma-next/pull/662))

  Before (emitted `contract.json`):

  ```json
  "storage": {
    "namespaces": {
      "__unbound__": { "id": "__unbound__", "kind": "postgres-unbound-schema" }
    }
  }
  ```

  After:

  ```json
  "storage": {
    "namespaces": {
      "public": { "id": "public", "kind": "postgres-schema" }
    }
  }
  ```

- **Symmetric domain plane** — models and value objects moved from flat `contract.models` / `contract.valueObjects` to `contract.domain.namespaces.<ns>`, and emitted `contract.d.ts` exports `Models` via `ContractModelsMap<Contract>` instead of `Contract['models']`. Re-emit your contract; consumers reading the flat shape must adopt the namespaced helpers. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/) (extension authors: the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.11-to-0.12/) also covers the removal of the `@prisma-next/contract/testing` subpath — test factories now live in `@repo/test-utils`). ([#653](https://github.com/prisma/prisma-next/pull/653))

  Before (consuming emitted `contract.d.ts`):

  ```ts
  type Models = Contract['models'];
  ```

  After:

  ```ts
  type Models = ContractModelsMap<Contract>;
  ```

- **Cross-namespace references are explicit `{ namespace, model }` pairs** — emitted contract roots and `relation.to` now carry an explicit `{ namespace, model }` object (namespace branded as `NamespaceId`) rather than a bare model-name string. Re-emit your contract, and update any code that read `relation.to` (or a root) as a string to read `.model` / `.namespace`. ([#600](https://github.com/prisma/prisma-next/pull/600))

  Before (consuming emitted `contract.d.ts`):

  ```ts
  // relation.to was a bare model-name string
  readonly to: 'User';
  ```

  After:

  ```ts
  // relation.to is now an explicit { namespace, model }
  readonly to: { readonly namespace: 'public' & NamespaceId; readonly model: 'User' };
  ```

- **`capabilities` removed from `defineContract`** — the `capabilities` field on the first argument of `defineContract({ … }, …)` is gone; capabilities are now contributed automatically by target components and the extension packs in `extensionPacks`. Delete the `capabilities: { … }` block from every call site and re-emit. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#574](https://github.com/prisma/prisma-next/pull/574))

  Before:

  ```ts
  export const contract = defineContract(
    {
      extensionPacks: { pgvector },
      capabilities: { postgres: { lateral: true, jsonAgg: true } },
    },
    ({ field, model }) => {
      // … model definitions …
    },
  );
  ```

  After:

  ```ts
  export const contract = defineContract(
    { extensionPacks: { pgvector } },
    ({ field, model }) => {
      // … model definitions …
    },
  );
  ```

- **`verifyMarker` replaces `verify` / `RuntimeVerifyOptions`** — the SQL runtime's `verify: { mode, requireMarker }` option is replaced by `verifyMarker?: 'onFirstUse' | false` (default `'onFirstUse'`), and the runtime no longer throws on contract-marker drift — it emits one `warn`-level log line per runtime instance and proceeds. The `RuntimeVerifyOptions` export is removed in favour of `VerifyMarkerOption`. Migrate `verify` call sites and switch fail-fast verification to the `db-verify` CLI. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#592](https://github.com/prisma/prisma-next/pull/592))

  Before:

  ```ts
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
  ```

  After:

  ```ts
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    // verifyMarker omitted — 'onFirstUse' is the default; pass `false` to skip
  });
  ```

- **Migration manifest closed; `labels`/`hints` removed** — the on-disk `migration.json` schema is now closed and no longer carries `labels` or `hints`; a manifest still holding either key fails to load with `INVALID_MANIFEST`. Both fields also leave the content-addressed migration identity, so `migrationHash` changes. Run the colocated codemod to strip the keys and recompute each hash. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#615](https://github.com/prisma/prisma-next/pull/615))
- **MongoDB emits closed `$jsonSchema` validators by default** — every emitted object schema (collection validators, nested objects, and `oneOf` branches) now carries `additionalProperties: false`, and each non-variant Mongo model must resolve to an `objectId` `_id` before emit succeeds. Re-emit your Mongo contracts and apply the open→closed validator change (the planner classifies it as destructive). See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#637](https://github.com/prisma/prisma-next/pull/637))
- **`mongodb` is now a user-supplied peer dependency** — `@prisma-next/driver-mongo`, `@prisma-next/adapter-mongo`, and `@prisma-next/mongo` no longer bundle `mongodb`; install `mongodb@^7` yourself as a peer dependency. ([#597](https://github.com/prisma/prisma-next/pull/597))
- **`.distinct(cols)` now collapses to one row per group** — `.distinct(cols)` on the SQL ORM `Collection` (and on nested `.include(…)`) now keeps a single representative row per `(cols)` group, matching Prisma semantics; previously it did not collapse when the projection carried other distinguishing columns. No call-site change is required, but query results change — review any logic or fixtures that relied on the old non-collapsing output. Extension authors implementing `ExprVisitor` / exhaustive `expr.kind` switches must handle the new `WindowFuncExpr` variant — see the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.11-to-0.12/). ([#576](https://github.com/prisma/prisma-next/pull/576))
- **In-repo CipherStash extension removed** — `@prisma-next/extension-cipherstash` is no longer published from this repo; CipherStash's encrypted-field support now ships from CipherStash's own repository as `@cipherstash/prisma-next`. Depend on that package instead. ([#650](https://github.com/prisma/prisma-next/pull/650))

### Features

- Customize where the contract emitter writes via `outputPath` in `prisma-next.config.ts` or `--output-path` on `prisma-next contract emit`. ([#584](https://github.com/prisma/prisma-next/pull/584))
- Raw SQL in the typed query builder (`rawSql`) for Postgres and SQLite, so escape-hatch expressions compose with the rest of the builder. ([#594](https://github.com/prisma/prisma-next/pull/594))
- `migration list` rewritten to show the complete migration set, ref/graph context, and multi-space output instead of only the migrations along a single chain. ([#603](https://github.com/prisma/prisma-next/pull/603))
- `migration graph --tree` renders a condensed annotated-tree view of the migration topology. ([#658](https://github.com/prisma/prisma-next/pull/658))
- Roll back migrations without editing contract source: reverse edges are now plannable and applyable via `--to`. ([#635](https://github.com/prisma/prisma-next/pull/635))
- Single-query include aggregates in the SQL ORM client — counts and aggregates on included relations are fetched in one query rather than fanning out. ([#596](https://github.com/prisma/prisma-next/pull/596))
- `planExecutionId` on `RuntimeMiddlewareContext`, a fresh per-`execute()` identity letting middleware correlate `beforeExecute` and `afterExecute` for the same call. ([#605](https://github.com/prisma/prisma-next/pull/605))
- Mongo middleware can rewrite query parameters in `beforeExecute` before they are encoded, restoring parity with the SQL param-mutator seam. ([#652](https://github.com/prisma/prisma-next/pull/652))
- `emptyContract({ target })` lets contract-space extensions that contribute only migration invariants (e.g. installing a Postgres extension) omit a contract source instead of hand-authoring an empty one. ([#651](https://github.com/prisma/prisma-next/pull/651))

### Fixes

- Mongo: optional fields that are `undefined` are omitted when deserializing `createIndex`, instead of being written out. ([#580](https://github.com/prisma/prisma-next/pull/580))
- Foreign-key referential actions (`onDelete` / `onUpdate`) are now preserved in the schema IR. ([#608](https://github.com/prisma/prisma-next/pull/608))
- Mongo `db update`: adding an optional field to an existing model now applies cleanly — the validator-widening op is classified and applied correctly instead of being gated or dropped. ([#624](https://github.com/prisma/prisma-next/pull/624))
- The dev→ship transition is fixed: the first `migration plan` after `db update` now succeeds via ref-paired snapshots and an auto-baseline on an empty graph. ([#582](https://github.com/prisma/prisma-next/pull/582))
- `prisma-next init` scaffolds into the canonical `src/prisma/` layout, matching the rest of the framework, so fresh projects start in the expected shape. ([#581](https://github.com/prisma/prisma-next/pull/581))
- In-process contracts built with `defineContract` and passed to `createExecutionContext` now carry the same adapter + driver capability matrix as CLI-emitted contracts. ([#602](https://github.com/prisma/prisma-next/pull/602))

### New contributors

- [@xxiaoxiong](https://github.com/xxiaoxiong) made their first contribution in [#580](https://github.com/prisma/prisma-next/pull/580)
- [@medz](https://github.com/medz) made their first contribution in [#608](https://github.com/prisma/prisma-next/pull/608)

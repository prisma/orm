# Design: row locking clauses on a select

Status: proposed, 2026-09-30. Tracks [prisma/orm#30531](https://github.com/prisma/orm/issues/30531). Every path and line number refers to `main` at `64f6c3e3b7`.

## Decision

Prisma 8 gains a typed way to end a select with a row locking clause, on the typed SQL builder first and on the ORM client second. The methods are named after the SQL they render: `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()`, each taking an options object for `of`, `nowait` and `skipLocked`. Each method and each option is present only when the adapter reports its own capability flag, seven flags in all. The shared select syntax tree gains one target-neutral `LockingClause` node, and each target's renderer owns the syntax.

```ts
await tx.sql.public.contact
  .select('id')
  .where((f, fns) => fns.eq(f.id, contactId))
  .forNoKeyUpdate()
  .build();

const job = await tx.orm.public.Job
  .where({ state: 'queued' })
  .orderBy((j) => j.createdAt.asc())
  .limit(1)
  .forUpdate({ skipLocked: true })
  .first();
```

The first renders `SELECT "id" AS "id" FROM "public"."contact" WHERE "id" = $1 FOR NO KEY UPDATE`. The second renders `SELECT ... FROM "public"."job" WHERE "state" = $1 ORDER BY "createdAt" ASC LIMIT $2 FOR UPDATE OF "job" SKIP LOCKED`.

## Background

### What a row locking clause does

A locking clause on the end of a SELECT locks the rows the SELECT returns until the enclosing transaction commits or rolls back. Another transaction that tries to UPDATE, DELETE or lock the same rows waits until then. It exists so that "read a row, decide from what it holds, then write it" is safe under concurrency: decrementing stock, claiming a job, moving a balance. Postgres has four strengths and two wait modes.

| Clause | What it blocks |
|---|---|
| `FOR UPDATE` | every write and every other lock on the row |
| `FOR NO KEY UPDATE` | writes, but not `FOR KEY SHARE`, which is what a foreign key check takes on the referenced row |
| `FOR SHARE` | writes only; other readers may share-lock |
| `FOR KEY SHARE` | only deletes and changes to key columns |

`NOWAIT` makes the statement fail at once if a row is locked. `SKIP LOCKED` leaves locked rows out of the result, which is what a work queue wants. `OF <table>` limits the lock to the rows of one table when the query joins several. Without either wait mode the statement waits.

Outside a transaction the lock is released as soon as the statement ends. A lock is therefore only useful inside `db.transaction(...)`.

### Who asked

- [prisma/orm#30531](https://github.com/prisma/orm/issues/30531), filed while building the Asks application. Two transactions moving identities out of the same contact at read committed each counted the other's identity as still present, so neither absorbed the contact. The fix was `FOR NO KEY UPDATE` on the contact row, which the application had to write through the raw lane.
- Emie (@dickb0r0) on X, 2026-09-29, [thread](https://x.com/dickb0r0/status/2104858419819597998): asked how to express `FOR UPDATE` through Prisma's query API and whether its absence was a deliberate database-agnostic choice or just unbuilt.
- The Prisma 6 and 7 requests: prisma/prisma#5983, #8580 and #17136, open since 2021 and never shipped.

For Prisma 8 the answer is that it is unbuilt, not a choice. The capability model already carries target-specific clauses such as `DISTINCT ON` and `RETURNING`, and row locking fits it without an architectural change.

### What exists today

- `packages/2-sql/4-lanes/sql-builder/STATUS.md:51` lists row locking under "What's missing".
- `SelectAstOptions` in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1583-1596` has no field that could hold a lock, so no renderer can print one.
- The Postgres renderer `renderSelect` in `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts:204-241` stops at `OFFSET`. The SQLite renderer in `packages/3-targets/6-adapters/sqlite/src/core/adapter.ts:235-271` has the same list.
- `SelectQuery` in `packages/2-sql/4-lanes/sql-builder/src/types/select-query.ts:18-81` has no locking method. `CollectionState` in `packages/3-extensions/sql-orm-client/src/types.ts:89-110` has no locking field.
- Only the raw lane can write the clause, with unchecked table and column names and an untyped row.
- The precedent to copy is `DISTINCT ON`: a `GatedMethod` on `postgres.distinctOn` in the builder (`select-query.ts:66-80`, runtime `query-impl.ts:67-78`), a `never` parameter type plus `assertDistinctOnCapability` in the ORM (`collection.ts:1090`, `collection-contract.ts:637-652`), and the flag declared by the Postgres adapter in `adapter.ts:20-39` and `descriptor-meta.ts:150-165`.

## Survey of databases

The capability flags have to survive targets we do not ship yet. Every column below varies independently of the others, which is the argument for one flag per column.

| Database | FOR UPDATE | FOR SHARE | FOR NO KEY UPDATE, FOR KEY SHARE | OF table | NOWAIT | SKIP LOCKED | Source |
|---|---|---|---|---|---|---|---|
| Postgres, Neon, Supabase, PlanetScale Postgres | yes | yes | yes | yes | yes | yes | Postgres `SELECT` reference |
| CockroachDB, YugabyteDB | yes | accepted, weaker semantics | accepted | yes | yes | yes | Cockroach `SELECT FOR UPDATE` docs |
| Neki (PlanetScale sharded Postgres, preview) | yes, per shard | yes | yes | yes | yes | yes | PlanetScale Neki limitations page: no locking restriction listed; cross-shard transactions have no atomic commit |
| MySQL 8 | yes | yes | no | yes | yes | yes | MySQL `SELECT` reference |
| MariaDB | yes | as `LOCK IN SHARE MODE` | no | no | yes | yes, 10.6+ | MariaDB `SELECT` reference |
| Vitess, PlanetScale MySQL | yes | yes, plus `LOCK IN SHARE MODE` | no | no | yes | yes | Vitess `go/vt/sqlparser/sql.y`, rule `locking_clause` |
| Oracle | yes | no | no | by column | yes | yes | Oracle `SELECT` reference |
| SQL Server | as the table hint `UPDLOCK, ROWLOCK` on the FROM item | as `HOLDLOCK` | no | hints are per table | `NOWAIT` hint | `READPAST` hint | SQL Server table hints reference |
| SQLite, Cloudflare D1 | no | no | no | no | no | no | a writer locks the whole database; `BEGIN IMMEDIATE` is the substitute |

Two things in the table are semantics rather than syntax and are not modelled by capabilities. On a sharded target (Vitess with more than one shard, Neki) a row lock holds only inside the shard the row lives on, and `SKIP LOCKED` with `LIMIT` fans out to every shard, so it can lock up to `LIMIT` rows per shard. Cockroach accepts `FOR SHARE` and treats it more weakly than Postgres unless a session setting is on. The syntax renders the same, so the adapter reports the same flags. Each such adapter's docs must say so.

## Design

### Capabilities

Capabilities in this repo follow one rule: a flag per builder method or option, in the `sql` group when more than one dialect has it and in a dialect group when only one does. `insertOnConflictSkip` and `insertOnConflictWithoutTarget` are the existing example of an option and its sub-option as two flags. Row locking follows the rule with seven boolean flags.

| Flag | What it says the target can render |
|---|---|
| `sql.forUpdate` | `FOR UPDATE` |
| `sql.forShare` | `FOR SHARE` or its equivalent |
| `sql.lockOf` | a table list on a locking clause |
| `sql.lockNowait` | `NOWAIT` or its equivalent |
| `sql.lockSkipLocked` | `SKIP LOCKED` or its equivalent |
| `postgres.forNoKeyUpdate` | `FOR NO KEY UPDATE` |
| `postgres.forKeyShare` | `FOR KEY SHARE` |

Who reports what:

| Adapter | Flags |
|---|---|
| Postgres (ships now) | all seven |
| SQLite (ships now) | none |
| MySQL (future) | the five `sql` flags |
| Vitess (future) | `sql.forUpdate`, `sql.forShare`, `sql.lockNowait`, `sql.lockSkipLocked` |
| MariaDB (future) | `sql.forUpdate`, `sql.forShare`, `sql.lockNowait`, `sql.lockSkipLocked` |
| Oracle (future) | `sql.forUpdate`, `sql.lockNowait`, `sql.lockSkipLocked` |
| SQL Server (future) | all five `sql` flags, rendered as hints |
| Cockroach, Yugabyte, Neki (future) | all seven, because they report the `postgres` group |

No flag ever has to be split later for any database in the survey. That is the future-compatibility test.

Declared in the Postgres adapter at `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:20-39` and `descriptor-meta.ts:150-165`, and documented in `docs/reference/capabilities.md` under `sql` and `postgres`.

### The syntax tree

`SelectAst` is shared by every target, so the node describes what is locked and how to wait, never how one dialect writes it. The value names match the builder methods, so one name serves the AST, the builder and the ORM.

```ts
export type LockStrength = 'forUpdate' | 'forNoKeyUpdate' | 'forShare' | 'forKeyShare';
export type LockWait = 'nowait' | 'skipLocked';

export class LockingClause {
  readonly strength: LockStrength;
  readonly of: ReadonlyArray<string> | undefined;
  readonly wait: LockWait | undefined;
}
```

`of` holds table names or aliases as they appear in `FROM` and the joins, never schema-qualified, because Postgres refuses a qualified name there. `wait` is a single field rather than two booleans so the tree cannot hold both.

`SelectAstOptions` and `SelectAst` (`types.ts:1583-1612`) gain `locking: ReadonlyArray<LockingClause> | undefined`. It is an array because Postgres allows several clauses on one select, each naming different tables. The constructor freezes a copy as it does for `joins` and `orderBy`; `from()`, `noFrom()`, `toOptions()` and `rewrite()` carry it; `withLocking(clauses)` is added beside `withDistinctOn`. `rewrite()` leaves the clause unchanged, because it holds names, not expressions.

The constructor refuses a tree that combines `locking` with `distinct`, `distinctOn`, `groupBy` or `having`, with a structured error, because Postgres refuses every such statement. A lock together with an aggregate or window function in the projection is refused by the builders at `build()` rather than by the constructor, because the constructor does not walk the projection today and the builders already know what they projected.

A `LockingClause` follows the frozen-class pattern the other nodes use (`freezeNode` in the constructor, static `of(...)` factory).

### The renderers

The Postgres renderer (`sql-renderer.ts:204-241`) appends one rendered clause per entry after `offsetClause`, in order: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` or `FOR KEY SHARE`, then `OF "a", "b"` when `of` is set, then `NOWAIT` or `SKIP LOCKED` when `wait` is set. Names in `of` are quoted with the same quoting as identifiers elsewhere. Before rendering, the renderer checks each clause against the adapter's own capabilities and throws an adapter error naming the missing flag if a strength or option it did not report is present. This is what protects a hand-built tree, which no builder checked.

The SQLite renderer (`adapter.ts:235-271`) throws a structured error when `ast.locking` is set. Dropping the clause silently would turn a lock into no lock, which is the worst outcome.

Future renderers map the same node to their own syntax: MariaDB writes `LOCK IN SHARE MODE` for `forShare`; SQL Server turns each clause into `WITH (UPDLOCK, ROWLOCK)` or `WITH (HOLDLOCK)` on the FROM items named in `of`, or on every FROM item when `of` is unset, and turns `wait` into the `NOWAIT` or `READPAST` hint. None of this is built now; the point is that the node carries enough for it.

### The typed SQL builder

`SelectQuery` (`types/select-query.ts`) gains four methods, each a `GatedMethod` on its own flag, each returning `SelectQuery` so that `where`, `orderBy`, `limit`, `offset`, `as` and `build` may still follow in any order.

```ts
forUpdate: GatedMethod<QC['capabilities'], { sql: { forUpdate: true } }, (options?: LockOptions<QC, AvailableScope>) => SelectQuery<QC, AvailableScope, RowType>>;
forNoKeyUpdate: GatedMethod<QC['capabilities'], { postgres: { forNoKeyUpdate: true } }, ...>;
forShare: GatedMethod<QC['capabilities'], { sql: { forShare: true } }, ...>;
forKeyShare: GatedMethod<QC['capabilities'], { postgres: { forKeyShare: true } }, ...>;
```

The options type is built from the capabilities too, so each key exists only when its flag is present, and `nowait` and `skipLocked` sit in a union so passing both is a type error:

```ts
type LockOf<QC, S extends Scope> = QC['capabilities'] extends { sql: { lockOf: true } }
  ? { readonly of?: ReadonlyArray<keyof S['namespaces'] & string> }
  : { readonly of?: never };

type LockWaitOptions<QC> =
  | (QC['capabilities'] extends { sql: { lockNowait: true } } ? { readonly nowait?: true; readonly skipLocked?: never } : never)
  | (QC['capabilities'] extends { sql: { lockSkipLocked: true } } ? { readonly skipLocked?: true; readonly nowait?: never } : never)
  | { readonly nowait?: never; readonly skipLocked?: never };

type LockOptions<QC, S extends Scope> = LockOf<QC, S> & LockWaitOptions<QC>;
```

`of` accepts only the table names and aliases in scope, the way `distinctOn` accepts only fields in scope. The existing `Capabilities extends Required` check does all of this; no new type helper is needed.

At run time each method goes through `_gate(...)` as `distinctOn` does (`query-impl.ts:67-78`), which throws when the flag is absent, then also checks the option flags and appends a `LockingClause` to a new `locking` array on `BuilderState` (`builder-base.ts:70-91`). Each call appends, so `forUpdate({ of: ['a'] }).forShare({ of: ['b'] })` produces two clauses. `buildSelectAst` (`builder-base.ts:155-173`) passes the array through.

`build()` refuses, with a structured error, a lock together with `distinct`, `distinctOn`, `groupBy`, `having` or an aggregate in the projection. `groupBy()` already returns `GroupedQuery`, which does not get the four methods, so the most common refusal is a type error before it is a run-time one.

A locked select used as a subquery through `.as(...)` is legal Postgres but rare. The first version refuses it at `build()` and leaves it for later.

### The ORM client

Slice 2. `Collection` (`collection.ts`) gains the same four methods with the same names and flags. Each parameter is typed `never` without the flag, as `distinctOn` is (`collection.ts:1090-1105`), and each asserts the flag at run time with an `assertLockCapability(contract, flag, methodName)` beside `assertDistinctOnCapability` (`collection-contract.ts:637-652`), throwing `ORM.CAPABILITY_MISSING` with the flag in `meta`.

```ts
forUpdate(options?: OrmLockOptions<TContract>): Collection<TContract, ModelName, Row, State>;
```

`OrmLockOptions` offers `nowait` and `skipLocked` under their flags, as the builder does, and does not offer `of`. The ORM always renders `OF "<the model's table or its alias>"`, so only the model's own rows are locked. Without `OF`, Postgres tries to lock every table in `FROM`, and `include` adds joins and subqueries whose rows the caller did not ask to lock; Postgres also refuses to lock the nullable side of an outer join.

`CollectionState` (`types.ts:89-110`) gains `locking: ReadonlyArray<LockingClause> | undefined`, set to `undefined` in `emptyState()`. `buildSelectAst` (`query-plan-select.ts:1379-1444`) applies it to the outermost select with `withLocking`. Only the read terminals `all` and `first` use it.

Refused at compile time with a structured error, in this slice: a lock together with `include`, `groupBy`, `aggregate`, `distinct` or `distinctOn`, and a mutation terminal (`update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`, `create`, `upsert`) called on a locked collection. A mutation already locks the rows it changes, and dropping the requested lock silently would hide a mistake. `include` is refused because the include lowering wraps the base select in json_agg subqueries and sometimes an outer `DISTINCT` (`query-plan-select.ts:1044-1047`), and placing the lock on the inner base-table select correctly is where the bugs would live. Support for `include` with a lock comes only if someone asks for it, as its own slice.

The ORM does not refuse a lock outside a transaction. The lock is then released when the statement ends, which is legal and sometimes intended, for example `nowait` to test whether a row is free. The docs say a lock lasts until the transaction ends, so it is only useful inside `db.transaction(...)`.

### Errors

| Situation | Where | Error |
|---|---|---|
| Method called without its flag, builder | `_gate` | the existing capability error the builder throws for `distinctOn` |
| Option passed without its flag, builder | the method | the same error, naming the option's flag |
| Method called without its flag, ORM | the method | `ORM.CAPABILITY_MISSING`, `meta.capability` = the flag |
| Lock with distinct, distinctOn, groupBy or having | `SelectAst` constructor | a structured error, code `AST.LOCK_INCOMPATIBLE` |
| Lock with an aggregate projection, or a locked subquery | `build()` | a structured error, code `SQL_BUILDER.LOCK_INCOMPATIBLE` |
| Lock with include, aggregate, distinct, distinctOn or a mutation terminal, ORM | compile | a structured error, code `ORM.LOCK_INCOMPATIBLE` |
| Tree carries a strength or option the adapter did not report | renderer | an adapter error naming the flag |
| Tree carries any lock, SQLite | renderer | a structured error |
| A row is locked and `nowait` was set | the database | SQLSTATE `55P03`, `lock_not_available`, surfaced as the driver error; mapping it to a structured code is a follow-up |

The exact code strings follow whatever the neighbouring errors in each package use.

### Semantics the docs must state

- A lock lasts until the transaction ends, so use it inside `db.transaction(...)`.
- `forNoKeyUpdate` is usually the right strength when other transactions insert or update rows that reference the locked row. Every such write takes `FOR KEY SHARE` on the referenced row for its foreign key check, and `FOR UPDATE` conflicts with that, so two moves in opposite directions can deadlock where `FOR NO KEY UPDATE` lets them proceed.
- `skipLocked` with `limit` is the work-queue pattern. On a sharded target it can lock up to `limit` rows per shard.
- Under `nowait` a locked row fails the statement with SQLSTATE `55P03`.

## Slices

1. Syntax tree, Postgres renderer, SQLite refusal, the seven flags, the four builder methods, `STATUS.md`, `capabilities.md`.
2. The four ORM methods with the refusals above, `query-patterns.md`, the `prisma-8` skill.
3. Only if asked: `include` together with a lock in the ORM, and locked subqueries in the builder.

Slice 1 is about the size of the `DISTINCT ON` work.

## Tests

Slice 1:

- `packages/2-sql/4-lanes/relational-core/test/ast/builders.test.ts`: `withLocking` keeps clauses through the other `with...` calls and `rewrite()`; the constructor refuses a lock with `distinct`, `distinctOn`, `groupBy` and `having`.
- `packages/3-targets/6-adapters/postgres/test/adapter.test.ts`: each of the four strengths renders; `nowait` and `skipLocked` render; `of` renders an unqualified quoted name; two clauses render in order; the clause follows `LIMIT` and `OFFSET`; a tree carrying a flag the adapter did not report is refused.
- `packages/3-targets/6-adapters/sqlite/test/adapter.test.ts`: a select carrying a lock is refused with a structured error.
- `packages/2-sql/4-lanes/sql-builder/test/runtime/builders.test.ts`: each method puts its clause on the built tree; two calls append; `build()` refuses a lock with an aggregate projection and a locked subquery.
- New `packages/2-sql/4-lanes/sql-builder/test/types/lock.types.test-d.ts`: the four methods exist on a Postgres `SelectQuery`, not on `GroupedQuery`, and not on a SQLite contract; `of` accepts only names in scope; `nowait` and `skipLocked` together is a type error; each option key is absent without its flag.
- New `test/integration/test/sql-builder/lock.test.ts`: each variant runs inside a transaction against the embedded Postgres and returns the expected row. PGlite serves one connection, so this checks that Postgres accepts the statements, not that a second transaction waits.

Slice 2:

- New `packages/3-extensions/sql-orm-client/test/lock-capability.test.ts` and `lock-capability.test-d.ts`, modelled on `distinct-on-capability.test.ts` and its type test: each method exists only with its flag and throws `ORM.CAPABILITY_MISSING` without it.
- `packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts`: each method renders `OF` the model's table; every refusal in the ORM section holds.
- A test under `test/integration/test/sql-orm-client/`: the work-queue query returns a row inside a transaction.
- If the suite gains a real Postgres server, port the Prisma 7 test "high concurrency with SET FOR UPDATE" (`test/integration/test/ports/prisma/non-ported/functional/interactive-transactions/interactive-transactions.md:58`) with `forUpdate()`, and mark it portable in `projects/port-all-tests/checklists/prisma-functional-0-l.md:991`.

Commands that must pass: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm test:packages`, and the integration files above.

## Documents to update

- `packages/2-sql/4-lanes/sql-builder/STATUS.md:51`: move row locking to what is supported. `packages/2-sql/4-lanes/sql-builder/README.md`: the four methods.
- `docs/reference/capabilities.md`: the seven flags.
- `docs/reference/query-patterns.md`: a section on locking rows with the read-then-write and work-queue examples.
- `skills/prisma-8/references/queries-postgres.md`: in "Workflow — Transactions" (line 421) show the methods on both builders and say a lock lasts until the transaction ends; in "Common Pitfalls (Postgres)" (line 461) the `forNoKeyUpdate` advice above.
- An upgrade note in `skills/prisma-8/upgrading/` for the release that adds it.

## Alternatives considered

**One method, `lock(strength, options)`.** Rejected. The builder mirrors SQL words everywhere else (`distinctOn`, `groupBy`, `orderBy`, `limit`), and four methods let each strength carry its own capability flag, which one method with a string argument cannot do in the types.

**One flag, `postgres.rowLocking`.** Rejected. Vitess has `FOR UPDATE` with `NOWAIT` and `SKIP LOCKED` but no `OF`; MariaDB the same; Oracle has no `FOR SHARE`; MySQL has neither Postgres-only strength. One flag would have to be split the first time any of them ships.

**Two flags, `rowLocking` and `keyLocking`.** Rejected for the same reason: the options vary independently of the strengths.

**A `wait: 'nowait' | 'skipLocked'` option instead of two booleans.** Rejected for the public API because `forUpdate({ skipLocked: true })` reads as the SQL. The union type gives the same exclusivity. The AST keeps a single `wait` field, because a tree should not be able to hold both.

**Postgres syntax in the AST, for example `strength: 'FOR NO KEY UPDATE'`.** Rejected. The tree is shared by every target and a SQL Server renderer would have to parse Postgres words to place hints. The values use the same camel-case names as the methods, which read as SQL without being one dialect's spelling.

**Refusing a lock outside a transaction in the ORM.** Rejected. It is legal Postgres and `nowait` outside a transaction is a way to test whether a row is free. The docs state the lifetime instead.

**Supporting `include` with a lock in the first ORM slice.** Deferred. The plain select is the read-then-write and work-queue case and lowers to one SELECT. Include lowering wraps the base select in aggregates and sometimes DISTINCT, which Postgres refuses to lock at the same level, so the lock must go on the inner base-table select with `OF` that table. It is doable, but it is the only part with real risk, and nobody has asked for it.

**Rendering the ORM's lock without `OF`.** Rejected. Once include is supported the outer query joins tables the caller did not ask to lock, and Postgres refuses to lock the nullable side of an outer join. Always naming the model's table keeps the behaviour the same with and without include.

## Out of scope

- Table-level locks (`LOCK TABLE`) and advisory locks (`pg_advisory_xact_lock`).
- Locking clauses on `UPDATE` or `DELETE`, which lock the rows they change already.
- Isolation levels and `SET TRANSACTION`.
- Renderers for MySQL, MariaDB, Vitess, Oracle or SQL Server. The flags and the node leave room for them.
- A raw lane on the transaction context (`tx.raw`). The application in the issue worked around its absence, and this feature removes the need.
- Mapping SQLSTATE `55P03` to a structured error code.

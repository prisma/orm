
# Prisma Next — Migration Authoring

> **Edit your data contract. Prisma Next plans the migration. You fill in any data transforms.**

The three-step user model:

1. **You edit your data contract.** (`references/contract.md`)
2. **Prisma Next plans the migration for you.** ← this skill
3. **If a data transform is needed, you edit `migration.ts` and self-emit.** ← this skill

Once the contract changes, you choose how the change reaches the database. This skill covers the two paths (`db update` and `migration plan` + `db migrate`), the migration-package contract, the `migration.ts` authoring API, and the failure modes you recover from without leaving the loop.

**Targets.** Migration authoring is first-class for **Postgres** and **Mongo**. The CLI reads the target from `prisma.config.ts` (set during `prisma orm init --target …`). Migration commands do not accept a `--target` flag — use a config scoped to the target you need. Examples below call out target-specific imports, markers, factories, and transaction behavior where they diverge.

## When to Use

- User edited the contract and wants to apply the change to the DB.
- User wants to author a migration with a data transform.
- User wants to run pending migrations against a local DB.
- User hit `MIGRATION.HASH_MISMATCH`, `PN-MIG-2001` (unfilled placeholder), or a partially-applied migration.
- User mentions: *migrate, migration, db push, db update, `prisma migrate dev`, `prisma migrate deploy`, drift, hash mismatch, data backfill*.

## When Not to Use

- User wants to know what migrations *will run on deploy* / on merge, or to manage refs and invariants → `references/migration-review.md`.
- User wants to edit the contract → `references/contract.md`.
- User wants a deeper read of a single structured error envelope → `references/debug.md`.

## Key Concepts

- **`db update` (quick path).** Reads the emitted contract, diffs against the live DB, applies the change. Optional `--dry-run` prints the plan without executing. Interactive destructive-op confirmation (or `-y` to auto-accept). **Writes no migration directory.** Operations needing data transforms are not handled by this path — `db update` excludes the `data` operation class entirely and short-circuits where a data transform would be required. Use only against a database that has no shared history with anyone else (your local dev DB).
- **`migration plan` (formal path).** Reads the emitted contract, diffs against the head of the on-disk migration graph, writes a new migration package under `migrations/app/<YYYYMMDDTHHMM>_<snake_slug>/`. If any operation needs a data transform, the package's `migration.ts` contains `placeholder(...)` calls you fill in.
- **The `app/` segment in migration paths is the consuming application's contract-space id.** Every migration *you* author lives under `migrations/app/`. Extensions your contract depends on get their own sibling directories (`migrations/<extension-space-id>/`) — those are managed by the extension package and you don't write into them. The `app/` segment lands automatically the first time you run `migration plan` / `db init` against an app-level config.
- **Migration package files** (inside each `migrations/app/<dir>/`):
  - `migration.json` — manifest (metadata + `migrationHash`).
  - `ops.json` — canonical operation list. Content-addressed; `migrationHash` is computed over this.
  - `migration.ts` — TypeScript authoring source, **framework-rendered** by `migration plan` (or `migration new`). You edit specific holes in it (see *Fill a placeholder* below) and re-emit `ops.json` / `migration.json` by running it.
- **Contract snapshots.** `migration.ts` imports its bookend contracts from the shared, content-addressed store at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts` (`<hex>` is the contract's 64-hex storage hash) — not from files inside the migration package.
- **Self-emit.** Running `node migrations/app/<dir>/migration.ts` regenerates `ops.json` and `migration.json` from the (possibly edited) TS source. This is the only supported way to update an existing migration package after edits.
- **`migration.ts` shape.** Framework-rendered. A class extending `Migration` (from `@internal/family-mongo/migration` on Mongo, or re-exported via `@internal/postgres/migration` on Postgres — see the framing block below), with an `operations` getter that returns an array of factory-call values. The file ends with `MigrationCLI.run(import.meta.url, M)` so executing it self-emits.
- **`placeholder(slot)`.** A sentinel the planner emits into the rendered `migration.ts` (from `@internal/errors/migration` on Mongo, or the `@internal/postgres/migration` import on Postgres) wherever a data transform is needed. Calling `placeholder(...)` at emit time throws `PN-MIG-2001` *Unfilled migration placeholder*. The user replaces the `() => placeholder(...)` arrow with a real query-plan closure (Postgres) or fills `dataTransform({ check, run })` sources (Mongo — see *Fill a placeholder*), then self-emits.
- **`this.dataTransform(endContract, name, { check, run })`.** The data-transform factory. `check` is a rowset query whose presence-of-any-row signals "work remains"; `run` is one or more mutation queries that perform the backfill. Both are lazy closures returning query-plans built against `endContract`. The runner wraps `check` as `EXISTS(...)` for precheck and `NOT EXISTS(...)` for postcheck, so the same closure asserts both "there is work" and "the work is done".
- **`pendingPlaceholders`.** A boolean field on the JSON result of `migration plan`. `true` means the package was written but contains unfilled placeholders — `db migrate` will throw `PN-MIG-2001` until you edit `migration.ts` and self-emit.
- **`migrationHash`.** Content-addressed identity of a migration package. `MIGRATION.HASH_MISMATCH` fires when the stored hash in `migration.json` disagrees with the hash recomputed from the on-disk files (almost always: someone edited `migration.ts` without self-emitting).
- **Marker.** Records "this database is at contract hash X for space Y". **Postgres:** a row in `prisma_contract.marker`. **Mongo:** a document in the `_prisma_migrations` collection (keyed by space). Each successful migration advances the marker once schema verification passes for that space. `db sign` writes the marker from the current contract hash, but only after a schema-verification pass succeeds (it will not sign a database whose live schema disagrees with the contract).
- **Apply atomicity.** **Postgres:** each migration runs inside `BEGIN ... COMMIT`; on failure, Postgres rolls back and the marker stays at the previous migration's `to` hash. **Mongo:** DDL ops (`createCollection`, `createIndex`, `collMod`, `setValidation`, …) are not wrapped in a multi-document transaction; the runner applies ops, verifies the live schema against the destination contract, and advances the marker only on verify-pass (resumable across spaces — see the MongoDB family doc). Ordinary DDL + `dataTransform` flows stay consistent; partial state from failed mid-migration runs is diagnosed with `db verify` / `db schema`, not assumed away.
- **Operation classes.** Every operation declares an `operationClass`: `additive`, `widening`, `data`, or `destructive`. The CLI surfaces these in the plan preview and in JSON output. There is no `long-running` class and the framework does not emit `CREATE INDEX CONCURRENTLY` — operations stay transactional.

## `migration.ts` is framework-rendered, not hand-authored

Files under `migrations/<space-id>/<timestamp>/migration.ts` (for your own app, `<space-id>` is always `app/`) are **rendered for you** by the framework — `prisma migration plan` writes a populated package whenever the contract changes, and `prisma migration new` writes an empty scaffold when you want to author operations directly. You do not write these files from scratch. You edit specific holes the framework leaves behind — chiefly replacing `placeholder("<slot>")` sentinels (Postgres) or filling `dataTransform({ check, run })` pipeline slots (Mongo) — then self-emit.

**Postgres** rendered imports point at `@internal/postgres/migration` (or `@internal/sqlite/migration` for SQLite projects).

**Mongo** rendered imports use `@internal/family-mongo/migration` for the `Migration` base class and `@internal/target-mongo/migration` for operation factories (`createIndex`, `dataTransform`, …). `MigrationCLI` comes from `@internal/cli/migration-cli`.

Treat the rendered import lines as framework-managed on both targets:

- Leave them where they are. Don't rewrite them to a different `@internal/<…>` path; the framework's renderer is the authoritative shape and any change you make by hand will be reverted (and may trip `MIGRATION.HASH_MISMATCH`) the next time the package is re-rendered or self-emitted.
- If you need an additional factory symbol, **add it to the existing rendered import line** (Postgres: `@internal/postgres/migration`; Mongo: `@internal/target-mongo/migration`) rather than introducing a second import from a different `@internal/...` subpath.
- The "user code imports only from `@internal/<target>`" convention applies to *your* own modules (queries, runtime setup, contract authoring). The framework-rendered `migration.ts` scaffold is the framework's surface, not yours; the rule is suspended for that one file.

## Diagnostic codes you route on

| Code | Source | Move |
|---|---|---|
| `PN-MIG-2001` *Unfilled migration placeholder* | Throwing `placeholder(...)` at emit time | Open `migration.ts`, replace the named `placeholder("<slot>")` call with the real query closure, self-emit. |
| `PN-MIG-2002` *migration.ts not found* | Reading a migration package | The package is malformed. Recover from version control, or run `prisma migration new` for a fresh one. |
| `PN-MIG-2003` *invalid default export* | Loading `migration.ts` | The file's default export is not a `Migration` subclass or factory function. Restore the planner-emitted scaffold from version control or re-run `migration plan` for a clean package. |
| `PN-MIG-2005` *dataTransform contract mismatch* | Building a data-transform query plan | The query builder was instantiated with a contract reference different from the `endContract` passed to `this.dataTransform(...)`. Use the `endContract` imported at module scope for both. |
| `MIGRATION.HASH_MISMATCH` *Migration package is corrupt* | `db migrate` (or any read of the package) | `ops.json` / `migration.json` were edited without self-emitting. Run `node migrations/app/<dir>/migration.ts` to re-emit, then re-run `db migrate`. |
| `PN-RUN-3002` *Hash mismatch* | `db verify` | The marker disagrees with the contract hash (**Postgres:** `prisma_contract.marker`; **Mongo:** `_prisma_migrations`). The DB is at a different contract version than the code thinks. Either run a migration forward, or — if the DB is correct and the marker is stale after a manual fix-up — run `db sign`. |
| `PN-RUN-3001` *Database not signed* | Any command needing a marker | The DB has no marker yet. Run `prisma db init --db <url>` to baseline an empty database, or `db update --db <url>` to apply the current contract directly. |

## Decision — which path do you take?

| Situation | Path | Why |
|---|---|---|
| Local dev, schema in flux | `db update` | Fast, interactive, no migration files. |
| Shared branch with other developers | `migration plan` + `db migrate` | Replayable, reviewable, content-hashed. |
| Anything reaching production | `migration plan` + `db migrate` | Production must run a reviewed, hashed migration. |
| Adding a column that needs a backfill | `migration plan` (writes `placeholder`), edit `migration.ts`, self-emit, then `db migrate` | `db update` does not author data transforms; the formal path does. |
| Recovering from drift (DB diverged from contract) | `db sign` after manual fix, *or* `migration plan` if PN can plan the fix | Depends on which side is right. See *Recover from drift* below. |

## Dev → ship transition (the `db` ref pattern)

Example — iterate locally with `db update`, then publish the first real migration:

```bash
pnpm prisma db init --db $DATABASE_URL
pnpm prisma contract emit && pnpm prisma db update --db $DATABASE_URL
pnpm prisma contract emit && pnpm prisma migration plan --name add_feature
pnpm prisma db migrate --db $DATABASE_URL
pnpm prisma db verify --db $DATABASE_URL
```

The `db` ref is a named pointer at `migrations/app/refs/db.json` — just `{ hash, invariants }`. It records which contract hash the project's dev database has been brought up to — the offline planner's stand-in for "where is my local DB?" without opening a connection at plan time. The contract it names resolves through the shared content-addressed store at `migrations/snapshots/<hex>/contract.json` by that hash, the same store every migration graph node resolves through.

**What `db init` / `db update` write.** When run against the project's default `--db` URL (no explicit `--db` flag), both commands implicitly advance the `db` ref: they write-if-absent the post-command contract IR into the snapshot store, then write the ref's pointer. Override the ref name with `--advance-ref <name>`. When you pass `--db <non-default-url>`, ref advancement is suppressed unless `--advance-ref` is explicit — reconciling a different database is not the same as checkpointing this project's dev state.

The on-disk layout is just the pointer:

```text
migrations/app/refs/
└── db.json                 # { "hash": "<hex>", "invariants": [] }
```

**First `migration plan` after dev iteration.** `migration plan` defaults `--from` to the `db` ref. When the on-disk migration graph is still **empty** and the `db` ref points at a non-null hash with a store entry (typical after one or more `db update` cycles), the planner emits **two** bundles instead of one:

1. Baseline: `null → from-hash` (introduces `from-hash` as a graph node)
2. Delta: `from-hash → current_contract`

Both land on disk in one invocation — expect two new directories in `git status`. `db migrate` then finds a path through the baseline and applies the delta. This closes the dev → ship trap where a single-bundle plan referenced a hash that was not yet a graph node and produced an unapplyable migration (`MIGRATION.PATH_UNREACHABLE` at apply time).

**The forgot-the-flag pitfall.** After the graph is **non-empty**, the default `db` ref may point **past the graph tip** (the ref advanced on every `db update` while you iterated, but you never committed migrations). The next implicit-default `migration plan` refuses with `MIGRATION.HASH_NOT_IN_GRAPH` and names reachable refs that point at graph nodes.

Recovery when you see `MIGRATION.HASH_NOT_IN_GRAPH` on plan:

```bash
# Option A — plan from a graph node explicitly
pnpm prisma migration plan --from production --name my_change

# Option B — realign the db ref to a graph-node hash, then plan with the default
pnpm prisma migration ref set db <graph-node-hash>
pnpm prisma migration plan --name my_change
```

If the `db` ref's pointer is itself missing and the hash isn't a graph node either (`MIGRATION.SNAPSHOT_MISSING`), create it with `migration ref set db <hash>` or advance it with `db update --advance-ref db`.

**After plain `db migrate`.** `db migrate` does not implicitly advance the `db` ref (production-shaped commands stay explicit). The live marker advances while the ref may lag. Refresh with `db update` (no-op on DB when already current) or `db migrate --advance-ref db` in the same invocation.

**When to switch paths.** Use `db update` while the schema is in flux on a solo dev database. Switch to `migration plan` + `db migrate` when the change needs a reviewable, replayable migration — typically before opening a PR or touching any shared environment. The `db` ref bridges the two: it captures dev iteration state on disk so the first formal plan knows where you left off.

**Graph-node rule (plan time).** Any hash used as a `from` end — explicit `--from`, default `db` ref, or ref name — must already be a node in the on-disk migration graph once the graph is non-empty. The auto-baseline two-bundle emission is the one exception: it applies only on an **empty** graph with a non-null ref-resolved `from` and an available store entry. If the ref's pointer is missing and the hash isn't a graph node either, plan refuses with `MIGRATION.SNAPSHOT_MISSING` instead.

**Apply-time complement.** `db migrate` reads the live marker before DDL. If the marker hash is not a graph node, the command refuses with `MIGRATION.MARKER_MISMATCH` — catching drift the offline planner cannot see. This is separate from `MIGRATION.MARKER_NOT_IN_HISTORY`, which fires later during the runner's graph walk when the marker is off the path being traversed. See `references/migration-review.md` for the full diagnostic catalog.

`db` is a **default ref name**, not a reserved one. The framework overwrites it on the next dev cycle; you may `migration ref set db <hash>` explicitly and accept that a subsequent `db update` replaces it when run against the default URL.

Canonical detail: [Migration System § Contract resolution through the snapshot store](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md#contract-resolution-through-the-snapshot-store), [§ `migration plan`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md#migration-plan), [§ Recovery affordances](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md#recovery-affordances), [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](../../docs/architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) (TML-2629, its paired-snapshot part superseded — see the ADR's Status note), and [ADR 240 — Contract snapshots live in a content-addressed store](../../docs/architecture%20docs/adrs/ADR%20240%20-%20Contract%20snapshots%20live%20in%20a%20content-addressed%20store.md).

## Workflow — `db update` (quick path)

The concept: `db update` resolves the destination (`emitted contract`) against the live DB and applies the difference. Preview with `--dry-run`. Destructive ops prompt interactively unless you pass `-y` or `--no-interactive`. The path excludes operations of the `data` class entirely — if the diff requires a data transform, `db update` fails with a planning error and you switch to `migration plan` to author the transform.

Run after a contract edit:

```bash
pnpm prisma contract emit
# Postgres: --db postgresql://...
# Mongo:    --db mongodb://...  (dev scaffolds often need ?replicaSet=rs0)
pnpm prisma db update --db $DATABASE_URL --dry-run
pnpm prisma db update --db $DATABASE_URL
```

`db update` already verifies schema and advances the marker on success — a follow-up `db verify` is redundant on the happy path. Use `db verify` only when you need a standalone diagnostic (see *Verify contract vs DB*).

Inspect the JSON output to drive the next move:

```bash
pnpm prisma db update --db $DATABASE_URL --json
```

The JSON contains `plan.operations[]` with each `operationClass`, plus (in apply mode) `execution.operationsExecuted` and the post-apply `marker.storageHash`. If the command failed because of destructive operations, the error envelope's `meta.destructiveOperations[]` lists exactly what would have been dropped.

## Workflow — `migration plan` + `db migrate` (formal path)

The concept: `migration plan` writes a new migration package on disk. If the planner needed any data transforms, the package is *pending* — `migration.ts` holds `placeholder(...)` calls until you fill them in. `db migrate` runs every pending package in graph order, transactionally.

Plan a change:

```bash
pnpm prisma contract emit
pnpm prisma migration plan --name <snake_slug>
```

Read the result. The JSON shape exposes the queryable signals:

- `dir` — the path of the new package (e.g. `migrations/app/20260515T1200_add_user_email/`).
- `pendingPlaceholders` — `true` if `migration.ts` still contains `placeholder(...)` calls.
- `operations[].operationClass` — for spotting `destructive` and `data` ops.
- `preview.statements` — family-agnostic textual preview.

Inspect the package:

```bash
pnpm prisma migration show
pnpm prisma migration show <dirName-or-migrationHash-prefix>
```

`migration show` displays a single migration package. To see the ordered list of migrations that would run — across all contract spaces — use `db migrate --show`:

```bash
# Online: reads the live DB marker as the origin.
pnpm prisma db migrate --show --db $DATABASE_URL

# Offline: hypothetical path from any ref or hash.
pnpm prisma db migrate --show --from <hash-or-ref> --to <hash-or-ref>
```

`db migrate --show` is read-only and never writes to the DB or the migration graph. Use it before applying to confirm the execution order.

Fill in any data transforms (see *Fill a placeholder*), self-emit if you edited `migration.ts`, then:

```bash
pnpm prisma db migrate --db $DATABASE_URL
```

`db migrate` runs without prompting — destructive-op confirmation lives on `db update`, not here. Review destructive ops in the plan output or in `migration show` *before* applying.

## Workflow — Fill a placeholder

The concept: the planner can detect *that* a data transform is needed but not *what* it should do. It writes a typed scaffold and stops; you fill the transform, then self-emit.

### Postgres

The planner can detect *that* a data transform is needed (e.g. backfilling a new `NOT NULL` column with no default) but not *what* it should do. You fill `check` and `run` closures with real query plans built against `endContract`.

The scaffold the planner emits looks like:

```typescript
// migrations/app/20260515T1200_add_user_name/migration.ts
import endContract from '../../snapshots/93f07d1b…c9e1e5a2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, addColumn, placeholder } from '@internal/postgres/migration';

export default class M extends Migration {
  override get operations() {
    return [
      addColumn('public', 'user', {
        name: 'name',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      this.dataTransform(endContract, 'backfill user.name', {
        check: () => placeholder('backfill user.name:check'),
        run:   () => placeholder('backfill user.name:run'),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

Replace both `placeholder(...)` calls with query-plan closures built from `endContract`. The `check` closure must return a **rowset query whose presence of any row signals "work remains"** — conventionally `<table>.select('id').where(<violation predicate>).limit(1)`. Scalar/aggregate shapes (`count(*)`, `bool_and(...)`) silently break the contract: the runner wraps `check` twice (`EXISTS(...)` for precheck, `NOT EXISTS(...)` for postcheck), and a query that always returns one row makes `EXISTS` always true and `NOT EXISTS` always false.

Build the query builder against `endContract` so the storage hashes line up — using a different contract reference raises `PN-MIG-2005`. The filled-in shape (the rendered scaffold above with `placeholder(...)` calls replaced; if you need an extra factory like `setNotNull`, add it to the *existing* `@internal/postgres/migration` import line rather than authoring a second import). See `references/queries.md` for the surrounding `db` setup:

```typescript
import endContract from '../../snapshots/93f07d1b…c9e1e5a2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, addColumn, setNotNull } from '@internal/postgres/migration';
import { db } from './db'; // sql({ context: createExecutionContext({ contract: endContract, ... }) })

export default class M extends Migration {
  override get operations() {
    return [
      addColumn('public', 'user', {
        name: 'name',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      this.dataTransform(endContract, 'backfill user.name', {
        check: () => db.users.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1),
        run:   () => db.users.update({ name: '' }).where((f, fns) => fns.eq(f.name, null)),
      }),
      setNotNull('public', 'user', 'name'),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

Self-emit:

```bash
node migrations/app/20260515T1200_add_user_name/migration.ts
```

Self-emit regenerates `ops.json` and recomputes `migrationHash` in `migration.json`. The next `db migrate` will see a consistent package.

### Mongo

Mongo `dataTransform` operations take `{ check, run }` objects whose `source` / `run` return Mongo query-plan shapes (often `RawAggregateCommand` / `RawUpdateManyCommand` from `@internal/mongo-query-ast/execution`). The planner may leave `placeholder(...)` inside those sources until you fill them. Every rendered `migration.ts` includes `describe()` bookends (`from` / `to` contract hashes) — the Postgres examples above omit them for brevity. Import factories from `@internal/target-mongo/migration`:

```typescript
import { MigrationCLI } from '@internal/cli/migration-cli';
import { Migration } from '@internal/family-mongo/migration';
import { createIndex, dataTransform } from '@internal/target-mongo/migration';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';

class M extends Migration {
  override describe() {
    return { from: '<hex>', to: '<hex>', labels: ['normalize-names'] };
  }

  override get operations() {
    return [
      createIndex('users', [{ field: 'name', direction: 1 }]),
      dataTransform('lowercase-user-name', {
        check: {
          source: () => ({
            collection: 'users',
            command: new RawAggregateCommand('users', [
              { $match: { name: { $regex: '[A-Z]' } } },
              { $limit: 1 },
            ]),
            meta: { target: 'mongo', storageHash: '…', lane: 'mongo-pipeline', paramDescriptors: [] },
          }),
        },
        run: () => ({
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            { name: { $exists: true } },
            [{ $set: { name: { $toLower: '$name' } } }],
          ),
          meta: { target: 'mongo', storageHash: '…', lane: 'mongo-raw', paramDescriptors: [] },
        }),
      }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
```

Self-emit the same way: `node migrations/app/<dir>/migration.ts`.

## Workflow — Author a migration by hand

The concept: the same `Migration` class shape lets you author operations directly when the planner has nothing to plan (a custom data fix, an extension install, a baseline). Even here you don't write the file from scratch — `migration new` renders an empty package for you, and you edit the `operations` getter inside it, then self-emit.

```bash
pnpm prisma migration new --name <snake_slug>
```

Add factory names to the framework-rendered import line for your target (Postgres: `@internal/postgres/migration`; Mongo: `@internal/target-mongo/migration`). Browse with `--help` and the import list the renderer emitted.

**Postgres** factories (representative set):

- Tables: `createTable`, `dropTable`.
- Columns: `addColumn`, `dropColumn`, `alterColumnType`, `setNotNull`, `dropNotNull`, `setDefault`, `dropDefault`.
- Constraints: `addPrimaryKey`, `addForeignKey`, `addUnique`, `dropConstraint`.
- Indexes: `createIndex`, `dropIndex`.
- Enums: `createEnumType`, `addEnumValues`, `renameType`, `dropEnumType`.
- Dependencies: `createSchema`, `createExtension`, `installExtension`.
- Raw escape hatch: `rawSql({ id, label, operationClass, target, precheck, execute, postcheck, ... })`.
- Data transforms: `this.dataTransform(endContract, name, { check, run })` (instance method, not a free factory).

**Mongo** factories (from `@internal/target-mongo/migration`):

- Collections: `createCollection`, `dropCollection`, `validatedCollection`, `setValidation`.
- Indexes: `createIndex`, `dropIndex`.
- Collection options: `collMod`.
- Data transforms: `dataTransform(name, { check, run })` (free factory; `check`/`run` use Mongo query-plan shapes).

Self-emit (`node migrations/app/<dir>/migration.ts`) after each edit.

## Workflow — Inspect the live schema

The concept: `db schema` is read-only and never writes files. It prints the live schema as a tree by default or as JSON with `--json`. Use it during planning and as part of verification.

```bash
pnpm prisma db schema --db $DATABASE_URL
pnpm prisma db schema --db $DATABASE_URL --json > schema.json
```

There is no built-in filter flag — pipe the JSON through `jq` (or your favourite JSON tool) if you only want one table.

## Workflow — Verify contract vs DB (diagnostic)

The concept: `db verify` is a **standalone diagnostic** — not a routine step after `db update` or `db migrate` on the happy path (those commands already verify and advance the marker when they succeed). Reach for `db verify` when you suspect drift or need to prove the DB matches the contract:

- Following manual SQL or ad-hoc edits outside Prisma Next.
- When restoring a database from backup.
- If a `db migrate` fails or partially applies (especially on Mongo, where DDL is resumable rather than transaction-wrapped).
- When `PN-RUN-3002` / `PN-RUN-3001` surfaces at runtime or from another command.

Modes:

- Default — full verification (schema + marker).
- `--marker-only` — skip schema verification, only check the marker.
- `--schema-only` — skip marker verification, only check schema satisfies contract.
- `--strict` adds: schema elements not present in the contract are an error (default is "DB may have extras").

```bash
pnpm prisma db verify --db $DATABASE_URL
```

On mismatch, the error envelope names the failure mode (`PN-RUN-3002` hash mismatch, `PN-RUN-3001` marker missing, target mismatch, schema issues with structured paths).

## Workflow — Re-sign the marker

The concept: `db sign` rewrites the marker to the current contract hash. Use after a manual repair where the DB is the source of truth and the marker is stale. `db sign` performs a schema-verify first and refuses to sign a DB whose schema disagrees with the contract — so a successful sign always means the schema matches and the marker is now correct.

```bash
pnpm prisma db sign --db $DATABASE_URL
```

## Workflow — Recover from drift

The concept: drift means `db verify` reports the live DB schema doesn't match what the marker says it should be. Two valid moves, picked by which side is correct:

- **The contract is right; the DB is wrong** → run a migration. Either `db update` (quick path, dev DB only) or `migration plan` + `db migrate` (everywhere else).
- **The DB is right; the contract or marker is wrong** → edit the contract to match the DB (see `references/contract.md`), emit, then `db sign` to refresh the marker.

The diagnostic that reveals which side is right:

```bash
pnpm prisma db schema --db $DATABASE_URL --json
pnpm prisma db verify --db $DATABASE_URL --json
```

Use `db verify` to confirm which side is wrong, then re-run it after either branch until it returns `ok` with no diagnostics.

## Workflow — Recover from a partially-applied migration

The concept: on **Postgres**, each migration applies inside a transaction — a mid-migration failure rolls back and the marker stays at the previous migration's `to` hash. On **Mongo**, DDL is resumable with verify-gated marker advancement; diagnose with `db verify` / `db schema`, fix the failed package's `migration.ts`, self-emit, and re-run `db migrate`.

Failures that *can* leak partial state include: Postgres `rawSql(...)` steps outside the transaction wrapper, Mongo DDL that partially applied before verify failed, or external side-effects (calls out to other systems from a `run` closure).

Diagnose:

```bash
pnpm prisma db verify --db $DATABASE_URL --json
pnpm prisma db schema --db $DATABASE_URL --json
```

Fix and re-run `db migrate`:

```bash
node migrations/app/<dir>/migration.ts
pnpm prisma db migrate --db $DATABASE_URL
```

If the failure was an out-of-band side-effect that left external systems half-changed, repair those by hand before re-applying.

## Workflow — Recover from `MIGRATION.HASH_MISMATCH`

The concept: `migrationHash` is content-addressed. A mismatch means `migration.json`'s stored hash disagrees with the hash recomputed from `ops.json` (and metadata). The cause is almost always: someone edited `migration.ts` and forgot to self-emit. The remediation is to self-emit the offending package.

```bash
node migrations/app/<dir>/migration.ts
pnpm prisma db migrate --db $DATABASE_URL
```

If self-emit itself fails (e.g. the contract has moved on and the operations no longer make sense against the migration's end contract), the package is stale. Either restore it from version control or delete it and re-plan with `migration plan`.

## Workflow — Resolve a destructive-operation prompt (`db update` only)

The concept: when `db update` would drop columns or tables, it stops and asks before applying. The prompt is `db update`-specific — `db migrate` does *not* prompt and runs whatever the migration package contains, so review the plan or call `migration show` before `db migrate`.

When `db update` reports destructive operations interactively, the warning lists them. The prompt is:

> Apply destructive changes? This cannot be undone.

Routing:

- Answer yes if the data is no longer needed.
- Answer no, then either:
  - Re-shape the migration via `migration plan` and hand-edit `migration.ts` to preserve the data (e.g. copy-to-new-column, then drop), or
  - Skip the destructive operation by reverting the contract change.

In non-interactive contexts (CI, `--no-interactive`, `--json`), the destructive-op response is returned as a structured error — `meta.destructiveOperations[]` lists what would have been dropped. Re-run with `-y` to auto-accept, or address each operation individually.

## Common Pitfalls

1. **Using `db update` against shared or production databases.** Never. The change leaves no migration history. Use `migration plan` + `db migrate`.
2. **Skipping a data transform.** Leaving `placeholder(...)` in `migration.ts` makes the next `db migrate` throw `PN-MIG-2001`. Fill every placeholder slot and self-emit.
3. **Editing `ops.json` directly.** It's the canonical artifact, not the authoring source. Edit `migration.ts`, then self-emit.
4. **Forgetting to self-emit after editing `migration.ts`.** The next `db migrate` either uses the stale `ops.json` (if you only added comments) or fails with `MIGRATION.HASH_MISMATCH` (if you changed operations). Always self-emit.
5. **Routine `db verify` after a successful `db update` or `db migrate`.** Redundant on the happy path — reserve `db verify` for drift diagnosis (manual edits, restore, failed `db migrate`).
6. **Aggregate `check` closure in Postgres `this.dataTransform`.** Returning `count(*)` or `bool_and(...)` breaks the precheck/postcheck contract — both sides resolve to constants. Use a rowset shape: `select('id').where(<violation>).limit(1)`.
7. **Two contract references in one migration.** Building a query plan against a different contract than the one passed to `this.dataTransform(endContract, ...)` raises `PN-MIG-2005`. Always import `endContract` once at module scope and use the same reference.
8. **Renaming and expecting the planner to detect it (Postgres).** Prisma Next has no in-contract rename hint today; the planner emits a destructive drop+add. Hand-edit `migration.ts` to rewrite the destructive op as a `rawSql({ ... })` that issues `ALTER TABLE ... RENAME COLUMN ...` (or use the two-migration keep / backfill / drop pattern), then self-emit. See `references/contract.md` § *Edit a field — rename*.
9. **Hand-authoring `migration.ts` from a blank file, or rewriting the rendered import line.** Migration files are framework-rendered — let `prisma migration plan` (or `migration new`) render the package, then edit only the holes the framework leaves for you. On Postgres leave the rendered `@internal/postgres/migration` (or `@internal/sqlite/migration`) import path alone; on Mongo use `@internal/family-mongo/migration` + `@internal/target-mongo/migration` as rendered. Add symbols to the existing factory import line rather than introducing new import paths.

## What Prisma Next doesn't do yet

- **Runtime-apply migrations.** Prisma Next doesn't apply pending migrations from your app's startup code (the "Drizzle pattern" for serverless / edge). Workaround: run `prisma db migrate` from your deploy pipeline before the app starts. If you need runtime-apply built-in, file a feature request via the `references/feedback.md` skill.
- **Seeds-as-first-class.** Prisma Next doesn't ship a `prisma db seed` equivalent. Workaround: write a TypeScript script that imports your `db` instance and runs your setup queries; invoke it from `package.json`'s scripts. If you need first-class seeding, file a feature request via the `references/feedback.md` skill.
- **Migration squashing.** Prisma Next doesn't squash older migrations into a baseline. They accumulate; for very large histories, manual baseline-and-truncate is the path. If you need built-in squashing, file a feature request via the `references/feedback.md` skill.
- **In-contract rename hints.** The planner cannot detect that a field rename is a rename rather than a drop+add. Workaround: hand-edit `migration.ts` to issue a `RENAME COLUMN` via `rawSql(...)`, or use a keep / backfill / drop pattern across two migrations. If you need a contract-level rename hint, file a feature request via the `references/feedback.md` skill.

## Graph and history commands

After planning or applying, you can inspect the migration graph offline:

- `pnpm prisma migration list` — enumerate all on-disk migrations, rendered as a graph tree. Supports `--legend` (print the glyph key), `--ascii` (pipe-safe glyphs), and `--json`.
- `pnpm prisma migration log --db $DATABASE_URL` — flat chronological table of applied migrations, read from the live DB. Supports `--ascii` and `--json`.

For the full graph topology: `pnpm prisma migration graph` (also supports `--legend`, `--ascii`, `--dot`, `--json`).

## `@@control` and DDL scope

Objects whose `@@control` policy excludes them from Prisma Next's managed surface are omitted from planned DDL. The four policies are: `managed` (Prisma plans and applies DDL), `tolerated` (object may exist, no DDL emitted), `external` (object is expected to exist, no DDL), `observed` (Prisma reads but never writes). Declare `@@control(managed|tolerated|external|observed)` in your schema; see `references/contract.md` and [`packages/2-sql/2-authoring/contract-psl/README.md`](../../packages/2-sql/2-authoring/contract-psl/README.md) for authoring syntax.

## Telemetry

The CLI collects anonymous usage data by default. To opt out, set `PRISMA_NEXT_DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` in your environment. See [`docs/Telemetry.md`](../../docs/Telemetry.md) for the full opt-out reference.

## Checklist

- [ ] Contract emitted (`contract.json` + `contract.d.ts` current).
- [ ] Chose the right path: `db update` (local dev) vs `migration plan` + `db migrate` (anything shared).
- [ ] For `migration plan`: ran `migration show` to review before `db migrate`.
- [ ] Filled every `placeholder(...)` in `migration.ts` (if any), built against `endContract`.
- [ ] `check` closures are rowset queries, not scalar aggregates.
- [ ] Self-emitted (`node migrations/app/<dir>/migration.ts`) after editing the TS.
- [ ] Ran `db migrate` (or `db update`) and saw it complete.
- [ ] Used `db verify` only when diagnosing drift — not as a routine post-apply step.
- [ ] Did NOT use `db update` against a shared or production database.
- [ ] Did NOT edit `ops.json` directly.
- [ ] Did NOT skip a destructive-op prompt without inspecting `meta.destructiveOperations[]`.


# Prisma 8 — Migration Authoring

> **Edit your data contract. Prisma 8 plans the migration. You fill in any data transforms.**

The three-step user model:

1. **You edit your data contract.** (`references/contract.md`)
2. **Prisma 8 plans the migration for you.** ← this skill
3. **If a data transform is needed, you edit `migration.ts` and self-emit.** ← this skill

Once the contract changes, you choose how the change reaches the database. This skill covers the two paths (`db update` and `migration plan` + `db migrate`), the migration-package contract, the `migration.ts` authoring API, and the failure modes you recover from without leaving the loop.

**Targets.** Migration authoring is first-class for **Postgres** and **Mongo**. The CLI reads the target from `prisma.config.ts` (set during `prisma orm init --target …`). Migration commands do not accept a `--target` flag — use a config scoped to the target you need. Examples below call out target-specific imports, markers, factories, and transaction behavior where they diverge.

## When to Use

- User edited the contract and wants to apply the change to the DB.
- User wants to author a migration with a data transform.
- User wants to run pending migrations against a local DB.
- User hit `MIGRATION.HASH_MISMATCH`, `MIGRATION.UNFILLED_PLACEHOLDER`, or a partially-applied migration.
- User mentions: *migrate, migration, db push, db update, `prisma migrate dev`, `prisma migrate deploy`, drift, hash mismatch, data backfill*.
- A deploy or `db migrate` fails with `MIGRATION.MARKER_MISMATCH` (older Composer releases: "no authored path"), or someone proposes resetting a database → *A database whose marker is not in the migration graph* below. For `MIGRATION.PATH_UNREACHABLE`, where the marker is in the graph but no migration reaches the target, plan from the marker to the target instead (`references/debug.md`).

## When Not to Use

- User wants to know what migrations *will run on deploy* / on merge, or to manage refs and invariants → `references/migration-review.md`.
- User is deciding where a plan should chain from, saw `from: (baseline)` unexpectedly, is setting up migrations for a deploy-first (Composer / CD-managed) project, or is retrofitting migrations onto an existing database → `references/migration-model.md`.
- User wants to edit the contract → `references/contract.md`.
- User wants a deeper read of a single structured error envelope → `references/debug.md`.

## Key Concepts

- **`db update` (quick path).** Reads the emitted contract, diffs against the live DB, applies the change. Optional `--dry-run` prints the plan without executing. Before an apply it asks what each operation that would lose data means, answered by `--delete <subject>` or `--rename <subject>:<new name>`, and whether each operation that would change who can read or write a model's data may run, answered by `--allow <Model>` (see *Answer the data-loss questions* below). **Writes no migration directory.** Operations needing data transforms are not handled by this path — `db update` excludes the `data` operation class entirely and short-circuits where a data transform would be required. It refuses `--convert` and `--backfill` (`MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`) and prints the `migration plan` command to run instead. Use it on a database whose migration history does not need to be kept (a local, development, staging or preview database), shared or not. Never use it on a database that changes only through migrations, such as production: it leaves no migration behind.
- **`migration plan` (formal path).** Reads the emitted contract, diffs it against a resolved origin — explicit `--from`, else the `db` ref, else the empty database; there is no "head of the graph" to chain from (see `references/migration-model.md`) — and writes a new migration package under `migrations/app/<YYYYMMDDTHHMM>_<snake_slug>/`. A plan that would lose data is written only once `--delete`, `--rename` or, for a type change, `--convert` says what each such operation means. The package's `migration.ts` contains `placeholder(...)` calls only where `--convert` or `--backfill` asked for a slot (see *Type changes and new required fields*).
- **The `app/` segment in migration paths is the consuming application's contract-space id.** Every migration *you* author lives under `migrations/app/`. Extensions your contract depends on get their own sibling directories (`migrations/<extension-space-id>/`) — those are managed by the extension package and you don't write into them. The `app/` segment lands automatically the first time you run `migration plan` / `db init` against an app-level config.
- **Migration package files** (inside each `migrations/app/<dir>/`):
  - `migration.json` — manifest (metadata + `migrationHash`).
  - `ops.json` — canonical operation list. Content-addressed; `migrationHash` is computed over this.
  - `migration.ts` — TypeScript authoring source, **framework-rendered** by `migration plan` (or `migration new`). You edit specific holes in it (see *Fill a placeholder* below) and re-emit `ops.json` / `migration.json` by running it.
- **Contract snapshots.** `migration.ts` imports its bookend contracts from the shared, content-addressed store at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts` (`<hex>` is the contract's 64-hex storage hash) — not from files inside the migration package.
- **Self-emit.** Running `node <package dir>/migration.ts` regenerates `ops.json` and `migration.json` from the (possibly edited) TS source. This is the only supported way to update an existing migration package after edits. `<package dir>` is the directory `migration plan` or `migration new` printed; it sits under the config's `migrations.dir` (by default `migrations/app/<dir>`), so the path depends on that setting. The command works from any directory. Without `--config`, the file uses the config whose migrations directory holds it: the nearest `prisma.config.ts` above it, else the one in the working directory; if neither does, it fails with `CLI.MIGRATION_CONFIG_NOT_FOUND`. If you gave the CLI `--config`, pass the same `--config <path>` to the file.
- **`migration.ts` shape.** Framework-rendered. A class `M extends Migration<Start, End>` (from `@internal/postgres/migration` on Postgres, `@prisma/orm-mongo/target/migration` on Mongo — see the framing block below) that assigns the two snapshot imports to `startContractJson` / `endContractJson` (`Start` is `never` and there is no `startContractJson` on a baseline) and has an `operations` getter returning an array of operation values. **On Postgres the operation factories are methods on the base class** (`this.addColumn({...})`, `this.setNotNull({...})`, `this.dataTransform(...)`) taking one options object; free helpers like `col(...)` build the column descriptors they take. **On Mongo they are free factories** (`createIndex(...)`, `dataTransform(...)`) imported beside `Migration`. The file ends with `MigrationCLI.run(import.meta.url, M)` so executing it self-emits.
- **`placeholder(slot)`.** A sentinel the planner emits into the rendered `migration.ts` (from the same `.../migration` import as `Migration`) wherever a data transform is needed. Calling `placeholder(...)` at emit time throws `MIGRATION.UNFILLED_PLACEHOLDER` with `meta.slot` naming the hole. The user replaces the `() => placeholder(...)` arrow with a real query-plan closure (Postgres) or fills `dataTransform({ check, run })` sources (Mongo — see *Fill a placeholder*), then self-emits.
- **`this.dataTransform(endContract, name, { check, run })`.** The data-transform factory. `check` is a rowset query whose presence-of-any-row signals "work remains"; `run` is one or more mutation queries that perform the backfill. Both are lazy closures returning query-plans built against `endContract`. The runner wraps `check` as `EXISTS(...)` for precheck and `NOT EXISTS(...)` for postcheck, so the same closure asserts both "there is work" and "the work is done".
- **`pendingPlaceholders`.** A boolean field on the JSON result of `migration plan`. `true` means the package was written but contains unfilled placeholders — `db migrate` will throw `MIGRATION.UNFILLED_PLACEHOLDER` until you edit `migration.ts` and self-emit.
- **`migrationHash`.** Content-addressed identity of a migration package. `MIGRATION.HASH_MISMATCH` fires when the stored hash in `migration.json` disagrees with the hash recomputed from the on-disk files (almost always: someone edited `migration.ts` without self-emitting).
- **Marker.** Records "this database is at contract hash X for space Y". **Postgres:** a row in `prisma_contract.marker`. **Mongo:** a document in the `_prisma_migrations` collection (keyed by space). Each successful migration advances the marker once schema verification passes for that space. `db sign` writes the marker from the current contract hash, but only after a schema-verification pass succeeds (it will not sign a database whose live schema disagrees with the contract).
- **Apply atomicity.** **Postgres:** one `db migrate` run is one transaction — the runner issues a single `BEGIN`, applies every pending migration for every contract space, then one `COMMIT`; any failure issues `ROLLBACK` for the whole run, so the marker stays where it was before the command. **Mongo:** DDL ops (`createCollection`, `createIndex`, `collMod`, `setValidation`, …) are not wrapped in a multi-document transaction; the runner applies ops, verifies the live schema against the destination contract, and advances the marker only on verify-pass (resumable across spaces — see the MongoDB family doc). Ordinary DDL + `dataTransform` flows stay consistent; partial state from failed mid-migration runs is diagnosed with `db verify` / `db schema`, not assumed away.
- **Changed foreign key actions and primary keys (Postgres).** A changed `onDelete`/`onUpdate` plans a drop and an add of the foreign key. A moved or removed primary key plans a drop (and an add), and the foreign keys that reference the old key are dropped first and added back after it. These ask no data-loss question.
- **Operation classes.** Every operation declares an `operationClass`: `additive`, `widening`, `data`, or `destructive`. The CLI surfaces these in the plan preview and in JSON output. There is no `long-running` class and the framework does not emit `CREATE INDEX CONCURRENTLY` — operations stay transactional.

## `migration.ts` is framework-rendered, not hand-authored

Files under `migrations/<space-id>/<timestamp>/migration.ts` (for your own app, `<space-id>` is always `app/`) are **rendered for you** by the framework — `prisma migration plan` writes a populated package whenever the contract changes, and `prisma migration new` writes an empty scaffold when you want to author operations directly. You do not write these files from scratch. You edit specific holes the framework leaves behind — chiefly replacing `placeholder("<slot>")` sentinels (Postgres) or filling `dataTransform({ check, run })` pipeline slots (Mongo) — then self-emit.

**Postgres** rendered imports point at `@internal/postgres/migration` (or `@internal/sqlite/migration` for SQLite projects): one line carrying `Migration`, `MigrationCLI`, `col`, `placeholder`, `rawSql`, `sql` when the file writes a `sql` value, and any other free helper the operations need.

**Mongo** rendered imports point at one module too, `@prisma/orm-mongo/target/migration`, which carries `Migration`, `MigrationCLI`, `placeholder`, and the operation factories (`createIndex`, `dataTransform`, …). Raw command classes for data transforms come from `@prisma/orm-mongo/query-ast/execution`.

Treat the rendered import lines as framework-managed on both targets:

- Leave them where they are. Don't rewrite them to a different path; the framework's renderer is the authoritative shape and any change you make by hand will be reverted (and may trip `MIGRATION.HASH_MISMATCH`) the next time the package is re-rendered or self-emitted.
- If you need an additional helper symbol, **add it to the existing rendered import line** rather than introducing a second import from a different subpath.
- The "user code imports only from `@internal/<target>`" convention applies to *your* own modules (queries, runtime setup, contract authoring). The framework-rendered `migration.ts` scaffold is the framework's surface, not yours; the rule is suspended for that one file.

## Diagnostic codes you route on

| Code | Source | Move |
|---|---|---|
| `MIGRATION.UNFILLED_PLACEHOLDER` | Throwing `placeholder(...)` at emit time | Open `migration.ts`, replace the `placeholder("<slot>")` call named by `meta.slot` with the real query closure, self-emit. |
| `MIGRATION.FILE_MISSING` | Reading a migration package | `migration.ts`, `migration.json`, or `ops.json` is absent. Recover from version control, re-emit via `migration.ts`, or run `prisma migration new` for a fresh one. |
| `MIGRATION.INVALID_DEFAULT_EXPORT` | Loading `migration.ts` | The file's default export is not a `Migration` subclass or factory function. Restore the planner-emitted scaffold from version control or re-run `migration plan` for a clean package. |
| `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH` | Building a data-transform query plan | The query builder was instantiated with a contract reference different from the `endContract` passed to `this.dataTransform(...)`. Use the `endContract` imported at module scope for both. |
| `MIGRATION.HASH_MISMATCH` *Migration package is corrupt* | `db migrate` (or any read of the package) | `ops.json` / `migration.json` were edited without self-emitting. Run `node <package dir>/migration.ts` to re-emit, then re-run `db migrate`. |
| `CLI.CONSENT_REQUIRED` | `migration plan` / `db update` run with nobody to answer (`--no-interactive`, CI, `--yes`) | The plan would lose data or (on `db update`) widen access. `meta.unanswered` and `nextActions` list each question with the flags that answer it: `--delete <subject>`, `--rename <subject>:<new name>`, `--allow <Model>`. Re-run with the ones you mean. `--confirm` and `--yes` answer none of them. |
| `CLI.CONSENT_UNUSED` | `migration plan` / `db update` | Every question was answered, and a `--delete` or `--allow` was left over: a typo, a subject the plan does not touch, or a `--confirm` (which consents to nothing). Fix or drop the flag. A typo next to a question nobody answered is reported as `CLI.CONSENT_REQUIRED` instead, which names the flag that matched nothing. On `db update --dry-run` the same mistake is `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. |
| `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS` | A rename typed at the data-loss prompt | The plan was made again with the rename and still loses the subject's data. Answer with `delete`, or give a rename whose old name is the subject. |
| `CONTRACT.MARKER_MISMATCH` | `db verify` (finding, exit 4) | The marker disagrees with the contract hash (**Postgres:** `prisma_contract.marker`; **Mongo:** `_prisma_migrations`). The DB is at a different contract version than the code thinks. Either run a migration forward, or — if the DB is correct and the marker is stale after a manual fix-up — run `db sign`. |
| `CONTRACT.MARKER_MISSING` | `db verify` (finding, exit 4), runtime startup (warning) | The DB has no marker yet. Run `prisma db init --db <url>` to baseline an empty database, `db update --db <url>` to apply the current contract directly, or `db sign --db <url>` if the schema already matches the contract. |
| `MIGRATION.STATEMENT_INVALID` | `migration plan` / `db update` with `--rename` | The statement is malformed, mixes a model and a field, renames something to itself, swaps two names, or repeats a name. The error's next step is the statement to type instead; use it. |
| `MIGRATION.STATEMENT_UNRESOLVED` | `migration plan` / `db update` with `--rename` | A name is not where a rename needs it. The error lists the names it found and says what to type: the statement the right way round, the order that works, or to leave out a rename that has already happened. |
| `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` | `db update --rename` | `db update` has no snapshot of the contract the database is at. Follow the error's steps: emit that contract, run `db update --advance-ref <name> --dry-run` and check it plans no operations, then run it without `--dry-run` to store its snapshot, then emit the new contract and run the rename. Do not drop the statements to get past it: without them the plan drops the renamed table with its rows. |

## Decision — which path do you take?

| Situation | Path | Why |
|---|---|---|
| Moving a database whose history does not need to be kept (local, development, staging, preview) to the contract | `db update` | Fast, no migration files. Works whether or not the database is shared. |
| A change other developers or environments will receive | `migration plan` + `db migrate` | Replayable, reviewable, content-hashed. |
| A database that changes only through migrations, such as production | `migration plan` + `db migrate` | It must run a reviewed, hashed migration. |
| A deploy says there is no migration path, or `MIGRATION.MARKER_MISMATCH` | See *A database whose marker is not in the migration graph* | Never reset the database. |
| Adding a column that needs a backfill | `migration plan --backfill Model.field` (writes `placeholder`), edit `migration.ts`, self-emit, then `db migrate` | `db update` does not author data transforms; the formal path does. Without `--backfill`, existing rows get a temporary value. |
| Changing a field's type so values may not survive | `migration plan --convert Model.field`, fill `using`, self-emit, `db migrate` | Or `--delete Model.field` to let the database cast; the cast may cut or round values (Postgres cuts a longer text to a shorter `VarChar`), and a value it cannot cast fails the apply. |
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

**What `db init` / `db update` / `db sign` write.** When run against the project's default `--db` URL (no explicit `--db` flag), `db init` and `db update` implicitly advance the `db` ref: they write-if-absent the post-command contract IR into the snapshot store, then write the ref's pointer. Override the ref name with `--advance-ref <name>`. When you pass `--db <non-default-url>`, ref advancement is suppressed unless `--advance-ref` is explicit — reconciling a different database is not the same as checkpointing this project's dev state. `db sign` also advances the `db` ref after a successful signature, writing the signed contract into the snapshot store first; `--advance-ref <name>` overrides the name, and `--db` does **not** suppress it — sign never mutates the schema, and adoption is normally done against the real database via `--db`. The only opt-out is `--no-advance-ref`, which signs without writing any ref or snapshot — what a CI or deployment pipeline, or a dev checkout re-signing a production database, usually wants.

The on-disk layout is just the pointer:

```text
migrations/app/refs/
└── db.json                 # { "hash": "<hex>", "invariants": [] }
```

**First `migration plan` after dev iteration.** `migration plan` defaults `--from` to the `db` ref (and, when no `db` ref exists at all, falls back to planning from an empty database only while the migration graph is empty — the human output then adds a muted notice beneath the summary, `No db ref set — planning from an empty database. Run db init, db update, or db sign if a database already exists.`, and the JSON document carries `fromDefaulted: true`; over a non-empty graph there is no fallback: the command refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`; see `references/migration-model.md` § *The trap*). When the on-disk migration graph is still **empty** and the `db` ref points at a non-null hash with a store entry (typical after one or more `db update` cycles), the planner emits **two** bundles instead of one:

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

**When to switch paths.** Use `db update` while the schema is in flux, on a database whose migration history does not need to be kept (a local, development, staging or preview database). Switch to `migration plan` + `db migrate` when the change needs a reviewable, replayable migration — typically before opening a PR, and always for a database that changes only through migrations, such as production. The `db` ref bridges the two: it captures dev iteration state on disk so the first formal plan knows where you left off.

**Graph-node rule (plan time).** Any hash used as a `from` end — explicit `--from`, default `db` ref, or ref name — must already be a node in the on-disk migration graph once the graph is non-empty. The auto-baseline two-bundle emission is the one exception: it applies only on an **empty** graph with a non-null ref-resolved `from` and an available store entry. If the ref's pointer is missing and the hash isn't a graph node either, plan refuses with `MIGRATION.SNAPSHOT_MISSING` instead.

**Apply-time complement.** `db migrate` reads the live marker before DDL. If the marker hash is not a graph node, the command refuses with `MIGRATION.MARKER_MISMATCH` — catching drift the offline planner cannot see. This is separate from `MIGRATION.MARKER_NOT_IN_HISTORY`, which fires later during the runner's graph walk when the marker is off the path being traversed. See `references/migration-review.md` for the full diagnostic catalog.

`db` is a **default ref name**, not a reserved one. The framework overwrites it on the next dev cycle; you may `migration ref set db <hash>` explicitly and accept that a subsequent `db update` replaces it when run against the default URL.

Canonical detail: [Migration System § Contract resolution through the snapshot store](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md#contract-resolution-through-the-snapshot-store), [§ `migration plan`](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md#migration-plan), [§ Recovery affordances](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md#recovery-affordances), [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) (TML-2629, its paired-snapshot part superseded — see the ADR's Status note), and [ADR 240 — Contract snapshots live in a content-addressed store](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20240%20-%20Contract%20snapshots%20live%20in%20a%20content-addressed%20store.md).

## Workflow — `db update` (quick path)

The concept: `db update` resolves the destination (`emitted contract`) against the live DB and applies the difference. Preview with `--dry-run`, which asks nothing and lists the questions an apply would ask under `dataLoss` and `accessChanges`. An apply that would lose data or change access asks first (see *Answer the data-loss questions*). The path excludes operations of the `data` class entirely — if the diff requires a data transform, `db update` fails with a planning error and you switch to `migration plan` to author the transform.

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

The JSON contains `plan.operations[]` with each `operationClass`, plus (in apply mode) `execution.operationsExecuted` and the post-apply `marker.storageHash`. If the command was refused because nobody answered its questions, the error is `CLI.CONSENT_REQUIRED`, and its `meta.unanswered[]` lists each subject with the flags that answer it.

## Workflow — `migration plan` + `db migrate` (formal path)

The concept: `migration plan` writes a new migration package on disk. If the planner needed any data transforms, the package is *pending* — `migration.ts` holds `placeholder(...)` calls until you fill them in. `db migrate` runs every pending package in graph order — on Postgres inside one transaction for the whole run; on Mongo op by op with verify-gated marker advancement (see *Apply atomicity* above).

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

Inspect the package (the `<target>` positional is required — a directory name, hash or hash prefix, ref, or path):

```bash
pnpm prisma migration show <dirName-or-migrationHash-prefix>
pnpm prisma migration show migrations/app/20260515T1200_add_user_email
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

`db migrate` runs without prompting: the data-loss questions were answered when `migration plan` wrote the package. Review destructive ops in the plan output or in `migration show` *before* applying.

## Workflow — Fill a placeholder

The concept: the planner can detect *that* a data transform is needed but not *what* it should do. It writes a typed scaffold and stops; you fill the transform, then self-emit.

### Postgres

`--backfill` asks the planner for a data transform it cannot write itself, for example to fill a new required column `name` on a table with rows: `pnpm prisma migration plan --name add_user_name --backfill User.name`. Without the flag the rows get a temporary value instead. Each slot is named by the field and the part to fill, `User.name:check` and `User.name:run`. You fill `check` and `run` closures with real query plans built against `endContract`.

The scaffold the planner emits looks like:

```typescript
// migrations/app/20260515T1200_add_user_name/migration.ts
import { col, Migration, MigrationCLI, placeholder } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/93f07d1b…c9e1e5a2/contract';
import endContract from '../../snapshots/93f07d1b…c9e1e5a2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f62a4154…d07dddc/contract';
import startContract from '../../snapshots/f62a4154…d07dddc/contract.json' with { type: 'json' };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-user-name', {
        backfillsColumn: { schema: 'public', table: 'user', column: 'name' },
        check: () => placeholder('User.name:check'),
        run: () => placeholder('User.name:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'user', column: 'name' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

(`examples/prisma-8-demo/migrations/app/20260810T1108_add_post_engagement_counters/migration.ts` is a committed rendered package to compare against.)

Replace both `placeholder(...)` calls with query-plan closures built from `endContract`. The `check` closure must return a **rowset query whose presence of any row signals "work remains"** — conventionally `<table>.select('id').where(<violation predicate>).limit(1)`. Scalar/aggregate shapes (`count(*)`, `bool_and(...)`) silently break the contract: the runner wraps `check` twice (`EXISTS(...)` for precheck, `NOT EXISTS(...)` for postcheck), and a query that always returns one row makes `EXISTS` always true and `NOT EXISTS` always false.

Build the query builder against `endContract` so the storage hashes line up — using a different contract reference raises `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH`. The cheapest way to get a typed SQL builder over the end contract is the façade itself: `postgres({ contract: contractFromJson<End>(endContract) })` connects lazily, so constructing it inside `migration.ts` opens no connection; its `sql` is the builder and its `contract` is the validated contract to hand to `this.dataTransform`. The filled-in shape is the rendered scaffold above with only the two `placeholder(...)` arrows replaced (the operation list, including the `this.setNotNull({...})` the planner rendered after the transform, stays as rendered):

```typescript
import { col, Migration, MigrationCLI } from '@internal/postgres/migration';
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import type { Contract as End } from '../../snapshots/93f07d1b…c9e1e5a2/contract';
import endContract from '../../snapshots/93f07d1b…c9e1e5a2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f62a4154…d07dddc/contract';
import startContract from '../../snapshots/f62a4154…d07dddc/contract.json' with { type: 'json' };

const { sql: db, contract } = postgres({ contract: contractFromJson<End>(endContract) });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(contract, 'backfill-user-name', {
        backfillsColumn: { schema: 'public', table: 'user', column: 'name' },
        check: () => db.public.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1),
        run: () => db.public.user.update({ name: '' }).where((f, fns) => fns.eq(f.name, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'user', column: 'name' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

`backfillsColumn` names the column the transform fills. Keep it: when `check` still finds rows after `run`, the apply fails, changes nothing, and counts the rows that still hold NULL, as on SQLite: `1 row of "user" still holds NULL in "name" after its backfill step, so it cannot become required.` The advice then says to make `run` fill every row in that `migration.ts` and re-run `db migrate`. Without `backfillsColumn` the same failure reports only that the postcheck failed.

`run` takes one closure, or an array of closures, each returning one query: `run: [() => db.public.user.update(…), () => db.public.post.update(…)]`. It does not take one closure that returns an array.

Self-emit:

```bash
node migrations/app/20260515T1200_add_user_name/migration.ts
```

### SQLite

On SQLite, `--backfill User.name` writes a `dataTransform` with one slot, `User.name:run`, and no `check`; the table rebuild after it makes the column required, and fails, changing nothing, if a row still has no value. `run` is a closure that returns the SQL text of one statement:

```typescript
dataTransform({
  id: 'data_migration.backfill-User-name',
  label: 'Backfill NULLs in "User"."name" before NOT NULL tightening',
  table: 'User',
  description: 'Backfill NULL name values in User',
  run: () => `UPDATE "User" SET name = 'user ' || id WHERE name IS NULL`,
}),
```

Write the statement so it fills every row the field has no value in, then self-emit with `node <package dir>/migration.ts` as on Postgres.

Self-emit regenerates `ops.json` and recomputes `migrationHash` in `migration.json`. The next `db migrate` will see a consistent package.

### Mongo

Mongo `dataTransform` operations are free factories taking `{ check, run }` objects whose `source` / `run` return Mongo query-plan shapes (often `RawAggregateCommand` / `RawUpdateManyCommand` from `@prisma/orm-mongo/query-ast/execution`). The planner may leave `placeholder(...)` inside those sources until you fill them. A rendered package binds its bookends through `startContractJson` / `endContractJson` exactly as on Postgres; a hand-authored `migration new` package may instead override `describe()` with the `from` / `to` hashes from its `migration.json`, as below. Everything comes from one import:

```typescript
import { createIndex, dataTransform, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import { RawAggregateCommand, RawUpdateManyCommand } from '@prisma/orm-mongo/query-ast/execution';

class M extends Migration {
  override describe() {
    return { from: '<hex>', to: '<hex>' };
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

Self-emit the same way: `node <package dir>/migration.ts`.

## Type changes and new required fields

Postgres and SQLite. `migration plan` cannot see rows, so these rules are about what you state, not what the table holds.

- **A type change that can lose values is a question.** Answer it with `--convert User.age` (the plan has a slot for the conversion: `using: placeholder('User.age:convert')` in `this.alterColumnType(...)` on Postgres, the column's copy expression in `this.recreateTable(...)` on SQLite; write SQL over the column, such as `'"age"::integer'`, self-emit, `db migrate`) or `--delete User.age` (the database's own cast runs; it is listed as `accept lossy type change of field "User.age"`). The cast may cut or round values: on Postgres a longer text is cut to a shorter `VarChar` and a number rounded to fewer digits. A value the cast cannot convert fails the apply, changes nothing, and the error names `--convert`. On SQLite the rebuild checks after its copy that every value took the new type: each column listed in `retypedColumns` is checked, as the conversion when it has a copy expression in `copyExpressions` and as SQLite's own cast when it has none, and a column with a copy expression that is not listed is checked as a conversion too. A hand-written rebuild that converts needs only its copy expression. A widening such as `int4` to `int8` asks nothing.
- **A new required field** gets a temporary value in the existing rows (`''`, `0`, `false`, …) with no question and no placeholder; the output names the field and the value. On SQLite the rebuild writes it in `temporaryValues: { name: sql`''` }`, apart from the conversions in `copyExpressions`. `--backfill User.name` writes a data transform to fill instead: add nullable, fill (`check` and `run` slots on Postgres, `run` on SQLite), then make it required. A new unique, primary-key or foreign-key field, or one whose values come from a value set, gets no temporary value: on a table with rows, use `--backfill`.
- **An optional field made required** is tightened directly. If rows hold NULL, the apply fails and counts them (`3 rows of "Item" hold NULL in "note", so it cannot become required.`); set the values and re-run, or plan with `--backfill`.
- **Following failure advice under `db migrate`:** the migration is already written, so the error says to copy any code you wrote in its `migration.ts`, delete its directory, and run the printed `migration plan --from <hash> --name <name> …` command, which keeps the migration's name, together with the other statements you planned it with. Paths in the advice are relative to the directory the command ran from, and the commands it prints repeat the `--config` it was given, so each runs as printed from there.

## Workflow — Author a migration by hand

The concept: the same `Migration` class shape lets you author operations directly when the planner has nothing to plan (a custom data fix, an extension install, a baseline). Even here you don't write the file from scratch — `migration new` renders an empty package for you, and you edit the `operations` getter inside it, then self-emit.

```bash
pnpm prisma migration new --name <snake_slug>
```

On Postgres the operations are **methods on the `Migration` base class**, each taking one options object (`this.addColumn({ schema, table, column })`); only helpers such as `col(...)` and `rawSql(...)` are imported, on the rendered `@internal/postgres/migration` line. On Mongo the operations are **free factories** imported from `@prisma/orm-mongo/target/migration`. The authoritative list for either target is the base class / module's declaration file in your `node_modules`.

**Postgres** operations (representative set, all `this.<name>({...})`):

- Tables: `createTable`, `renameTable`, `dropTable`. `renameTable` reads the migration's start and end contracts and returns the table rename plus a rename of every constraint and index named after the old table, so spread it: `...this.renameTable({ table: 'userProfile', to: 'UserProfile' })`.
- Columns: `addColumn` (`column: col(name, nativeType, { codecRef })`), `renameColumn` (also renames the constraints and indexes named after the column, so spread it: `...this.renameColumn({ table: 'User', column: 'email', to: 'emailAddress' })`), `dropColumn`, `alterColumnType({ schema, table, column, type, using? })` (`type` is the new type as a migration writes it, such as `int8` or `varchar(20)`; `using` is a SQL expression over the column that converts each value, and without it the database casts the column; the class is `'data'` with `using` and `'destructive'` without it; pass `operationClass: 'widening'` only when every value of the old type converts to the new type unchanged, such as `int4` to `int8`; on a column that owns a sequence it also changes the sequence to the new width, and refuses to narrow past the sequence's last value; a column whose `nextval` default uses a sequence it does not own gets only the type change; with `using`, it refuses with `MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE` when the start contract already gives the column that type, since the runner would skip the conversion: write a `this.dataTransform` instead), `setNotNull`, `dropNotNull`, `setDefault` (`column: col(name, nativeType, { default: lit(value) or fn(…), codecRef })`, where `fn` takes a SQL expression; `fn`, `checkExpression` and the methods that take a SQL fragment accept a ``sql`...` `` value, which generated files write, or a string; a `sql` value's text is canonicalized like a contract's, a string is kept exactly as written, so do not wrap a committed string in `sql`; `fn('autoincrement()')` on a smallint, integer or bigint column reuses any sequence the column already owns (found with `pg_get_serial_sequence`), creates `{table}_{column}_seq` only when it owns none, attaches it, and starts it past the column's largest value; `setDefault` takes no `operationClass`: the class comes from the migration's start contract after earlier renames, `widening` when the column had a default and `additive` otherwise; a literal or function default has no postcheck, so it always runs and the final schema check compares the value), `dropDefault`.
- Constraints: `addPrimaryKey`, `addForeignKey`, `addUnique`, `addCheckConstraint`, `renameConstraint` (`kind`: `primaryKey`, `unique`, `foreignKey` or `checkConstraint`), `renameCheckConstraint`, `dropCheckConstraint`, `dropConstraint`.
- Indexes: `createIndex`, `renameIndex`, `dropIndex`.
- Enums: `createNativeEnumType`, `addNativeEnumValue`, `dropNativeEnumType`.
- Row-level security: `enableRowLevelSecurity`, `disableRowLevelSecurity`, `createRlsPolicy`, `renameRlsPolicy`, `dropRlsPolicy`.
- Dependencies: `createSchema`, `installExtension`.
- Free helpers on the import line: `col`, `primaryKey`, `unique`, `foreignKey`, `checkExpression`, `lit`, `fn` (column and constraint descriptors), `createExtension`, and the raw escape hatch `rawSql({ id, label, operationClass, target, precheck, execute, postcheck, ... })`. The runner runs an operation's postchecks first and skips the operation when they all hold, so a `rawSql` postcheck must hold only when the operation's full effect is in place. If you cannot check that, leave `postcheck` empty: the operation then always runs.
- Data transforms: `this.dataTransform(endContract, name, { check, run })`.

**Mongo** factories (from `@prisma/orm-mongo/target/migration`):

- Collections: `createCollection`, `dropCollection`, `renameCollection(from, to)` (keeps the documents, indexes and validator), `validatedCollection`, `setValidation`.
- Indexes: `createIndex`, `dropIndex`.
- Document rewrites: `renameField(collection, from, to, { filter? })` and `unsetField(collection, field, { filter? })`, each one `updateMany` that skips validation; `filter` limits them to one variant's documents, such as `{ filter: { type: 'bug' } }`.
- Collection options: `collMod`.
- Data transforms: `dataTransform(name, { check, run })` (free factory; `check`/`run` use Mongo query-plan shapes).

Self-emit (`node <package dir>/migration.ts`) after each edit.

## Workflow — Inspect the live schema

The concept: `db schema` is read-only and never writes files. It prints the live schema as a tree by default or as JSON with `--json`. Use it during planning and as part of verification.

```bash
pnpm prisma db schema --db $DATABASE_URL
pnpm prisma db schema --db $DATABASE_URL --json > schema.json
```

There is no built-in filter flag — pipe the JSON through `jq` (or your favourite JSON tool) if you only want one table.

## Workflow — Verify contract vs DB (diagnostic)

The concept: `db verify` is a **standalone diagnostic** — not a routine step after `db update` or `db migrate` on the happy path (those commands already verify and advance the marker when they succeed). Reach for `db verify` when you suspect drift or need to prove the DB matches the contract:

- Following manual SQL or ad-hoc edits outside Prisma 8.
- When restoring a database from backup.
- If a `db migrate` fails or partially applies (especially on Mongo, where DDL is resumable rather than transaction-wrapped).
- When `CONTRACT.MARKER_MISMATCH` / `CONTRACT.MARKER_MISSING` surfaces at runtime or from another command.

Modes:

- Default — full verification (schema + marker).
- `--marker-only` — skip schema verification, only check the marker.
- `--schema-only` — skip marker verification, only check schema satisfies contract.
- `--strict` adds: schema elements not present in the contract are an error (default is "DB may have extras").

```bash
pnpm prisma db verify --db $DATABASE_URL
```

`db verify` exits `0` when everything matches, `4` when it ran and found something, and `2` only when it could not run. Findings ride the completed envelope as `error` diagnostics: `CONTRACT.MARKER_MISMATCH`, `CONTRACT.MARKER_MISSING`, `CONTRACT.TARGET_MISMATCH`, `CONTRACT.SCHEMA_VERIFICATION_FAILED` (with `meta.schemaIssues` listing the schema diff issues).

## Workflow — Re-sign the marker

The concept: `db sign` rewrites the marker to the current contract hash and moves the `db` ref to it (`--advance-ref <name>` overrides the ref name; `--db` does not suppress the ref write; `--no-advance-ref` skips it). Use after a manual repair where the DB is the source of truth and the marker is stale. `db sign` performs a schema-verify first and refuses to sign a DB whose schema disagrees with the contract — so a successful sign always means the schema matches and the marker is now correct.

```bash
pnpm prisma db sign --db $DATABASE_URL
```

## Workflow — A database whose marker is not in the migration graph

**The symptom.** `db migrate` or a deploy fails with `MIGRATION.MARKER_MISMATCH`: the database's marker names a contract that no migration in `migrations/` starts or ends at. (Composer releases older than this skill print it as `MIGRATION_PATH_NOT_FOUND`, "no authored path from the database's current schema".)

**The usual cause.** The database applied a migration that was later planned again or deleted. The common case is a branch deployed to a shared environment, then rebased: each new plan of its migration has a new target hash, and the version the database applied is gone. The error's `why` names the last contract in the graph the database applied (`meta.lastGraphHash`) and the applied migrations that are no longer on disk (`meta.missingMigrations`).

**Never reset or drop the database.** It can always be moved. Pick the recovery by what kind of database it is.

When the error names an extension's contract space (`meta.spaceId` is not `app`), that space's migrations come with the extension package: install a version of the extension whose migrations include the database's contract (`prisma migration list --space <space>` lists them), or ask its maintainers. The recoveries below are for the application space.

### When the database's history does not need to be kept (local, development, staging, preview)

Reconcile it to the target with `db update`:

1. `prisma db update --db $DATABASE_URL --to <target> --dry-run`, and read every operation, above all every drop.
2. `db update` does not run data transforms or seed steps. When the error has no `meta.lastGraphHash`, the ledger cannot say which migrations it would skip: stop and ask a person. Otherwise read the data transforms of the migrations on disk between `meta.lastGraphHash` and the target (`prisma migration list`, then each one's `migration.ts`). The migrations in `meta.missingMigrations` already ran on this database, so never repeat them; read them, in ledger order (`prisma migration log`) from the git commits that held them, only to learn what the database already holds, since a migration on disk may be a new plan of one of them. If a missing migration's source cannot be recovered, stop and ask a person. For each on-disk transform whose data matters and whose work the database does not already hold:
   - if it moves data into a new column or table, create that column or table by hand and copy the data with SQL, the way the transform would;
   - if it inserts rows the application needs, insert them by hand.

   Run the dry run again to confirm the drops that remain lose nothing you need.
3. `prisma db update --db $DATABASE_URL --to <target>`, answering the data-loss questions with `--delete` or `--rename` (see *Answer the data-loss questions*).
4. Deploy again. The deploy finds the database at its target.

### When the database changes only through migrations (production)

Author migrations that bring it back onto the graph, and deploy them. The marker's contract is `<marker hash>`; the last graph contract is `meta.lastGraphHash`. When the error has no `lastGraphHash`, the ledger shows no contract the database applied that is still in the graph, or could not be read: check with `prisma migration log`, and if no applied contract is in the graph, stop and ask a person.

`migration plan --to` accepts only contracts already in the graph, so the database's contract goes through the contract source:

1. Commit or copy aside any uncommitted edits to the contract source; step 4 restores it from `HEAD`. Then put the contract the database is at into the contract source. Prefer the contract source as it was when the deleted migration was planned: find the commit with `git log --all --oneline -- migrations/snapshots/<marker hash>` and check out the contract source file from it. If git no longer has it, infer it from the database into a separate file, `prisma contract infer --db $DATABASE_URL --output ./inferred.prisma` (without `--output` it overwrites the contract source), then copy that file over the contract source.
2. `prisma contract emit`, and check that the emitted storage hash is `<marker hash>`. If it is not, stop and ask a person.
3. Plan a migration from the last graph contract to the database's contract: `prisma migration plan --from <lastGraphHash> --name rejoin_<database>`. Nothing will run it against this database; it only puts the database's contract in the graph. A fresh database could still run it, so copy the data transforms of every migration in `meta.missingMigrations` into it, in ledger order (`prisma migration log`), from the git commits that held them, and review them.
4. Restore the contract source (`git checkout HEAD -- <contract source>`; without `HEAD` git restores the version step 1 staged), run `prisma contract emit`, then plan from the database's contract to the target: `prisma migration plan --from <marker hash> --name <slug>`. A plan that loses data needs `--delete` or `--rename` (see *Answer the data-loss questions*). Review it like any migration, and add data transforms for any data the deleted migration's replacement would have moved.
5. Check how a fresh database reaches the target: `prisma migration status --from @empty --to <target>` lists the migrations it would run. Path finding takes the shortest route, so if these two migrations make a shorter route from the last graph contract to the target than the main line, a new database would take it. When they do, ask a person how to proceed.
6. Commit both migrations and deploy.

Do not `db sign` the database to a contract you inferred: that rewrites its marker without a migration.

## Workflow — Recover from drift

The concept: drift means `db verify` reports the live DB schema doesn't match what the marker says it should be. Two valid moves, picked by which side is correct:

- **The contract is right; the DB is wrong** → run a migration. Either `db update`, on a database whose migration history does not need to be kept (a local, development, staging or preview database), or `migration plan` + `db migrate`, which every database accepts and a database that changes only through migrations, such as production requires.
- **The DB is right; the contract or marker is wrong** → edit the contract to match the DB (see `references/contract.md`), emit, then `db sign` to refresh the marker. The sign also moves the `db` ref to the signed hash; when the migration graph is non-empty and that hash is not a graph node, the next default `migration plan` refuses with `MIGRATION.HASH_NOT_IN_GRAPH` (see *The forgot-the-flag pitfall* above for the recovery).

The diagnostic that reveals which side is right:

```bash
pnpm prisma db schema --db $DATABASE_URL --json
pnpm prisma db verify --db $DATABASE_URL --json
```

Use `db verify` to confirm which side is wrong, then re-run it after either branch until it returns `ok` with no diagnostics.

## Workflow — Recover from a partially-applied migration

The concept: on **Postgres**, the whole `db migrate` run is one transaction — a failure anywhere rolls back every migration the run had applied, and the marker stays where it was before the command. On **Mongo**, DDL is resumable with verify-gated marker advancement; diagnose with `db verify` / `db schema`, fix the failed package's `migration.ts`, self-emit, and re-run `db migrate`.

Failures that *can* leak partial state: Mongo DDL that partially applied before verify failed, and external side-effects (calls out to other systems from a `run` closure). On Postgres nothing runs outside the transaction — `rawSql(...)` steps are ordinary steps inside it and roll back with the rest.

Diagnose:

```bash
pnpm prisma db verify --db $DATABASE_URL --json
pnpm prisma db schema --db $DATABASE_URL --json
```

Fix and re-run `db migrate`:

```bash
node <package dir>/migration.ts
pnpm prisma db migrate --db $DATABASE_URL
```

If the failure was an out-of-band side-effect that left external systems half-changed, repair those by hand before re-applying.

## Workflow — Recover from `MIGRATION.HASH_MISMATCH`

The concept: `migrationHash` is content-addressed. A mismatch means `migration.json`'s stored hash disagrees with the hash recomputed from `ops.json` (and metadata). The cause is almost always: someone edited `migration.ts` and forgot to self-emit. The remediation is to self-emit the offending package.

```bash
node <package dir>/migration.ts
pnpm prisma db migrate --db $DATABASE_URL
```

If self-emit itself fails (e.g. the contract has moved on and the operations no longer make sense against the migration's end contract), the package is stale. Either restore it from version control or delete it and re-plan with `migration plan`.

## Workflow — Answer the data-loss questions (`migration plan` and `db update`)

The concept: the planner cannot tell whether a dropped model or field was meant to go, or was renamed. So before `migration plan` writes a package, or `db update` applies, the command asks one question per model, field or storage name an operation would lose data from. `db update` also asks one per model whose rows an operation would open up, such as dropping a row-level-security policy. Each question is answered by a statement:

- `--delete <subject>` lets the data go: `--delete Legacy`, `--delete User.nickname`. A subject no model stores is named by its storage name (`public.audit_log` on Postgres, `audit_log` on SQLite, `profiles.nickname` for a MongoDB field when `db update` has no snapshot of the origin contract) and can only be deleted. On MongoDB, removing a field from a model is asked about, and `--delete` removes it from every document that holds it.
- `--rename <subject>:<new name>` keeps it under a new name: `--rename Profile:User`, or for a field `--rename User.nickname:User.handle` (the new name keeps its model). A field of a renamed model is named through the new name (`--delete User.nickname` after `--rename Profile:User`).
- On Postgres, namespaces are subjects too. `--rename public.Invoice:billing.Invoice` moves a model to another namespace, creating the schema if needed. `--rename billing:finance` renames a namespace; namespace renames run first, whatever order the flags are in. A namespace removed from the contract is asked about one model at a time, and `--delete billing` answers all of them; a table in it that no contract declares is its own question, `--delete billing.audit_log`. `public` and a schema another contract space declares cannot be renamed. When a name is both a namespace and a model, name the model with its namespace (`app.billing:app.finance`).
- On Postgres and SQLite, enum values are subjects too. A member removed from an enum, or one that stores a new value, is asked about as `Status.ARCHIVED`. `--rename Status.ARCHIVED:Status.RETIRED` replaces the stored value in every row and list that holds it; `--delete Status.ARCHIVED` sets it to NULL in optional columns and takes it out of lists. While rows of a required column hold it, the apply fails with `MIGRATION.PRECHECK_FAILED` and changes nothing; follow its next actions (rename to a new member, or keep the rows by hand). A member renamed with its stored value kept changes nothing. A member that keeps its name but stores a new value, including two members that swap values, is asked about with `--delete` only; the question gives the `migration.ts` edits that keep the data, and under `db update` the way to plan them with `migration plan --from <hash>` or to rename the member to a new member and back in two runs. Renames that shift values along (3 to 4 while 4 to 5) work in one run; renames that move values in a cycle are refused and say how to write them by hand.
- `--allow <Model>` (`db update` only) lets an operation that changes who can read or write the model's data run: one flag per operation, so on Postgres a policy drop and disabling row-level security on one model take `--allow User --allow User`.

```bash
pnpm prisma migration plan --name drop_legacy --delete Legacy
pnpm prisma db update --db $DATABASE_URL --rename Profile:User --delete Legacy --allow User
```

In a terminal the command asks each question in turn; type `delete`, `allow`, or `rename <subject>:<new name>`. Where nobody can answer (CI, `--no-interactive`, `--yes`), it fails with `CLI.CONSENT_REQUIRED`; read `meta.unanswered[]` or the `nextActions`, decide what each subject means, and re-run with those flags. `--confirm` and `--yes` answer none of these questions. Don't reach for `--delete` by reflex: if the model or field was renamed, `--rename` keeps its rows.

`db migrate` does *not* ask: whatever the package contains runs, so review the plan or call `migration show` before `db migrate`.

## Common Pitfalls

1. **Using `db update` on a database that changes only through migrations, such as production.** The change leaves no migration history. Use `migration plan` + `db migrate`. A shared development or staging database is fine.
2. **Skipping a data transform.** Leaving `placeholder(...)` in `migration.ts` makes the next `db migrate` throw `MIGRATION.UNFILLED_PLACEHOLDER`. Fill every placeholder slot and self-emit.
3. **Editing `ops.json` directly.** It's the canonical artifact, not the authoring source. Edit `migration.ts`, then self-emit.
4. **Forgetting to self-emit after editing `migration.ts`.** The next `db migrate` either uses the stale `ops.json` (if you only added comments) or fails with `MIGRATION.HASH_MISMATCH` (if you changed operations). Always self-emit.
5. **Routine `db verify` after a successful `db update` or `db migrate`.** Redundant on the happy path — reserve `db verify` for drift diagnosis (manual edits, restore, failed `db migrate`).
6. **Aggregate `check` closure in Postgres `this.dataTransform`.** Returning `count(*)` or `bool_and(...)` breaks the precheck/postcheck contract — both sides resolve to constants. Use a rowset shape: `select('id').where(<violation>).limit(1)`.
7. **Two contract references in one migration.** Building a query plan against a different contract than the one passed to `this.dataTransform(endContract, ...)` raises `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH`. Always import `endContract` once at module scope and use the same reference.
11. **Calling Postgres operations as free functions.** `addColumn('public', 'user', {...})` does not exist as an import; the operations are `this.addColumn({ schema, table, column })` and friends on the `Migration` base class, with `col(...)` building the column. Only `col`, `rawSql`, `placeholder`, `Migration`, and `MigrationCLI` are imported.
8. **Renaming a model or field without a statement.** The planner cannot tell a rename from a drop and a create, so without a statement it plans a destructive drop+add. State the rename on the command line: `migration plan --name <slug> --rename User:Person --rename Person.email:Person.emailAddress`, or the same `--rename` flags on `db update`. A field is named through its model as the new contract names it. The planner then renames the table or column and the constraints and indexes named after it; on MongoDB it renames the collection, and the field in every document that holds it (only in that variant's documents for a variant's field). On MongoDB a field is named by its name in the contract, as on SQL: `id @map("_id")` is `User.id`. A statement that keeps the stored name, such as `--rename User.name:User.title` where both are stored as `display_name`, plans nothing; one that changes it renames the field in the documents. A field whose `@map` changes while its name stays is planned as a removal of its old stored name, as on SQL, so the plan asks about it; no statement states a stored-name-only change, so to keep the values, edit the planned `migration.ts` to call `renameField(...)` instead, or rename the field in the database yourself before `db update`. For a rename statements do not cover, such as a model that keeps its name but changes its `@@map`, hand-edit `migration.ts` with `...this.renameTable(...)` or `...this.renameColumn(...)` (Postgres, SQLite) or `renameCollection(...)` (MongoDB), then self-emit.
9. **Planning with no `db` ref and no `--from` in a project that already has migrations.** The origin falls through to the empty database, which would make the plan a full-create migration; `migration plan` refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN` rather than writing it. Pick the exit that matches your intent — the error lists them, and `references/migration-model.md` § *The trap* explains which to choose.
10. **Hand-authoring `migration.ts` from a blank file, or rewriting the rendered import line.** Migration files are framework-rendered — let `prisma migration plan` (or `migration new`) render the package, then edit only the holes the framework leaves for you. On Postgres leave the rendered `@internal/postgres/migration` (or `@internal/sqlite/migration`) import path alone; on Mongo leave `@prisma/orm-mongo/target/migration` as rendered. Add symbols to the existing import line rather than introducing new import paths.
12. **Replaying migrations onto a database that is already ahead.** `db migrate` on a database with no marker runs every migration, skipping operations already applied. When the database is already past a migration (it has `x int8` where the migration adds `x int4`), the run stops at that migration's precheck with `MIGRATION.PRECHECK_FAILED`. Adopt such a database with `prisma db sign` (after `contract infer` if needed), not by replaying history.
13. **Running Prisma 7 `migrate` commands against Prisma 8.** Each one answers `CLI.COMMAND_MOVED` with its Prisma 8 command: `migrate dev` is `contract emit`, `migration plan --name <name>`, then `db migrate --advance-ref db`; `migrate deploy` is `db migrate`; `migrate reset` has no equivalent, because Prisma 8 has no reset: `db update` brings the database to the contract instead, asking before it loses data, but it keeps existing rows and runs no seed steps or data transforms (a database that changes only through migrations is moved with `db migrate`); `migrate status` is `migration status`; `migrate diff` is `db update --dry-run`, or `migration plan` to write a migration package; `migrate resolve` is `db sign <migration>`, which moves the database marker to that migration after checking its schema, but leaves `migration status` without an applied mark. While Prisma 7 still owns the migrations, run every one of them except `migrate diff`, whose replacement only reads, with Prisma 7's CLI instead.

## What Prisma 8 doesn't do yet

- **Runtime-apply migrations.** Prisma 8 doesn't apply pending migrations from your app's startup code (the "Drizzle pattern" for serverless / edge). Workaround: run `prisma db migrate` from your deploy pipeline before the app starts. If you need runtime-apply built-in, file a feature request via the `references/feedback.md` skill.
- **Seeds-as-first-class.** Prisma 8 doesn't ship a `prisma db seed` equivalent. Workaround: write a TypeScript script that imports your `db` instance and runs your setup queries; invoke it from `package.json`'s scripts. If you need first-class seeding, file a feature request via the `references/feedback.md` skill.
- **Migration squashing.** Prisma 8 doesn't squash older migrations into a baseline. They accumulate; for very large histories, manual baseline-and-truncate is the path. If you need built-in squashing, file a feature request via the `references/feedback.md` skill.
- **Renames beyond models, fields and namespaces.** `--rename` covers models and fields on Postgres, SQLite and MongoDB. On Postgres it also moves a model to another namespace and renames a namespace (not on MongoDB or SQLite). On Postgres and SQLite it also renames enum values. It does not rename value objects (on MongoDB, a field inside a value object), enum values on MongoDB, or native Postgres enum values. On MongoDB it also refuses `_id`, a field whose stored name contains `.` or starts with `$`, and a time-series collection; each refusal (`MIGRATION.PLANNING_FAILED`) says what to do instead. If you need one of these, file a feature request via the `references/feedback.md` skill.

## Graph and history commands

After planning or applying, you can inspect the migration graph offline:

- `pnpm prisma migration list` — enumerate all on-disk migrations, rendered as a graph tree. Supports `--legend` (print the glyph key), `--ascii` (pipe-safe glyphs), and `--json`.
- `pnpm prisma migration log --db $DATABASE_URL` — flat chronological table of applied migrations, read from the live DB. Supports `--ascii` and `--json`.

For the full graph topology: `pnpm prisma migration graph` (also supports `--legend`, `--ascii`, `--dot`, `--json`).

## `@@control` and DDL scope

Objects whose `@@control` policy excludes them from Prisma 8's managed surface are omitted from planned DDL. The four policies are: `managed` (Prisma plans and applies DDL), `tolerated` (object may exist, no DDL emitted), `external` (object is expected to exist, no DDL), `observed` (Prisma reads but never writes). Declare `@@control(managed|tolerated|external|observed)` in your schema; see `references/contract.md` and [`packages/2-sql-family/2-authoring/contract-psl/README.md`](https://github.com/prisma/orm/blob/main/packages/2-sql-family/2-authoring/contract-psl/README.md) for authoring syntax.

## Telemetry

The CLI collects anonymous usage data by default. To opt out, set `PRISMA_DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` in your environment. See [`docs/Telemetry.md`](https://github.com/prisma/orm/blob/main/docs/Telemetry.md) for the full opt-out reference.

## Checklist

- [ ] Contract emitted (`contract.json` + `contract.d.ts` current).
- [ ] Chose the right path: `db update` (a database whose history does not need to be kept) vs `migration plan` + `db migrate` (a change others will receive, or a database that changes only through migrations).
- [ ] For `migration plan`: confirmed the output's `from:` line names the intended origin — not `(baseline)` over an existing graph (`references/migration-model.md`).
- [ ] For `migration plan`: ran `migration show <dir>` to review before `db migrate`.
- [ ] Filled every `placeholder(...)` in `migration.ts` (if any), built against `endContract`.
- [ ] `check` closures are rowset queries, not scalar aggregates.
- [ ] Self-emitted (`node <package dir>/migration.ts`) after editing the TS.
- [ ] Ran `db migrate` (or `db update`) and saw it complete.
- [ ] Used `db verify` only when diagnosing drift — not as a routine post-apply step.
- [ ] Did NOT use `db update` on a database that changes only through migrations, such as production, and did NOT reset or drop any database to fix a migration problem.
- [ ] Did NOT edit `ops.json` directly.
- [ ] Answered each data-loss question deliberately: `--rename` for a rename, `--delete` only for data that may go, `--allow` only for an access change that is meant.

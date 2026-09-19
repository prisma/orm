
# Prisma 8 — Debug

> **Edit your data contract. Prisma handles the rest.**

When a Prisma 8 call fails, the framework returns a **structured envelope**. The agent's job is to read the envelope, route on the `code`, and chain to the right authoring skill for the actual fix. This skill teaches the envelope shapes and the routing — it does not duplicate sibling-skill workflows.

## When to Use

- User pastes an error envelope (CLI failure, runtime exception, `--json` output).
- User says *"my query won't typecheck"*, *"my migration won't apply"*, *"my emit failed"*, *"the runtime crashed"*.
- User mentions a stable code (`CONFIG.*`, `CLI.*`, `CONTRACT.*`, `MIGRATION.*`, `ORM.*`, `RUNTIME.*`, `DRIVER.*`, `LINT.*`, `BUDGET.*`, `PLAN.*`). A `PN-CLI-4001`-style numeric code is from a pre-0.17 release; the crosswalk to the dotted name is in ADR 239 and `docs/reference/error-reference.md`.
- User mentions: *Studio, EXPLAIN, query log, prepared statements, drift, hash mismatch, capability, planner*.

## When Not to Use

- User wants to author a query / model / migration → the matching authoring skill.
- User wants to *prevent* errors (lints, budgets, type-level guards) → `references/runtime.md`.
- User wants the framework changed because the surface itself is the problem (no envelope to route on, capability genuinely missing) → `references/feedback.md`.

## Key Concepts

### Two envelope shapes

Prisma 8 emits **two distinct envelopes** depending on which seam threw. Read which one you have *before* routing.

**1. CLI envelope** — produced by `prisma ...` commands (emit, db init/update/verify/sign/schema, migration plan/apply/show/status, init). Shape (see `CliErrorEnvelope` in `packages/1-framework/1-core/errors/src/control.ts`):

```json
{
  "ok": false,
  "code": "MIGRATION.UNFILLED_PLACEHOLDER",
  "severity": "error",
  "summary": "Unfilled migration placeholder",
  "why": "...",
  "fix": "...",
  "nextActions": [],
  "where": { "path": "...", "line": 42 },
  "meta": { "slot": "..." },
  "docsUrl": "https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.UNFILLED_PLACEHOLDER"
}
```

Every code is a dotted `NAMESPACE.SUBCODE`; the namespace is the prefix (`CONFIG`, `CLI`, `CONTRACT`, `PSL`, `ORM`, `RUNTIME`, `DRIVER`, `MIGRATION`, `PLAN`, `BUDGET`, `LINT`, plus one per extension). The full catalogue, one entry per code with its payload, is `docs/reference/error-reference.md`. Severity is `error | warn | info`, and exit codes carry meaning: `2` is "could not run", `3` is a user abort, and `4` is "ran and found something" — `db verify` / `db sign` exit `4` with their findings as `error` diagnostics on a completed envelope, and `migration status` exits `0` with `warn` diagnostics. Route on **severity + code together**, not on exit code alone.

**2. Runtime envelope** — thrown by the in-process runtime when executing a query (see `RuntimeErrorEnvelope` in `packages/1-framework/1-core/framework-components/src/execution/runtime-error.ts`):

```ts
{ name: 'RuntimeError', code: 'BUDGET.TIME_EXCEEDED', category: 'BUDGET', severity: 'error', message: '...', details: { ... } }
```

`category` is the prefix of `code` (`PLAN`, `CONTRACT`, `LINT`, `BUDGET`, `RUNTIME`, `ORM`, …). `details` holds the structured context (`details` is the runtime envelope's equivalent of the CLI envelope's `meta`). Recognise either shape programmatically with `isStructuredError` and match on `error.code` — never `instanceof`.

**3. SQL driver errors** — surface as `SqlQueryError` / `SqlConnectionError` (see `packages/2-sql/1-core/errors/`). Fields on `SqlQueryError`: `kind: 'sql_query'`, `sqlState` (Postgres SQLSTATE, e.g. `'23505'`), `constraint`, `table`, `column`, `detail`, `cause`. These carry no dotted code — route on `sqlState` and the constraint metadata. SQL driver errors are typically wrapped by middleware before reaching the user, but raw-SQL paths can surface them directly.

### Wrapped errors

`db migrate`, `db init`, and `db update` map an apply failure the runner did not classify into `MIGRATION.RUNNER_FAILED`, passing the failure's own `meta` through unchanged and its detail into `why`. Migration-tools failures that *are* classified (`MIGRATION.HASH_MISMATCH`, `MIGRATION.AMBIGUOUS_TARGET`, `MIGRATION.PATH_UNREACHABLE`, …) arrive under their own code. **When `code` is `MIGRATION.RUNNER_FAILED`, read `why` and `meta`** — that is where the routing-quality information lives (`meta.runnerErrorCode` at the legacy-marker-shape site).

### How to ask for the full envelope

If the user only pasted the human summary, ask for `--json` output (machine envelope) or re-run with `-v` (CLI prints the full structured fields). `--json` and `-v` are global flags on every CLI command.

## Routing — script teardown and closed client

These symptoms are not structured envelopes — route on the message text and chain to `references/runtime.md` § *Running as a script (teardown)*.

| Symptom | Next move |
|---|---|
| `TypeError: db.end is not a function` | The runtime client does not expose `db.end()` — that's the `node-postgres` pool API (`pool.end()`). The right call is `await db.close()`. See `references/runtime.md` § *Running as a script (teardown)*. |
| Script hangs after queries print / process won't exit | On Postgres the façade-owned `pg.Pool` keeps the event loop alive. Call `await db.close()` before the script returns, or `await using db = postgres<Contract>(...)` at the top of a script module (do NOT put `await using` inside a request handler — block-scoped, would close per-request). See `references/runtime.md` § *Running as a script (teardown)*. |
| `Error('Postgres client is closed')` / `Error('SQLite client is closed')` / `Error('Mongo client is closed')` | The client was closed via `db.close()` (terminal state). Remove the early `close()`, reorder so `close()` runs last after all queries, or construct a new `db` if reconnection is intended. See `references/runtime.md` § *Running as a script (teardown)*. |

## Routing — symptom and code → next move

The single source of truth: read the envelope, find the row by `code`, follow the next move. Every code below has an entry in `docs/reference/error-reference.md` (anchored `#<CODE>`); when a code is missing here, read it there.

| Code | Where it surfaces | Next move |
|---|---|---|
| `CONFIG.FILE_NOT_FOUND` | Most `prisma` commands | Run `prisma orm init`, or pass `--config <path>`. |
| `CONFIG.CONTRACT_MISSING` | `contract emit`, `db *` | Add `contract: './src/prisma/contract.prisma'` to the `ormConfig({...})` section of `prisma.config.ts`. See `references/contract.md`. |
| `CONFIG.VERSION_MARKER_MISSING` | Any command loading config | The default export was not built by the current `definePrismaConfig` / `ormConfig` pair (plain object, spread copy, or a Prisma 7 config). Rewrite to the envelope form in `references/contract.md`. |
| `CONFIG.VALIDATION_FAILED` | Any command reading the malformed section | `meta.section` / `meta.field` name the config section. Fix `prisma.config.ts`. |
| `CONTRACT.VALIDATION_FAILED` | `contract emit`, `db *` | Re-run `pnpm prisma contract emit` after fixing the contract source named in `where.path`; `meta.errors` lists the issues. See `references/contract.md`. |
| `CONFIG.DB_CONNECTION_REQUIRED` | `db *`, `db migrate`, `migration status` | Pass `--db <url>` or set `db.connection` in `prisma.config.ts`. |
| `CONFIG.MISSING_EXTENSION_PACKS` | `contract emit` (e.g. contract uses `pgvector.Vector(...)` but config does not list the pgvector descriptor) | Add the descriptors named in `meta.missingExtensionPacks` to `extensions` in `prisma.config.ts`. See `references/contract.md`. |
| `MIGRATION.PLANNING_FAILED` | `db init`, `db update` | Inspect `meta.conflicts`. Recovery is per-conflict — chain to `references/migrations.md`. |
| `CLI.INIT_MISSING_FLAGS` / `CLI.INIT_INVALID_FLAG_VALUE` / `CLI.INIT_REINIT_NEEDS_FORCE` / `CLI.INIT_*` | `prisma orm init` | Re-run with the flags listed in `meta.missingFlags` or `meta.allowed`; a re-init needs `--confirm <directory name>`. `CLI.INIT_INSTALL_FAILED` (exit 4) and `CLI.INIT_EMIT_FAILED` (exit 5) are findings on a completed scaffold — the files are on disk; fix and re-run the named step. |
| `MIGRATION.UNFILLED_PLACEHOLDER` | `node migrations/app/<dir>/migration.ts` (self-emit) or `db migrate` | Edit `migration.ts`, replace the `placeholder("<slot>")` named by `meta.slot` with a real query closure, self-emit. See `references/migrations.md`. |
| `MIGRATION.FILE_MISSING` | Reading a migration package | Restore from version control or scaffold a fresh package with `migration plan` / `migration new`. |
| `MIGRATION.INVALID_DEFAULT_EXPORT` | Loading `migration.ts` | Use `export default class extends Migration<Start, End> { ... }` (or a factory returning `{ operations, targetId, destination }`). See `references/migrations.md`. |
| `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH` | Building a data-transform query plan | Pass the same `endContract` reference to both `this.dataTransform(endContract, …)` and the query-builder context. |
| `MIGRATION.HASH_MISMATCH` | Any read of a migration package (`plan`, `list`, `db migrate`) | `ops.json` / `migration.json` were edited without self-emitting. Run `node migrations/app/<dir>/migration.ts` to re-emit. |
| `CONTRACT.MARKER_MISSING` | `db verify` (`error` diagnostic, exit 4), runtime startup (warning) | DB has no marker yet. Run `prisma db init --db <url>` (baseline empty DB), `db update --db <url>` (apply contract directly), or `db sign --db <url>` if the schema already matches the contract. |
| `CONTRACT.MARKER_MISMATCH` | `db verify` (exit 4), runtime startup (warning) | Marker disagrees with contract hash (`meta.expected` / `meta.actual`). Either migrate forward (`db migrate` / `db update`), or — if the DB is correct after a manual fix-up — `db sign`. See `references/migrations.md`. |
| `CONTRACT.TARGET_MISMATCH` | `db verify`, runtime startup | Contract target ≠ config target; align them (see `meta.expected` / `meta.actual`). |
| `CONTRACT.SCHEMA_VERIFICATION_FAILED` | `db verify`, `db sign` (both exit 4 with the finding) | Live schema does not satisfy the contract; `meta.issues` lists the drifted paths per `meta.space`. Run `db update` to reconcile, or adjust the contract. |
| `MIGRATION.RUNNER_FAILED` | `db migrate`, `db update`, `db init` | Wrapper for an unclassified apply failure; `why` and `meta` carry the detail. Reconcile the reported failure, then re-run. Previously applied migrations are preserved. |
| `MIGRATION.DESTRUCTIVE_CHANGES` | `db update` when run with nobody to ask (`--no-interactive`, CI) | Consent is the database name: interactively you type it; non-interactively pass `--confirm <database>`. `--yes` does **not** grant it. `--dry-run` previews. **Only `db update` has this flow** — `db migrate` does not gate destructive ops on a flag. |
| `MIGRATION.AMBIGUOUS_TARGET` / `MIGRATION.NO_INVARIANT_PATH` / `MIGRATION.UNKNOWN_INVARIANT` | `db migrate` | Concurrent-migration and invariant flows — `references/migration-review.md`. |
| `MIGRATION.PATH_UNREACHABLE` / `MIGRATION.MARKER_MISMATCH` | `db migrate` | Run `db migrate --show --db $URL` to inspect the path, then `migration plan --from <from> --to <target>` or `migration list` to audit the graph — see `references/migration-review.md`. |
| `MIGRATION.PLAN_ORIGIN_UNKNOWN` / `MIGRATION.HASH_NOT_IN_GRAPH` / `MIGRATION.SNAPSHOT_MISSING` | `migration plan` | Origin resolution — `references/migration-model.md` § *The trap* and `references/migrations.md` § *Dev → ship transition*. |
| `MIGRATION.MISSING_INVARIANTS` | `migration status` `warn` diagnostic (exit 0) | The live marker reached the destination hash structurally but doesn't carry all invariants the target ref requires. Run `db migrate --to <name> --db $URL` to take a path that covers the missing invariants. See `references/migration-review.md`. |
| `MIGRATION.MARKER_NOT_IN_HISTORY` / `CONTRACT.UNREADABLE` | `migration status` `warn` diagnostics (exit 0; CI gates parse `--json`) | Read `severity` *and* `code`. Up-to-date / pending / no-marker states are not codes — read `spaces[].currentContract` and `migrations[].status` in the `--json` document. `references/migration-review.md` covers the marker-out-of-history flow. |
| `BUDGET.ROWS_EXCEEDED` / `BUDGET.TIME_EXCEEDED` | Runtime, when the `budgets` middleware is active | Tune `budgets({ maxRows, maxLatencyMs, ... })` or rewrite the query. See `references/runtime.md`. |
| `LINT.SELECT_STAR` / `LINT.NO_LIMIT` / `LINT.DELETE_WITHOUT_WHERE` / `LINT.UPDATE_WITHOUT_WHERE` / `LINT.READ_ONLY_MUTATION` | Runtime, when the `lints` middleware is active | Fix the query (add a `WHERE` / `LIMIT` / explicit columns), or relax the lint config. See `references/runtime.md`. |
| `PLAN.HASH_MISMATCH` | Runtime, executing a precompiled plan | The contract the plan was built against does not match the runtime contract. Re-emit, rebuild, redeploy. |
| `RUNTIME.TEMPORAL_UNAVAILABLE` | Runtime, first read or write touching a Temporal-backed column (`Date`, `Timestamp(p)`, `Timestamptz(p)`, `Time(p)`) or a `temporal.updatedAt()` clock | No global `Temporal`. Node.js 26.8.2 and later ship `globalThis.Temporal`; 26.8.1 and earlier — including every 22 and 24 — do not. Either `import 'temporal-polyfill/full/global'` before the first query, or author the column as `DateString` / `TimestampString(p)` / `TimestamptzString(p)` / `TimeString(p)` to read PostgreSQL's own text. |
| `ORM.RELATION_MUTATION_UNSUPPORTED` | ORM nested `create` / `connect` on an N:M relation whose junction has required payload columns | Write the junction table directly or use the SQL builder (`meta.junction`). |
| `RUNTIME.ABORTED` (`details.phase` = `encode\|decode\|stream\|beforeExecute\|afterExecute\|onRow`) | Runtime, when an `AbortSignal` fires mid-execute | Cancellation, not a bug; surface to the caller. |
| `SqlQueryError` (no dotted code) | Raw-SQL paths surfacing a driver error | Inspect `sqlState` + `constraint` + `table` + `column`. Postgres `23505` = unique violation, `23503` = foreign-key violation, etc. Fix the data or the schema. |
| TypeScript error mentioning a capability (e.g. `returning()` not on the type, `include` of a many-relation off a many-load) | Authoring-time, before any envelope fires | Capability gates are declared in the **contract** (`capabilities` block, namespaced by target/family), not in `prisma.config.ts`. Route to `references/contract.md` for capability declaration and to `references/queries.md` for which method gates on which capability. Re-emit (`pnpm prisma contract emit`) after enabling. |
| TypeScript error mentioning a missing field/method on `db.orm.<ns>.<Model>` or a stale `Contract` shape | Authoring-time | Re-emit (`pnpm prisma contract emit`); confirm `db.ts` instantiates with `postgres<Contract>(...)` (the single type parameter propagates the contract types). See `references/runtime.md` and `references/contract.md`. |

If the envelope's `code` is not in this table, follow the envelope's `fix` field literally — it's the framework's first-party next move. If `fix` is empty or unhelpful, escalate via `references/feedback.md`.

## Common Pitfalls

1. **Reading only `summary`, not the rest of the envelope.** `code`, `severity`, `why`, `fix`, `meta`/`details`, and (for CLI errors) `where` all carry information the recovery depends on. The agent routes on `code`; the user sees `summary`.
2. **Ignoring `severity`.** `migration status` emits warn-level diagnostics and **exits 0**. An agent that only checks exit code misses every concurrent-migration warning.
3. **Stopping at `code` on `MIGRATION.RUNNER_FAILED`.** That envelope is a wrapper — the detail lives in `why` and `meta`.
4. **Treating drift as something to silence with `db sign`.** `db sign` writes the marker from the current contract hash and, by default, advances the `db` ref to it (`--no-advance-ref` skips the ref), but it requires schema verification to pass first. Run `db verify` before reaching for `db sign`.
5. **Re-running `db migrate` after a partial failure without inspecting state.** `db schema --db <url>` shows the live shape; `migration status --db <url> --json` shows where the marker actually is.

## What Prisma 8 doesn't do yet

- **Studio / GUI database browser.** No first-party Studio. Workaround: `prisma db schema` for a CLI tree of the live schema, or use a third-party tool (TablePlus, DataGrip, `psql`) against your `DATABASE_URL`. If you need a built-in GUI, file a feature request via `references/feedback.md`.
- **First-class query logger middleware.** No built-in "log every query" middleware ships with the framework. Workaround: write a small custom middleware that wraps each operation (see `references/runtime.md` for middleware composition). If you need a built-in query log, file a feature request via `references/feedback.md`.
- **`EXPLAIN` integration.** No first-class `.explain()` on plans. Workaround: write the EXPLAIN as a raw query (``db.raw.sql`EXPLAIN ANALYZE ...` ``; see `references/queries.md`). If you need first-class EXPLAIN, file a feature request via `references/feedback.md`.
- **Prepared statements are not a gap.** `db.prepare(declaration, (sql, params) => plan)` (or `runtime.prepare(...)`) builds a statement once; a row-returning statement runs with `ps.query(runtime, params)`, an affected-count one with `ps.execute(runtime, params)`. See *Prepared statements* in `references/queries.md`. TypedSQL (`.sql` files compiled to callables) is the thing that does not exist.

## Asking for help when the envelope doesn't route

1. Re-run with `-v` (or `--json` for machine output) to get the full envelope.
2. If the envelope is genuinely uninformative — empty `fix`, missing `meta`, generic `summary` — that's a framework affordance gap; route to `references/feedback.md` with the envelope, the contract source (sanitised), and the reproduction steps.

## Checklist

- [ ] Identified which envelope shape (`CliErrorEnvelope`, `RuntimeErrorEnvelope`, `SqlQueryError`).
- [ ] Read every field — `code`, `severity`, `why`, `fix`, `meta` (or `details`), `where` if present.
- [ ] If `code` is `MIGRATION.RUNNER_FAILED`, also read `why` and `meta`.
- [ ] Routed on `code` to the next move (and chained to the matching authoring skill where the table says so).
- [ ] Re-verified with the relevant CLI command (`db verify`, `migration status --json`, `contract emit`, `db migrate`).
- [ ] Did not confabulate a Studio / EXPLAIN / query-log API — used the documented workaround and routed unmet capability gaps to `references/feedback.md`.

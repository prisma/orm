
# Prisma Next — Debug

> **Edit your data contract. Prisma handles the rest.**

When a Prisma Next call fails, the framework returns a **structured envelope**. The agent's job is to read the envelope, route on the `code`, and chain to the right authoring skill for the actual fix. This skill teaches the envelope shapes and the routing — it does not duplicate sibling-skill workflows.

## When to Use

- User pastes an error envelope (CLI failure, runtime exception, `--json` output).
- User says *"my query won't typecheck"*, *"my migration won't apply"*, *"my emit failed"*, *"the runtime crashed"*.
- User mentions a stable code (`PN-CLI-*`, `PN-MIG-*`, `PN-RUN-*`, `PN-SCHEMA-*`, `MIGRATION.*`, `CONTRACT.*`, `LINT.*`, `BUDGET.*`, `PLAN.*`, `RUNTIME.*`).
- User mentions: *Studio, EXPLAIN, query log, prepared statements, drift, hash mismatch, capability, planner*.

## When Not to Use

- User wants to author a query / model / migration → the matching authoring skill.
- User wants to *prevent* errors (lints, budgets, type-level guards) → `references/runtime.md`.
- User wants the framework changed because the surface itself is the problem (no envelope to route on, capability genuinely missing) → `references/feedback.md`.

## Key Concepts

### Two envelope shapes

Prisma Next emits **two distinct envelopes** depending on which seam threw. Read which one you have *before* routing.

**1. CLI envelope** — produced by `prisma ...` commands (emit, db init/update/verify/sign/schema, migration plan/apply/show/status, init). Shape (see `CliErrorEnvelope` in `packages/1-framework/1-core/errors/src/control.ts`):

```json
{
  "ok": false,
  "code": "PN-MIG-2001",
  "domain": "MIG",
  "severity": "error",
  "summary": "Unfilled migration placeholder",
  "why": "...",
  "fix": "...",
  "where": { "path": "...", "line": 42 },
  "meta": { "slot": "..." },
  "docsUrl": "https://prisma-next.dev/..."
}
```

The full code is `PN-<domain>-<NNNN>`. Domains in use: `CLI`, `MIG`, `RUN`, `CON`, `SCHEMA`. Severity is `error | warn | info` — `migration status` exits 0 when its diagnostics are `warn`, so route on **severity + code together**, not on exit code alone.

**2. Runtime envelope** — thrown by the in-process runtime when executing a query (see `RuntimeErrorEnvelope` in `packages/1-framework/1-core/framework-components/src/execution/runtime-error.ts`):

```ts
{ name: 'RuntimeError', code: 'BUDGET.TIME_EXCEEDED', category: 'BUDGET', severity: 'error', message: '...', details: { ... } }
```

`category` is one of `PLAN | CONTRACT | LINT | BUDGET | RUNTIME` (the prefix of `code`). `details` holds the structured context (`details` is the runtime envelope's equivalent of the CLI envelope's `meta`).

**3. SQL driver errors** — surface as `SqlQueryError` / `SqlConnectionError` (see `packages/2-sql/1-core/errors/`). Fields on `SqlQueryError`: `kind: 'sql_query'`, `sqlState` (Postgres SQLSTATE, e.g. `'23505'`), `constraint`, `table`, `column`, `detail`, `cause`. These are *not* `PN-*` codes — route on `sqlState` and the constraint metadata. SQL driver errors are typically wrapped by middleware before reaching the user, but raw-SQL paths can surface them directly.

### Wrapped errors and `meta.code`

Some commands re-wrap a downstream error into a `PN-RUN-3000` (`errorRuntime`) envelope and stash the original code on `meta.code`. The most important case: `db migrate` wraps `MigrationToolsError` (which has codes like `MIGRATION.HASH_MISMATCH`, `MIGRATION.STALE_CONTRACT_BOOKENDS`, `MIGRATION.AMBIGUOUS_TARGET`) via `mapMigrationToolsError`. The envelope you see is `code: 'PN-RUN-3000'` with `meta.code: 'MIGRATION.HASH_MISMATCH'`. **Always check `meta.code` when `code` is `PN-RUN-3000`** — that's where the routing-quality information lives.

### How to ask for the full envelope

If the user only pasted the human summary, ask for `--json` output (machine envelope) or re-run with `-v` (CLI prints the full structured fields). `--json` and `-v` are global flags on every CLI command.

## Routing — script teardown and closed client

These symptoms are not `PN-*` envelopes — route on the message text and chain to `references/runtime.md` § *Running as a script (teardown)*.

| Symptom | Next move |
|---|---|
| `TypeError: db.end is not a function` | The runtime client does not expose `db.end()` — that's the `node-postgres` pool API (`pool.end()`). The right call is `await db.close()`. See `references/runtime.md` § *Running as a script (teardown)*. |
| Script hangs after queries print / process won't exit | On Postgres the façade-owned `pg.Pool` keeps the event loop alive. Call `await db.close()` before the script returns, or `await using db = postgres<Contract>(...)` at the top of a script module (do NOT put `await using` inside a request handler — block-scoped, would close per-request). See `references/runtime.md` § *Running as a script (teardown)*. |
| `Error('Postgres client is closed')` / `Error('SQLite client is closed')` / `Error('Mongo client is closed')` | The client was closed via `db.close()` (terminal state). Remove the early `close()`, reorder so `close()` runs last after all queries, or construct a new `db` if reconnection is intended. See `references/runtime.md` § *Running as a script (teardown)*. |

## Routing — symptom and code → next move

The single source of truth: read the envelope, find the row by `code` (or `meta.code` for wrapped errors), follow the next move.

| Code | Where it surfaces | Next move |
|---|---|---|
| `PN-CLI-4001` *Config file not found* | Most `prisma` commands | Run `prisma orm init`, or pass `--config <path>`. |
| `PN-CLI-4002` *Contract configuration missing* | `contract emit`, `db *` | Add `contract: { ... }` to `prisma.config.ts`. See `references/contract.md`. |
| `PN-CLI-4003` *Contract validation failed* | `contract emit`, `db *` | Re-run `pnpm prisma-cli contract emit` after fixing the contract source named in `where.path`. See `references/contract.md`. |
| `PN-CLI-4005` *Database connection is required* | `db *`, `db migrate`, `migration status` | Pass `--db <url>` or set `db.connection` in `prisma.config.ts`. |
| `PN-CLI-4011` *Missing extension packs in config* | `contract emit` (e.g. contract uses `pgvector.Vector(...)` but config does not list the pgvector pack) | Add the descriptors named in `meta.missingExtensions` to `extensions` in `prisma.config.ts`. See `references/contract.md`. |
| `PN-CLI-4020` *Migration planning failed* | `db init`, `db update` | Inspect `meta.conflicts`. Recovery is per-conflict — chain to `references/migrations.md`. |
| `PN-CLI-5002/5003/5004/…` *Init errors* | `prisma orm init` | Re-run with the missing/invalid flags listed in `meta.missingFlags` or `meta.allowed`. |
| `PN-MIG-2001` *Unfilled migration placeholder* | `node migrations/app/<dir>/migration.ts` (self-emit) or `db migrate` | Edit `migration.ts`, replace the named `placeholder("<slot>")` with a real query closure, self-emit. See `references/migrations.md`. |
| `PN-MIG-2002` *migration.ts not found* | Reading a migration package | Restore from version control or scaffold a fresh package with `migration plan`. |
| `PN-MIG-2003` *Invalid default export* | Loading `migration.ts` | Use `export default class extends Migration { ... }` (or factory `() => ({ ... })`). See `references/migrations.md`. |
| `PN-MIG-2005` *dataTransform contract mismatch* | Building a data-transform query plan | Pass the same `endContract` reference to both `dataTransform(endContract, …)` and the query-builder context. |
| `PN-RUN-3001` *Database not signed* | `db verify`, runtime startup | DB has no marker yet. Run `prisma db init --db <url>` (baseline empty DB) or `db update --db <url>` (apply contract directly). |
| `PN-RUN-3002` *Hash mismatch* | `db verify`, runtime startup | Marker disagrees with contract hash. Either migrate forward (`db migrate` / `db update`), or — if the DB is correct after a manual fix-up — `db sign`. See `references/migrations.md`. |
| `PN-RUN-3003` *Target mismatch* | Runtime startup | Contract target ≠ config target; align them (see `meta.expected` / `meta.actual`). |
| `PN-RUN-3004` *Schema verification failed* | `db verify` (full mode) | Inspect `meta.verificationResult`. Run `db update` to reconcile, or adjust contract. |
| `PN-RUN-3010` *Schema verification failed (CLI surface)* | `db verify` schema-only | Same as 3004. |
| `PN-RUN-3020` *Migration runner failed* | `db migrate`, `db update`, `db init` | Inspect `meta` for the conflict; reconcile schema drift, then re-run. Previously applied migrations are preserved. |
| `PN-RUN-3030` *Destructive changes require confirmation* | `db update` (interactive prompt fires; non-interactive returns this code) | Re-run with `-y` (or `--yes`) to apply, or `--dry-run` to preview. **Only `db update` has this flow** — `db migrate` does not gate destructive ops on a flag. |
| `PN-RUN-3000` *(wrapper)* | `db migrate`, others wrapping `MigrationToolsError` | Read `meta.code`. Cases: `MIGRATION.HASH_MISMATCH` (re-emit: `node migrations/app/<dir>/migration.ts`); `MIGRATION.AMBIGUOUS_TARGET` (concurrent migrations — `references/migration-review.md`); `MIGRATION.STALE_CONTRACT_BOOKENDS` (re-run `migration plan`); `MIGRATION.NO_INVARIANT_PATH` / `MIGRATION.UNKNOWN_INVARIANT` (`references/migration-review.md`); `MIGRATION.PATH_UNREACHABLE` / `MIGRATION.MARKER_MISMATCH` (run `db migrate --show --db $URL` to inspect the path, then `migration plan --from <from> --to <target>` or `migration list` to audit the graph — see `references/migration-review.md`). |
| `PN-SCHEMA-0001` | `db verify` schema check | Live schema does not satisfy contract. `meta.verificationResult` has the diff. Run `db update` or adjust the contract. |
| `MIGRATION.UP_TO_DATE` / `.DATABASE_BEHIND` | `migration status` `info` diagnostics | Informational; exit 0. See `references/migration-review.md`. |
| `MIGRATION.MISSING_INVARIANTS` | `migration status` `info` diagnostic | The live marker reached the destination hash structurally but doesn't carry all invariants the target ref requires. Run `db migrate --to <name> --db $URL` to take a path that covers the missing invariants. See `references/migration-review.md`. |
| `MIGRATION.NO_MARKER` / `.MARKER_NOT_IN_HISTORY` / `.DIVERGED` / `CONTRACT.AHEAD` / `CONTRACT.UNREADABLE` | `migration status` `warn` diagnostics (exit 0; CI gates parse `--json`) | Read `severity` *and* `code`. `references/migration-review.md` covers the diamond/diverged/marker-out-of-history flows. |
| `BUDGET.ROWS_EXCEEDED` / `BUDGET.TIME_EXCEEDED` | Runtime, when the `budgets` middleware is active | Tune `budgets({ maxRows, maxLatencyMs, ... })` or rewrite the query. See `references/runtime.md`. |
| `LINT.SELECT_STAR` / `LINT.NO_LIMIT` / `LINT.DELETE_WITHOUT_WHERE` / `LINT.UPDATE_WITHOUT_WHERE` / `LINT.READ_ONLY_MUTATION` | Runtime, when the `lints` middleware is active | Fix the query (add a `WHERE` / `LIMIT` / explicit columns), or relax the lint config. See `references/runtime.md`. |
| `PLAN.HASH_MISMATCH` | Runtime, executing a precompiled plan | The contract the plan was built against does not match the runtime contract. Re-emit, rebuild, redeploy. |
| `CONTRACT.MARKER_MISSING` / `CONTRACT.MARKER_MISMATCH` | Runtime, marker check before executing | Same family as `PN-RUN-3001` / `PN-RUN-3002` but raised in-process by the runtime rather than a CLI. Recovery is the same. |
| `RUNTIME.ABORTED` (`details.phase` = `encode\|decode\|stream\|beforeExecute\|afterExecute\|onRow`) | Runtime, when an `AbortSignal` fires mid-execute | Cancellation, not a bug; surface to the caller. |
| `SqlQueryError` (no `PN-` code) | Raw-SQL paths surfacing a driver error | Inspect `sqlState` + `constraint` + `table` + `column`. Postgres `23505` = unique violation, `23503` = foreign-key violation, etc. Fix the data or the schema. |
| TypeScript error mentioning a capability (e.g. `returning()` not on the type, `include` of a many-relation off a many-load) | Authoring-time, before any envelope fires | Capability gates are declared in the **contract** (`capabilities` block, namespaced by target/family), not in `prisma.config.ts`. Route to `references/contract.md` for capability declaration and to `references/queries.md` for which method gates on which capability. Re-emit (`pnpm prisma-cli contract emit`) after enabling. |
| TypeScript error mentioning a missing field/method on `db.orm.<Model>` or a stale `Contract` shape | Authoring-time | Re-emit (`pnpm prisma-cli contract emit`); confirm `db.ts` instantiates with `postgres<Contract, TypeMaps>(...)` (the type parameters propagate the contract types). See `references/runtime.md` and `references/contract.md`. |

If the envelope's `code` is not in this table, follow the envelope's `fix` field literally — it's the framework's first-party next move. If `fix` is empty or unhelpful, escalate via `references/feedback.md`.

## Common Pitfalls

1. **Reading only `summary`, not the rest of the envelope.** `code`, `severity`, `why`, `fix`, `meta`/`details`, and (for CLI errors) `where` are all load-bearing. The agent routes on `code`; the user sees `summary`.
2. **Ignoring `severity`.** `migration status` emits warn-level diagnostics and **exits 0**. An agent that only checks exit code misses every concurrent-migration warning.
3. **Skipping `meta.code` on `PN-RUN-3000`.** That envelope is a wrapper — the real code lives on `meta.code`.
4. **Treating drift as something to silence with `db sign`.** `db sign` writes the marker from the current contract hash, but it requires schema verification to pass first. Run `db verify` before reaching for `db sign`.
5. **Re-running `db migrate` after a partial failure without inspecting state.** `db schema --db <url>` shows the live shape; `migration status --db <url> --json` shows where the marker actually is.

## What Prisma Next doesn't do yet

- **Studio / GUI database browser.** No first-party Studio. Workaround: `prisma db schema` for a CLI tree of the live schema, or use a third-party tool (TablePlus, DataGrip, `psql`) against your `DATABASE_URL`. If you need a built-in GUI, file a feature request via `references/feedback.md`.
- **First-class query logger middleware.** No built-in "log every query" middleware ships with the framework. Workaround: write a small custom middleware that wraps each operation (see `references/runtime.md` for middleware composition). If you need a built-in query log, file a feature request via `references/feedback.md`.
- **`EXPLAIN` integration.** No first-class `.explain()` on plans. Workaround: write the EXPLAIN as a raw query (``db.raw.sql`EXPLAIN ANALYZE ...` ``; see `references/queries.md`). If you need first-class EXPLAIN, file a feature request via `references/feedback.md`.
- **Prepared-statement caching as a user-facing surface.** Adapters prepare under the hood for parameterized queries, but you cannot pre-prepare and re-execute a statement by name. Workaround: use TypedSQL (see `references/queries.md`). If you need prepared statements as a first-class API, file a feature request via `references/feedback.md`.

## Asking for help when the envelope doesn't route

1. Re-run with `-v` (or `--json` for machine output) to get the full envelope.
2. If the envelope is genuinely uninformative — empty `fix`, missing `meta`, generic `summary` — that's a framework affordance gap; route to `references/feedback.md` with the envelope, the contract source (sanitised), and the reproduction steps.

## Checklist

- [ ] Identified which envelope shape (`CliErrorEnvelope`, `RuntimeErrorEnvelope`, `SqlQueryError`).
- [ ] Read every field — `code`, `severity`, `why`, `fix`, `meta` (or `details`), `where` if present.
- [ ] If `code` is `PN-RUN-3000`, also read `meta.code`.
- [ ] Routed on `code` to the next move (and chained to the matching authoring skill where the table says so).
- [ ] Re-verified with the relevant CLI command (`db verify`, `migration status --json`, `contract emit`, `db migrate`).
- [ ] Did not confabulate a Studio / EXPLAIN / query-log API — used the documented workaround and routed unmet capability gaps to `references/feedback.md`.

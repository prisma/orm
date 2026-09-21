# D1 Support — Implementation Plan

## Summary

Cloudflare D1 is a managed, SQLite-compatible database. Prisma 8 should support it as a first-class deployment target so that applications authored against the SQLite target can run on Cloudflare Workers, with migrations driven from the CLI via D1's REST API. This document captures the plan, the trade-offs chosen, and the alternatives considered and rejected.

The core insight is that D1 speaks the same SQL dialect as SQLite but offers a fundamentally different execution model: no interactive transactions over either REST or the Workers binding. Migrations and runtime queries therefore share the SQLite adapter's SQL generation unchanged but diverge in how they execute, lock, and guarantee atomicity.

## Dependencies

- **PR #341** (`feat/sqlite-migrations`) must land first. It adds the SQLite migration planner, runner, introspection, PSL type mappings, and control tables. D1 reuses the planner, DDL builders, introspection, and PSL mappings; it replaces the runner.
- No external blockers on the SQLite target's runtime plane, which is already complete.

## Architecture Overview

Prisma 8 separates `family → target → adapter → driver`. For D1 we add a single new driver package that binds to the existing `targetId: 'sqlite'` — no new target, no new adapter. This is a first for the repo (every target has had a single driver until now), but the framework's capability aggregation already supports it: `mergeCapabilities` in the control API enrichment pipeline aggregates capability declarations from adapters, drivers, targets, and extensions indiscriminately, so a driver can contribute its own capability flags without any framework change.

### What we reuse from the SQLite target unchanged

- **Adapter SQL generation** (`packages/3-targets/6-adapters/sqlite/src/core/adapter.ts`). Pure SQL rendering, no runtime coupling, no Node-specific imports. D1 understands this SQL as-is.
- **Codecs and column types** (`codecs.ts`, `column-types.ts`).
- **PSL type mappings** (`control-mutation-defaults.ts` from PR #341) — maps PSL scalars to SQLite native types; identical for D1.
- **Schema introspection** (`control-adapter.ts` from PR #341). Uses `SELECT FROM sqlite_master` plus read-only PRAGMAs (`table_info`, `foreign_key_list`, `index_list`, `index_info`), all of which D1 honors as regular queries.
- **Migration planner + DDL builders** (`planner.ts`, `planner-ddl-builders.ts`, `statement-builders.ts` from PR #341). The planner takes a contract and a schema IR and produces operations; it never touches the driver. DDL builders emit pure SQL strings.
- **Default parsing** (`parseSqliteDefault`), **native type normalization** (`normalizeSqliteNativeType`).
- **Control tables** `_prisma_marker` and `_prisma_ledger` — schema is SQLite-compatible and works unchanged on D1.

### What's new for D1

- A driver package (`@internal/driver-sqlite-d1` or similar, in `packages/3-targets/7-drivers/sqlite-d1/`) exporting both a runtime driver and a control driver.
- A D1-specific migration runner. PR #341's runner cannot execute on D1 because it relies on interactive reads inside a `BEGIN EXCLUSIVE` transaction. The new runner reshapes the lifecycle around D1's import API, which accepts a self-contained SQL file and runs it atomically server-side.
- An extension to the shared `ControlDriverInstance` interface adding a bulk-atomic-apply primitive alongside `query`. The D1 runner needs a way to ship a multi-statement script atomically; the existing `query` method is a read-with-results contract and a poor fit. See "Driver interface" below.
- New capability declarations on the driver side to gate runtime operations that require interactive transactions.
- An assertion-based gate in the ORM that checks this capability at mutation entry points and throws a typed error for unsupported operations on D1.

## Migration Strategy

### Control driver: two REST paths

Migrations are driven from the Node-based CLI, which has no Workers runtime. The control driver uses two distinct Cloudflare D1 REST API paths, chosen per operation:

**`POST /accounts/:id/d1/database/:db/query`** — single-statement queries with request/response semantics. Used for schema introspection, marker reads, and all non-migration control-plane work. Simple, one round-trip per query.

**`POST /accounts/:id/d1/database/:db/import`** — asynchronous SQL-file ingestion. The CLI uploads the migration SQL to a pre-signed R2 URL (returned by the D1 `init` call), tells D1 to ingest, and polls for completion. This path executes statements sequentially server-side with a different transaction-framing model than `/query`: in particular, `PRAGMA foreign_keys = OFF` takes effect and applies to subsequent statements in the same import. The import pipeline is atomic-on-failure — per wrangler's own comment, *"if the execution fails to complete, your DB will return to its original state and you can safely retry"* — so the DDL either applies cleanly or not at all.

Wrangler exposes the same split without naming it. `wrangler d1 migrations apply` uses `/query` and silently loses data on recreate-table with CASCADE children. `wrangler d1 execute --file=migration.sql` uses the import API and does not. Prisma 8 uses the import API from the start for migration application and avoids the trap.

Credentials: the same API token works for both endpoints. R2 upload uses the pre-signed URL D1 returns, so no separate R2 credentials are needed.

**Trade-off accepted**: the import API is multi-round-trip (init → upload → ingest → poll). Migrations are latency-tolerant, so this is fine. Non-migration reads stay on `/query` because they don't need the import path's semantics and latency would matter more per-call.

### Driver interface: `query` for reads, `applyScript` for atomic apply

The current `ControlDriverInstance` interface (`packages/1-framework/1-core/framework-components/src/control-instances.ts`) exposes `query(sql, params?) → {rows}` and `close()`. That shape fits single-statement reads well and doesn't fit bulk atomic apply — the D1 runner needs to ship a multi-statement SQL file and get back a pass/fail signal, not individual rows.

The interface grows one method:

- `query(sql, params?)` — existing. Contract: execute a single statement, return rows. Used for introspection, marker reads, any other control-plane reads.
- `applyScript(sql)` — new. Contract: execute the entire SQL blob atomically; either every statement succeeds and the changes commit, or nothing changes. No rows returned. The caller is responsible for encoding any assertions inside the script (e.g., `RAISE(ABORT)` on an post-check violation).
- `close()` — existing.

How each target's control driver implements `applyScript`:

- **D1**: uploads the SQL to the pre-signed R2 URL returned by the `import` init call, triggers ingestion, polls for completion. Atomicity is provided by the import pipeline's documented "returns to original state" guarantee on any failure.
- **Native SQLite**: wraps `db.exec(script)` in `BEGIN IMMEDIATE … COMMIT`, rolls back on error.
- **Postgres**: `BEGIN` then a single multi-statement `query(script)` then `COMMIT`, rolled back on error.

The D1-specific migration runner reads linearly: pre-phase calls `driver.query(...)` for each introspection and marker read; it composes a single SQL script containing PRAGMA toggles, DDL, and the post-checks hands that script to `driver.applyScript(...)`; then post-apply calls `driver.query(...)` again for re-introspection, verification, and — if verification passes — the marker CAS, marker upsert, and ledger insert. No conditional routing inside the runner, and no way for the runner to accidentally ship a migration through the wrong endpoint.

Considered and rejected: having the driver inspect the SQL string and auto-route (e.g., "multi-statement → import") from inside `query`. Fragile (what counts as multi-statement with PRAGMAs, comments, etc.) and implicit. `query` and `applyScript` differ in *intent* — read-with-results vs atomic side effect with no expected rows — and the interface surfaces the intent explicitly.

PR #341's existing runner continues to use `query` throughout (it opens `BEGIN EXCLUSIVE` via `query('BEGIN EXCLUSIVE')` and does interactive reads inside). `applyScript` is additive; it doesn't require any change to that runner. If we later want to port PR #341's runner to the `applyScript` shape, the primitive is already available on native SQLite and Postgres control drivers.

### Runner shape: pre-phase reads → apply script → verify → sign

PR #341's runner wraps the entire migration in `BEGIN EXCLUSIVE … COMMIT` with interactive reads inside. D1's import API is not interactive — you submit a SQL file and poll for outcome. The lifecycle restructures into four phases:

1. **Pre-phase reads** (via `driver.query`): introspect current schema, read the marker, compute which operations to skip based on their postchecks, verify origin-hash compatibility. Non-atomic reads. If any check aborts the migration, no state has changed.
2. **Apply script** (via `driver.applyScript`): construct a single SQL script containing, in order —
   - `PRAGMA foreign_keys = OFF;`
   - Control-table creation (idempotent): `CREATE TABLE IF NOT EXISTS _prisma_marker` / `_prisma_ledger`
   - Each non-skipped operation's DDL, including recreate-table operations for tables with incoming CASCADE FKs
   - `PRAGMA foreign_keys = ON;` followed by an inline assertion over `pragma_foreign_key_check` that raises on violations

   Hand the script to `driver.applyScript`. On D1 that routes through the import API; on native SQLite and Postgres it wraps in `BEGIN`/`COMMIT`. Atomicity: any failed statement triggers a full rollback to the pre-apply state. Note: the script contains DDL only — no marker or ledger writes.

3. **Verify** (via `driver.query`): re-introspect the live schema and compare against the destination contract using `verifySqlSchema`. If the live schema does not satisfy the contract, the migration is reported as failed and the next phase does not run. The DDL is already live — it cannot be rolled back — but the marker remains unchanged, so downstream callers (the runtime, subsequent migrations) see the database as still being at the origin contract and refuse to treat it as signed.

4. **Sign** (via `driver.query`): if verification passed, issue the marker update and ledger insert as individual statements. The marker update is a conditional `UPDATE _prisma_marker SET … WHERE storage_hash = :expected_origin` — the marker-version CAS guard — followed by an upsert `INSERT … ON CONFLICT DO UPDATE` for the first-migration case. If the CAS reports zero rows changed (another migrator advanced the marker between our pre-phase read and now), the signing phase reports failure without updating. The DDL we applied is still live; again, downstream consumers see the pre-migration marker and the situation is equivalent to "DDL applied but not signed."

The signing phase trades atomicity with the DDL for the ability to gate the marker on verification — a property the import API cannot provide inside the atomic apply.

### Foreign-key handling via the import API

The import API's execution model restores the standard SQLite recreate-table dance: `PRAGMA foreign_keys = OFF` at the top of the file, do the rebuild, `PRAGMA foreign_keys = ON` with an integrity check. Child rows with `ON DELETE CASCADE` survive parent rebuilds because FK enforcement is genuinely disabled during the DDL.

This works only because the import API executes statements in a framing where `PRAGMA foreign_keys` takes effect. Empirical testing confirmed the split against both miniflare and a fresh remote D1 database: running the identical `PRAGMA foreign_keys = OFF` + recreate-table SQL via `wrangler d1 execute --remote --file=...` (import API path) preserved CASCADE child rows through the parent rebuild, while the same SQL via `--remote --command=...` (`/query` path) wiped them. The PRAGMA is a no-op inside `/query`'s implicit transaction wrapper; it is honored inside the import pipeline.

`PRAGMA defer_foreign_keys = ON` is not an alternative — testing showed it does not prevent cascade actions under any D1 endpoint. Only `PRAGMA foreign_keys = OFF` on the import path suppresses the cascade.

Consequence: the planner's full range of operations, including recreate-table of tables with incoming FK constraints of any kind (including CASCADE), is supported from day one.

### Concurrency: marker-version CAS instead of `BEGIN EXCLUSIVE`

The native SQLite runner uses `BEGIN EXCLUSIVE` to prevent two concurrent migrators from racing. D1 offers no equivalent lock primitive — REST is stateless, binding batches are short-lived, and the import API has no session affinity.

The D1 runner replaces exclusive locking with optimistic concurrency on the marker row. The pre-phase reads the marker's current storage-hash. The signing phase, which runs after the applied DDL has been verified, issues a conditional `UPDATE _prisma_marker SET … WHERE storage_hash = :expected_origin`. If the hash has moved since we read it, zero rows are affected and the runner reports CAS failure without touching the marker. Two concurrent migrators cannot both sign; the loser sees a CAS failure and can re-plan against the new state.

This is weaker than exclusive locking in two respects. First, two migrators might both enter the pre-phase, both do full introspection, and one of them does throwaway work before the CAS fails. Second, two migrators might both *apply* the same DDL (the import is atomic per-migrator but nothing prevents the two imports from both running) before one of them loses the CAS. In practice both are fine — migrations are human-triggered from a CLI, and idempotent DDL (our planner already emits `CREATE TABLE IF NOT EXISTS`, `INDEX IF NOT EXISTS`) absorbs the concurrent-apply case. "Two operators independently try to apply the same plan" is a rare operational event, not a hot contention path.

### Schema verification: done between apply and sign

PR #341's runner verifies the post-DDL schema against the contract inside the transaction: introspect the live database, compare it against the contract, fail the migration if they diverge. This defends against planner bugs — a missing `NOT NULL`, a wrong type affinity, an index on the wrong column set — and, for user-authored migrations, against the authored SQL producing a different schema than the declared target. It's a safety property worth preserving.

On D1, verification cannot happen *atomically* with the DDL — the import API is fire-and-poll, so re-introspecting the live schema can only happen after the import has committed. That rules out the "verify and rollback together" model. It does not rule out verification itself.

The D1 runner runs verification as an explicit phase between apply and sign. If verification fails, the marker is not updated. The live DDL is already applied and cannot be rolled back; the database is in a state where its schema does not match any signed contract. Downstream callers see the marker unchanged from its pre-migration value — the same signal they would see if the migration had never run — and refuse to treat the database as being at the target contract. The operator is told verification failed and must reconcile manually (edit the migration SQL or the contract, then re-run; on re-run the planner re-diffs live schema against contract and either produces an empty plan if the previous DDL happened to work, or produces a corrective plan).

This design is strictly binary at the marker: either the contract is signed (applied + verified) or it isn't. There is no "applied but not verified" status column, so no tri-state for downstream callers to handle. The cost is that a failed-verification migration leaves the live DDL applied without being signed — unrecoverable automatically, recoverable manually. That cost is accepted in exchange for keeping the verification property.

User-authored migrations receive the same treatment: whatever SQL the user wrote, we apply it via the import API, then check that the resulting schema matches the declared target contract. If it doesn't, we do not sign it.

## Runtime Strategy

### Runtime driver: Workers binding

Application code runs inside Cloudflare Workers with a bound D1 database at `env.DB`. The runtime driver accepts a `D1Binding` analogous to the existing `PostgresBinding` — variants for the binding directly (`{ kind: 'binding', db: D1Database }`) and potentially a REST variant for local development or serverless platforms other than Workers. The binding variant is the primary supported surface.

The driver implements `RuntimeDriverInstance & SqlDriver<D1Binding>`. Query execution maps to `db.prepare(sql).bind(...params).all() | .run() | .raw()`. Streaming uses D1's result-set iteration. The driver does *not* implement `transaction()` — see capability gating below.

### Capability gating: `interactiveTransaction`

Today the ORM at `packages/3-extensions/sql-orm-client/src/mutation-executor.ts` checks `typeof runtime.transaction === 'function'` and falls through silently if the method is absent, running nested writes without atomicity. That's a latent bug regardless of D1 — any driver that ships without a transaction method loses atomicity invisibly.

We introduce a new capability `interactiveTransaction: boolean` declared on the driver side:

- Native SQLite driver: `interactiveTransaction: true`
- Postgres driver: `interactiveTransaction: true`
- D1 driver: `interactiveTransaction: false`

The ORM's `withMutationScope` is replaced with an explicit assertion following the existing `assertReturningCapability` pattern (`packages/3-extensions/sql-orm-client/src/collection-contract.ts`, lines 325–331). The assertion fires at the same mutation entry points that today call `assertReturningCapability` — create, createAll, upsert, update, updateAll, delete, deleteAll — but only when the operation produces nested work (relations with writes) or the user calls the explicit `.transaction()` API. Flat single-statement operations (`find*`, flat `create`/`update`/`delete`, `updateMany`, `deleteMany`, `upsert`, homogeneous `createMany`) don't need the capability and remain available on D1.

The silent-fallthrough branch in `mutation-executor.ts` is removed: reaching that code with nested work and no transaction is a bug, not a runtime condition to tolerate.

### User-facing `.transaction()` API

The runtime client's `.transaction()` method is omitted from the D1 client's type signature (not merely throwing at call time). The ExecutionContext pattern already shapes clients per target; this becomes one more capability-driven type difference. A user migrating code from Postgres or native SQLite to D1 gets a compile-time error at every `.transaction()` call site, which is preferable to a runtime surprise.

### Operation compatibility matrix

| Operation | D1 | Reason |
|---|---|---|
| `findUnique`, `findFirst`, `findMany` | supported | single SELECT |
| Flat `create`, `update`, `delete` | supported | single statement |
| `updateMany`, `deleteMany` | supported | single statement |
| `upsert` | supported | single `INSERT … ON CONFLICT` |
| `createMany` (homogeneous column set) | supported | single statement |
| `createMany` (heterogeneous column sets) | supported via `atomicBatch` | multiple statements, atomic, non-interactive — fits D1 `batch()` |
| `create`/`update` with nested relations | **rejected** | requires reading the parent PK mid-transaction to feed child FKs |
| User `runtime.transaction()` | **rejected** | requires interactive transactions |

### `atomicBatch` capability (secondary)

Heterogeneous `createMany` today falls through the same transaction-wrapping path as nested writes, because it emits multiple INSERT statements grouped by column signature. On D1 this is unnecessary — D1's `batch()` can execute those grouped INSERTs atomically without an interactive transaction. A second capability `atomicBatch: boolean` lets the ORM recognize this and route heterogeneous `createMany` through `SqlDriver.batch([stmts])` (a new driver method) instead of the transaction-wrapping path.

This is additive, not blocking — without `atomicBatch`, heterogeneous `createMany` would be rejected alongside nested writes, which is over-restrictive. With `atomicBatch`, the common case of bulk-inserting rows with optional columns stays supported.

## New Capabilities Summary

| Capability | Level | SQLite (native) | Postgres | D1 |
|---|---|---|---|---|
| `interactiveTransaction` | driver | true | true | false |
| `atomicBatch` | driver | true (via `BEGIN IMMEDIATE`) | true (via `BEGIN`) | true (native) |

Both live under the `sql` capability namespace. Existing capabilities (`returning`, `jsonAgg`, `lateral`, `enums`, `defaultInInsert`, `orderBy`, `limit`) stay on the adapter — they're dialect concerns. `interactiveTransaction` and `atomicBatch` are runtime concerns, hence driver-level.

This pushes against a comment at `packages/1-framework/1-core/framework-components/src/framework-components.ts` lines 16–19 that says capabilities "must be declared on the adapter descriptor." The enrichment pipeline already permits driver-level capabilities; the comment reflects original intent, not current behavior. The comment should be updated as part of this work to reflect that capabilities are declared at the layer that owns the concern (SQL dialect → adapter; runtime behavior → driver).

## Alternatives Considered and Rejected

### Separate adapter package for D1

Rejected. D1 speaks identical SQLite dialect — there is no SQL-generation difference. Duplicating the adapter would create two packages that must stay in sync with no semantic reason for them to diverge. The runtime-execution difference is a driver concern, not a dialect concern, and capabilities already compose from drivers.

### New target descriptor for D1 (`targetId: 'd1'`)

Rejected for the same reason. The target identifies the SQL dialect; introducing `d1` as a separate target would require users to re-author their contracts or plumb cross-target equivalence. D1 and SQLite share a dialect; they differ in deployment target, which is what drivers exist to express.

### Keep `BEGIN EXCLUSIVE` in the runner by using a D1 Worker transaction broker

Rejected. The idea was to front D1 with a small Worker endpoint that holds a Durable Object session and serializes interactive transactions on the binding side. That Worker would expose the existing `ControlDriverInstance` surface to the CLI, and the existing PR #341 runner would execute unchanged.

Problems: D1's binding also does not provide interactive transactions — `db.batch()` is the only atomic primitive, and individual `prepare().run()` calls each commit independently. A Worker broker cannot conjure interactive transactions where D1 does not offer them. The only way to provide session-scoped write coordination would be a Durable Object that keeps the full migration state in memory, which is an independent distributed-systems project and well out of scope.

### Refactor the SQLite runner to abstract the transaction strategy

Rejected after reading the runner code. The interactive reads in `applyPlan` — postcheck-before-execute idempotency, precheck verification, post-execute postcheck, mid-transaction introspection — are baked into the control flow, not confined to the `BEGIN`/`COMMIT` envelope. A strategy pattern that abstracts only the transaction boundary leaves the interactive reads unresolved. Factoring them out too would essentially rewrite the runner. A parallel D1-specific runner with a reshaped lifecycle is cleaner than a half-factored abstract runner.

### Dropping schema verification entirely on D1

Rejected. The argument for dropping it is that the import API's non-interactive nature prevents atomic apply+verify, so a post-apply verification with no consequence isn't worth the introspection cost.

The flaw: for user-authored migrations, verification is the only check that the authored SQL actually produces the declared target schema. Dropping it means the system would sign an arbitrary contract hash onto whatever state the SQL left the database in. That's a real correctness regression, not a small one. The plan keeps verification and separates it from the atomic apply, gating the marker update on verification passing.

### Post-apply schema verification written into a tri-state marker

Rejected. A variant of keeping verification would encode the verification outcome as a status column on the marker: `applied-and-verified`, `applied-but-failed-verification`, `no-marker`. The live database's state is reported faithfully, and downstream callers can branch on the status.

Problems: every downstream consumer — the runtime, subsequent migration planners, any tooling that reads the marker — must now understand three states. The `applied-but-failed-verification` branch has no clear correct behavior: refuse to start the application? Log a warning and proceed? Attempt auto-reconciliation? Each choice is wrong for some scenarios. The current plan avoids this by keeping the marker binary (signed or not): if verification fails, the marker simply isn't updated, and downstream callers see the same thing they would see if the migration had never run. The operator reconciles manually, which is the right boundary for a case that requires human judgement anyway.

### Pre-apply schema simulation

Rejected. Apply the planned DDL to the introspected `SqlSchemaIR` in memory, verify the simulated IR matches the contract, then ship the script. Would preserve the atomic guarantee: if simulation says the plan produces a matching schema and the script executes cleanly, the live schema would match.

Problems: the simulator verifies the planner against a twin of itself. PR #341's post-DDL verification catches two classes of bug — planner bugs (planner's intent doesn't match the contract) *and* execution-path bugs (DDL renders or SQLite applies it differently than the planner expects). Simulation can only catch the first class, and does so by duplicating the planner's logic in another form. If the planner and the simulator are written from the same mental model (which they inevitably are, by the same authors), they tend to reproduce the same bugs.

Running the real verification against the live schema is both simpler and more robust than maintaining a simulator that has to be kept in sync with every planner change.

### Support nested writes on D1 via client-generated primary keys

Deferred, not rejected. If the ORM planner resolves nested-write PKs client-side (CUIDs, UUIDs) before constructing statements, all inserts can ship in one batch with the FK relationships pre-resolved — no need to read RETURNING mid-transaction. This unlocks nested writes on D1 without interactive transactions. The cost is that the planner must support client-generated PKs end-to-end, which is a cross-cutting feature touching contract authoring, codec generation, and mutation planning. It's the right long-term answer; for the first D1 release we gate nested writes and revisit once the planner supports this.

### Apply migrations via the `/query` REST endpoint

Rejected. `wrangler d1 migrations apply` takes this path. Empirical testing against miniflare and against remote D1 confirmed that `PRAGMA foreign_keys = OFF` inside `/query`'s implicit transaction is a no-op: recreate-table migrations with CASCADE children silently lose data. The import API avoids this by using a different server-side execution framing. Whichever endpoint Cloudflare unifies eventually, we use the one that works today.

### Follow wrangler's model exactly (no marker, no hash, no verification)

Rejected. Wrangler's migrations are hand-authored SQL with no schema-of-record to verify against — the user is the source of truth. Prisma 8 has a contract as the declared schema-of-record; discarding the marker and origin/destination hashes would surrender a meaningful correctness property independent of verification. Wrangler's use of the import API *is* adopted; its lack of marker and hash integrity is not.

### Advisory lock via a lease-row pattern

Rejected for this release, might revisit. The idea: before submitting the import, INSERT a row into a `_prisma_migration_lease` table with a TTL; on import failure, the lease expires and another migrator can proceed. This adds a layer of concurrency protection on top of marker CAS. For CLI-triggered human-paced migrations, marker CAS alone is sufficient, and the lease-row pattern adds operational complexity (stale leases, clock skew, cleanup) that isn't justified by the risk profile.

## Open Questions

- **Import API atomicity under mid-file failures.** Wrangler's comment states that failed imports return the database to its original state. Verify empirically that this covers *every* failure class we care about: syntax errors, `RAISE(ABORT)` raised by our inline FK-integrity assertion, and FK-integrity violations surfaced by `PRAGMA foreign_key_check`. If any of these are treated as "partial success," the DDL atomicity invariant fails.
- **Import API error granularity.** When the import fails, does the response tell us *which* statement failed and what the SQL error was, or only that the import failed? The CLI's error messages depend on this — we want to surface "operation X's DDL failed with message Y," not "the import failed."
- **Import API size limits.** Migrations are generally small, but the R2 upload step has per-object limits. Confirm no migration shape we reasonably expect hits them.
- **Per-table introspection parallelism on `/query`.** PR #341's control adapter comments that synchronous `node:sqlite` reads don't benefit from `Promise.all`. On D1 `/query` the opposite is true — parallelizing per-table PRAGMA reads can meaningfully cut pre-import time for large schemas. The control adapter may need either a configuration flag or a driver-hint mechanism to choose strategy.
- **Credentials config shape.** `/query` and `/import` both need account ID, database UUID, and API token; the Workers binding needs a binding name. The config-loader mechanism should accept both REST and binding shapes cleanly without forcing users to duplicate configuration between dev and prod.
- **Error-envelope mapping for D1.** D1's REST and binding surfaces return different error shapes than native SQLite's. The driver needs an error mapping table that surfaces comparable `RuntimeError` codes so ORM-level error handling stays consistent.

## Non-Goals

- D1 as a separate SQL dialect. We explicitly reuse the SQLite adapter's SQL output. If D1 ever diverges (new D1-only SQL features, incompatible PRAGMA semantics), we revisit — but not preemptively.
- Online schema migrations on D1. PR #341's planner is additive-plus-recreate; D1 inherits that scope. No online alter paths, no zero-downtime migrations.
- Interactive transactions via any mechanism. They are gated at the ORM layer; no runtime fallback, no emulation.
- Nested writes. See "client-generated primary keys" under deferred alternatives.
- Multi-region / session-consistency tuning (D1's `withSession`). Runtime driver uses default consistency; session-consistency modes are a future enhancement.
- Local development with native `node:sqlite`. The local story for D1 developers uses miniflare (what wrangler uses), which gives bit-compatible D1 behavior locally. The native-SQLite driver is not repurposed for D1 local dev.

# ADR 021 — Contract marker storage & verification modes

**Status:** Accepted. [ADR 339](ADR%20339%20-%20Each%20target%20has%20a%20contract%20space%20for%20Prisma%27s%20own%20tables.md) makes these tables a contract space the target package carries. On PostgreSQL they are created and changed by that space's migrations, which every command that changes a database applies first, instead of by statements each runner issued on first use, and they are in the schema `_prisma` ([ADR 338](ADR%20338%20-%20Names%20Prisma%20puts%20in%20a%20database%20or%20a%20query%20begin%20with%20_prisma.md)). SQLite, MySQL, MariaDB and MongoDB still create their tables on first use. On PostgreSQL each contract space's marker is a row of `_prisma.signatures`, and the database's policies ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)) are in a table of their own, `_prisma.config`; on the other targets they are still under the marker's `meta.policies`. [ADR 333](ADR%20333%20-%20The%20runtime's%20marker%20check%20only%20warns.md) supersedes what this record says the runtime does when the marker cannot be read or decoded, and its strict-mode refusals: the runtime's check only warns.

## Context

The runtime and the migration runner must know which data contract a database currently satisfies. Plans carry meta.coreHash and meta.target and must be verified against the database before execution. We need a durable, unambiguous marker in the database plus clear verification modes suited to dev, CI, and production.

## Decision

Store the current contract identity in a small, reserved table, `_prisma.signatures` on PostgreSQL, in each database:
- The marker records the core hash of the data contract and the profile hash pinned by the contract (declared capability profile)
- The runtime implements three verification modes: startup, onFirstUse, and always
- Cross-environment drift is reported with structured errors and remediation guidance, never auto-patched

## Marker schema

### Default for Postgres

The tables as the first migration of the Prisma space creates them:

```sql
create schema if not exists _prisma;

create table _prisma.signatures (
  space text primary key,
  core_hash text not null,
  profile_hash text not null,
  invariants text[] not null default '{}',
  signed_at timestamptz not null default now()
);

create table _prisma.config (
  id boolean primary key default true,
  policies jsonb not null default '{}',
  constraint config_single_row check (id)
);
```

A row of `signatures` says which contract one contract space was signed with. `config` holds at most one row, for the whole database: the policies in force, in the same form a ref declares them. They are two tables because they describe different things: a signature belongs to one space, and a policy governs every space in the database. A database whose `config` has no row takes the default policies.

The release candidates kept one table, `prisma_contract.marker`, with the columns `contract_json`, `canonical_version`, `app_tag` and `meta` as well. Nothing read the first three, and `meta` held only the policies. The Prisma space's first migration moves each of its rows into `signatures`, moves the application row's `meta.policies` into `config`, and drops it.

### Schema evolution (TML-2397)

The marker was originally a singleton — one row keyed by `id smallint primary key default 1`. [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md) made each contract space (the application plus every loaded schema-contributing extension) own its own marker row, so the schema gained a `space text not null` column and re-keyed by `(space)`:

- The application's row uses `space = 'app'`.
- Each extension's row uses its declared space identifier (e.g. `'cipherstash'`, `'pgvector'`).
- Space identifiers are constrained to `[a-z][a-z0-9_-]{0,63}`.

Prisma 8 does not convert a marker of the singleton shape: the project keeps no code for databases an earlier pre-release wrote. A database that still has one fails when the marker is read. On PostgreSQL a command that only reads reports `CONTRACT.PRISMA_SPACE_BEHIND`, and a command that changes the database stops at the Prisma space's column check with `MIGRATION.PRECHECK_FAILED`; on the other targets the read fails as `CONTRACT.MARKER_READ_FAILED`.

### Notes
- `signatures` has one row per loaded contract space, primary-keyed by `space`. The application has one row (`space = 'app'`); each loaded extension has one row; the Prisma space has one row (`space = '_prisma'`), which records the form these tables themselves are in.
- core_hash is the canonical hash of contract.json after canonicalization
- profile_hash mirrors the contract-pinned capability profile and is used to enforce equality at verification time
- invariants is the set-semantic, monotonic record of `invariantId`s that have been applied to this database at least once in its history. Populated by server-side union on every successful `migrate`; never shrinks. The reading is "applied-at-least-once," not "currently true of the data" — the data transform's `check` is the authority for the latter. See [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) for the full semantics.
- signed_at is when the row was last written
- A contract is never stored in these tables. On PostgreSQL the ledger's contracts are kept in `_prisma.contract`, keyed by hash.

### Other targets
- **MySQL**: the table `_prisma_marker` in the current database, with the columns of the release candidates' PostgreSQL marker; the policies are under `meta.policies`
- **SQLite**: the table `_prisma_marker` with the same columns as MySQL's (including the `space` PK); the runner merges the `invariants` set inside `BEGIN EXCLUSIVE` (no native text-array merge in SQL). A singleton-shape marker fails when read, as on Postgres.
- **Mongo**: `_prisma_migrations` collection with one marker document per loaded contract space, keyed `{_id: <spaceId>, space: <spaceId>, ...}` (see [ADR 212](./ADR%20212%20-%20Contract%20spaces.md) and [Subsystem 10 — Contract spaces](../subsystems/10.%20MongoDB%20Family.md#contract-spaces)). Ledger entries gain a `space` field too. `invariants` is read as `doc.invariants ?? []` so docs without the field transparently report the empty set (natural schemaless behaviour, not a compat shim).
- Adapters must provide DDL for creating and reading the marker consistently

## Ownership and lifecycle
- The migration runner is the only component that updates the marker
- It writes `core_hash`, `profile_hash`, and the `invariants` union at the end of a successful edge apply, in the same transaction when transactional DDL is available
- It also writes an entry to the migration ledger for audit
- For profile-only updates (no DDL), the runner updates `profile_hash` after a successful verification that the database satisfies the contract-declared capabilities (core_hash remains unchanged)
- The `invariants` field is merged server-side, atomically. Postgres uses a self-referential expression `invariants = array(select distinct unnest(invariants || $N::text[]) order by 1)`; Mongo uses an aggregation pipeline (`$setUnion + $sortArray`); SQLite merges the set inside `BEGIN EXCLUSIVE` together with marker read/write paths. The server-side path means a single statement (or document operation, or exclusive transaction) reads the existing set, unions in the incoming ids, dedupes, and writes — eliminating the read-then-write race that two concurrent runners would otherwise expose if they each unioned client-side and wrote back. `invariants: []` is a no-op merge (preserves existing set), not a clobber. See [ADR 208 §"Server-side merge for invariants"](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) for the rationale.
- The runtime reads but never mutates the marker
- Reads are cheap, cached per process, and invalidated by configurable TTLs or explicit cache busting
- If the marker is missing, the runtime reports contract/marker-missing and refuses to execute in strict mode

## Namespacing and multi-tenant
- Default behavior is per schema for Postgres
- Each database has one `_prisma.signatures` and one `_prisma.config`
- The runtime verifies against the schema implied by the Plan's meta.refs or a configured default schema
- Alternative centralized mode is supported for platforms that mandate a single control schema
- Adapters surface a markerLocator to find the correct row keyed by schema_name or tenant_id
- Policy is defined by deployment, not by Plans
- Plans must not embed tenant identifiers beyond normal table qualification

## Verification modes

### startup
- Verify once when the runtime starts
- Read the marker, compare contract coreHash/profileHash to marker values, cache the result
- On mismatch, throw contract/hash-mismatch or contract/target-mismatch and refuse to start in strict mode
- Intended for stable production processes and long-lived workers

### onFirstUse
- Verify lazily the first time a table from a schema is referenced
- Uses Plan meta.refs.tables if present, else a configured default schema
- Caches per schema in memory for the process lifetime
- Good balance for modern serverless or frequently recycled workers

### always
- Verify for every Plan
- Highest safety, highest cost
- Recommended for CI, preflight, and debug sessions

## Drift handling

### Error taxonomy
- contract/marker-missing when the marker table or row is absent
- contract/hash-mismatch when DB core_hash and Plan coreHash differ
- contract/target-mismatch when DB profile_hash and contract profileHash differ (run a profile-only verify if the contract intentionally changed capability profile)

### Behavior
- In strict mode these are blocking errors
- In permissive mode marker-missing may be downgraded to a warning in dev if configured, but hash-mismatch remains an error
- Errors include a remediation hint:
  - run migration planner to build an edge from DB marker to app contract
  - or re-emit types and Plans against the DB's current contract if the app is outdated

### Minor drift tolerances
- Only comment and description changes are considered minor and may be ignored if the profile declares them non-material
- Column default differences, index method changes, and nullability are material and must be reconciled by a migration

### Cross-environment examples
- Dev DB on Hdev, app built against Hhead → runtime refuses and instructs to plan and apply path Hdev → Hhead
- Prod DB on Hprod, CI planning Hprod → Hnew → preflight succeeds if path exists; release gates promotion on this status

## Concurrency and locks
- Marker updates are performed inside the transaction that applies an edge where possible
- The runner acquires an advisory lock before applying an edge and holds it until the marker is updated
- Reads do not take locks beyond default read consistency
- If transactional DDL is not available, the runner orders operations to minimize partial apply and re-reads the marker before updating to defend against concurrent writers

## Configuration

### Runtime
```typescript
createRuntime({
  contract,
  adapter,
  driver,
  verify: 'startup' | 'onFirstUse' | 'always',
  verifyCacheTtlMs?: number,
  markerLocator?: { schema?: string, centralized?: { schema: string, key: string } },
})
```

### Runner
```typescript
createRunner({
  adapter,
  adminDriver,
  ledger: { enabled: true },
  lock: { namespace: 'prisma-next', keyStrategy: 'per-database' }
})
```

## Performance
- Marker read is O(1) and amortized in startup and onFirstUse modes
- In always, the extra read adds sub-millisecond overhead on pooled connections on Postgres
- Cache TTL is configurable to trade freshness for fewer reads in high-throughput services

## Security
- The marker table should be owned by a role with DDL privileges
- Application roles require SELECT on `_prisma.signatures` only: the SQL client's check on first use reads the application space's row and never the policies
- Any role that runs Prisma's commands reads `_prisma.config` as well as `_prisma.signatures`, since the commands read the policies; the runner role also writes both tables and the ledger, and owns the `_prisma` schema, since a later release may change these tables
- No secrets are stored in the marker or ledger

## Alternatives considered
- **Storing the hash in database comments or extension metadata**: rejected due to portability and permission variability across vendors
- **Storing the hash outside the database in an app config store**: rejected because it breaks the invariant that the database can self-describe its contract
- **The policies under the application row's `meta`, in the marker**, as the release candidates did. Rejected on PostgreSQL: the policies govern every space in the database, so a row that belongs to one space is the wrong place for them, and a reader had to know which space's row held them.
- **The contract's JSON in the marker**, for drift analysis. Rejected: nothing read it, every writer wrote `NULL`, and a contract is large. Where contracts are kept, PostgreSQL's `_prisma.contract` keeps them once per hash.
- **Recording a full migration history as the source of truth**: retained as an optional ledger for audit, but the marker remains the authoritative state

## Consequences

### Positive
- Simple, fast verification with clear modes and minimal reads
- Unambiguous drift detection that agents and humans can reason about
- Works across environments and supports squashed baselines without special cases

### Trade-offs
- Requires creating a reserved schema/table in each target schema or a centralized control schema
- always mode adds a small per-query overhead and should be limited to CI and debug

### Runtime read-side behaviour (TML-2680)

The SQL runtime's marker read path no longer throws on hash mismatch or absent marker. Instead, on the first `execute()` call per runtime (unless `verifyMarker: false`), the runtime emits a structured `warn`-level log line with `code: 'CONTRACT.MARKER_MISMATCH'` or `code: 'CONTRACT.MARKER_MISSING'` and proceeds with the query. The check runs **once per runtime instance**; subsequent queries skip the marker read entirely. The marker write path and the explicit `db-verify` CLI verification surface are unchanged. Operators who need fail-fast verification should use `db-verify`; the runtime's role is a silent diagnostic during normal query execution.

Amended 2026-11-20: the read runs before the runtime's first use of the database: its first statement, or a connection taken to hold (by `connection()`, a transaction, or a subclass's raw connection such as a Supabase role session), whichever comes first. It always goes through the driver. Before, it ran at the first statement, when a caller could already hold a connection. On a pool with no connection to spare, the read then could not get one: a Supabase role-bound query waited for the connection it held itself, and on a PostgreSQL pool of one a first query's read and a first transaction waited for each other. The calls failed when the pool's connection timeout ended. A read that cannot reach the database still fails the call with `CONTRACT.MARKER_READ_FAILED`; only drift is a logged diagnostic.

## Testing
- Migration runner tests that marker is updated atomically with edge apply
- Runtime tests for each verification mode with and without cache
- Drift scenarios across schemas and tenants
- Adapter conformance tests for marker DDL and read APIs

## Open questions
- Optional replication of the marker to read replicas and how verification should behave on replicas
- Standardizing a minor drift whitelist beyond comments for specific adapters under strict guarantees
- PPg-specific UI for visualizing current marker, proposed edges, and promotion gates

## Related

- [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md) — promotes the marker from singleton to one-row-per-loaded-space.
- [ADR 208 — Invariant-aware migration routing](./ADR%20208%20-%20Invariant-aware%20migration%20routing.md) — `invariants` semantics on the marker.

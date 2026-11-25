# ADR 208 — Invariant-aware migration routing

## At a glance

A team member adds a `phone` column to `users`, wants to enforce `NOT NULL`, and wants production to route through a backfill before reaching the new contract. The migration declares the backfill as a routing-visible invariant via `invariantId`:

```ts
// migrations/20260424T1030_add_phone_notnull/migration.ts (schematic; query bodies elided)
import { col, Migration, MigrationCLI } from '@internal/postgres/migration';
import endContract from './end-contract.json' with { type: 'json' };

export default class AddPhoneNotNull extends Migration {
  override describe() {
    return { from: '…', to: '…' };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'users', column: col('phone', 'text') }),

      // Routing-visible — refs can require this invariant.
      this.dataTransform(endContract, 'Backfill users.phone', {
        invariantId: 'backfill-user-phone',
        check: () => /* … select users where phone is null */,
        run:   () => /* … update those rows to set phone   */,
      }),

      // Path-dependent cleanup; no invariantId, not addressable from refs.
      this.dataTransform(endContract, 'Trim trailing whitespace', {
        check: () => /* … */,
        run:   () => /* … */,
      }),

      this.setNotNull({ schema: 'public', table: 'users', column: 'phone' }),
    ];
  }
}
MigrationCLI.run(import.meta.url, AddPhoneNotNull);
```

Production declares which data invariants it requires by listing them on the ref:

```json
// migrations/refs/prod.json
{ "hash": "…", "invariants": ["backfill-user-phone"] }
```

`migrate --to prod` then routes through a path that provides the named invariant — applying the schema change *and* the backfill — and records `backfill-user-phone` on the marker on success. A second `migrate --to prod` against the same database short-circuits to a structural BFS, because marker subtraction empties the effective required set.

If the ref names an invariant that no migration in the graph provides *and* the marker has not already recorded it, the CLI fails with `MIGRATION.UNKNOWN_INVARIANT` before invoking the pathfinder. If the invariant exists but no path to the target hash covers it, the CLI fails with `MIGRATION.NO_INVARIANT_PATH` and shows the structural fallback path so the author can see why.

## Decision

### Identity: `name` for retry/ledger, `invariantId?` for routing

`DataTransformOperation` carries two distinct identifiers:

- **`name`** is human-readable and identifies the operation for retry / ledger purposes. Renaming it does not affect routing.
- **`invariantId?: string`** is optional. When set, the transform is *routing-visible* — refs may require that id, and the routing layer reasons about it. When unset, the transform is path-dependent and not addressable from refs.

The split lets a routing-relevant rename (`invariantId`) be a deliberate, reviewable change with a clear blast radius, while everyday display-text edits to `name` stay safe.

### Manifest aggregate: `providedInvariants`

A migration's manifest carries `providedInvariants: string[]` — the set of `invariantId`s declared by data transforms in its `ops.json`. The aggregate is derived from ops at emit time and re-derived from `ops.json` whenever a migration is loaded from disk; the load fails with `MIGRATION.PROVIDED_INVARIANTS_MISMATCH` if the manifest's stored aggregate disagrees with what the ops actually contain.

The aggregate is part of the manifest's content-addressed hash ([ADR 169](./ADR%20169%20-%20On-disk%20migration%20persistence.md) §3), so an edit to any `invariantId` ripples through the migration's identity.

### Edges carry invariants

`MigrationEdge.invariants` is populated from the manifest's `providedInvariants` at graph-reconstruction time. The graph layer never re-derives from ops — the manifest is the source of truth.

### Routing: `findPathWithInvariants` and `FindPathOutcome`

`findPathWithInvariants(graph, from, to, required)` is the invariant-aware extension of the structural BFS. Given a target hash and a set of required invariant ids, it returns the shortest path whose edges' `invariants` collectively cover `required`, or `null` if no such path exists. When `required` is empty it delegates to `findPath`, so non-invariant-aware callers see byte-identical behaviour.

`findPathWithDecision` wraps this primitive and returns a discriminated `FindPathOutcome`:

| `kind` | Meaning |
|---|---|
| `ok` | Path exists covering `required`; the decision carries selection metadata. |
| `unreachable` | No structural path `from → to` exists in the graph. |
| `unsatisfiable` | Structurally reachable, but no path covers every required invariant. The outcome carries `structuralPath` (the empty-required structural path, for diagnostics) and `missing` (required ids not covered on that fallback). |

The pathfinder owns the structural-fallback BFS for the unsatisfiable case. Callers consume `outcome.missing` and `outcome.structuralPath` directly when surfacing `MIGRATION.NO_INVARIANT_PATH` — they don't run a second BFS.

### Marker: applied-at-least-once, not currently true

`prisma_contract.marker` carries an `invariants` field — a set of ids that records which invariants have been successfully applied to this database at least once in its history.

The field is **set-semantic** and **monotonic**: every successful apply unions the migration's `providedInvariants` into it; no flow ever shrinks it. Two distinct authorities answer two distinct questions:

- The data transform's `check` answers *"does the data satisfy this invariant right now?"*
- The marker answers *"has a migration that provides this invariant been applied at least once?"*

These are not the same claim. The marker doesn't reverify the data on rollback or restoration; it records application history, which the data transform's `check` (re-run on every apply) reverifies separately when the data changes.

### Server-side merge for marker invariants

The marker write is atomic per storage family. No client-side compare-and-set loop on `invariants`:

- **Postgres** — the `UPDATE` uses a single self-referential expression that reads, unions, dedupes, and writes the column under the row lock:
  ```sql
  invariants = array(select distinct unnest(invariants || $N::text[]) order by 1)
  ```
- **MongoDB** — `findOneAndUpdate` with an aggregation pipeline (`$setUnion + $sortArray`); document-level atomic.
- **SQLite** — the runner reads, unions, and writes inside `BEGIN EXCLUSIVE`, sharing the migration's transaction. SQLite has no native text-array merge.

`invariants: []` on a write is a no-op merge — preserves the existing set, doesn't clobber.

### CLI marker subtraction makes `--to` idempotent

Before routing, `migrate --to` and `migration status --to` compute:

```
effectiveRequired = ref.invariants − marker.invariants
```

The pathfinder receives `effectiveRequired`, not `ref.invariants`. When all of a ref's invariants are already in the marker, `effectiveRequired` is empty and routing falls through to the structural BFS — second applies are byte-identical to non-invariant-aware behaviour.

### `MIGRATION.INVARIANTS_PENDING` covers the in-between

A database can be at the ref's structural target hash *and* missing invariants the ref requires (the migration was never run with this ref; ref was edited to add a new invariant; etc.). `migration status --to` surfaces this as an info diagnostic with code `MIGRATION.INVARIANTS_PENDING` rather than reporting "up to date" — the user is not at the desired state.

### `providedInvariants` flows through the plan envelope

`MigrationApplyStep.providedInvariants` carries the manifest's aggregate from the control-api boundary into the runner; runners read `options.plan.providedInvariants ?? []` for marker writes and self-edge no-op detection. There is no separate runner option for invariants — the manifest aggregate is the single source of truth, and the load-time integrity check (re-derive from ops + recompute the migration hash, both performed when the migration is read from disk) is what ensures the manifest agrees with the ops it claims to summarise.

Self-edges (data-only migrations against the same contract hash) are covered in [ADR 001 §Self-edges](./ADR%20001%20-%20Migrations%20as%20Edges.md); the routing-side rule is that a self-edge carrying a required invariant is a covering edge.

## Why the marker, not the ledger

The marker and the ledger answer different categories of question, and that distinction governs which one stores the applied-invariants set.

The **marker** is the database's own statement of what the framework has confirmed about it — a framework-issued *guarantee record*. `storageHash` and `profileHash` already record "this database is at contract C with capability profile P"; `invariants` extends the same record with "…and these named data-transform invariants have been applied." The runner is the only writer; the rest of the framework reads the marker to decide whether a plan is applicable, whether a ref is satisfied, and what work routing still has to do.

The **ledger** is an *audit artifact* — an append-only log of what happened, when, and by whom. Its lifecycle belongs to the user (compliance retention, log compaction, manual cleanup); the framework never assumes a particular row is still there.

Framework decisions about applicability and routing must never depend on the audit log. "These invariants have been applied" is a guarantee the framework provides about the database, so it belongs on the guarantee record. Reading it from a log the user is free to truncate would tie routing correctness to ledger retention policy — a category error.

## Performance

`findPathWithInvariants` searches breadth-first over states made of a node, the set of required invariants covered so far, and the rank of the last self-edge taken since arriving at the node, among that node's self-edges in tie-break order (`createdAt → to → migrationHash`), or `-1` if none. The dedup key is `JSON.stringify([node, [...covered].sort(), lastSelfEdgeRank])`.

Two rules keep the search small.

First, at a node the search takes self-edges only in ascending rank order, and only a self-edge that covers a still-needed invariant. Leaving the node resets the order.

Second, the search never enqueues a state that provably cannot reach the goal: its node does not reach the target, or for some invariant the state still lacks, it can no longer reach a migration providing the invariant on a route to the target. With the first rule, a self-edge the state has passed over is out of reach until the search leaves the node, so a state that passed over the only remaining provider of an invariant is dropped at once. For each required invariant the function computes two things up front: which nodes can still reach a provider after moving on to another node, and, at each node, the highest rank of a self-edge there that provides it. That is one reverse breadth-first search per required invariant plus a pass over the edges, `O(k · (V + E))` for `k` required invariants. Checking a state costs `O(k)`.

Neither rule changes the returned route. Breadth-first search with a fixed neighbour order returns the first shortest route in that order. Every route the new search can take is one the old search could take, and both sort neighbours by the same keys, so the new search returns the old answer as long as that answer is one of its routes. It is. The old answer obeys the first rule: if it took a self-edge before a lower-ranked one at the same node, the lower-ranked one is useful at the earlier point too, so swapping them gives a route that is no longer and comes earlier in the neighbour order. And no state on the old answer is pruned, because the rest of the old answer is a satisfying continuation that obeys the first rule. This depends on the rank order being the order in which the search explores useful neighbours, which is the tie-break order; a change to either must change the other. Comparing the old and new functions on several million small random graphs with cycles, runs of self-edges, shared providers and dead ends found no difference, and a seeded version of that comparison is part of the test suite.

This matters most for a fresh database catching up to a ref that lists many invariants, which is the normal case for CI and every new environment, not an edge case. Without these rules each self-edge that provides a required invariant doubles the number of states: on a chain of schema changes each followed by one backfill, and on one schema change followed by many backfills alike. Measured on a developer laptop:

| Shape | k | Before | After |
|---|---:|---:|---:|
| `k` schema migrations, each followed by one self-edge providing an invariant | 16 | 0.37 s, 310 MB | 3 ms, 110 MB |
| | 18 | 1.8 s, 594 MB | — |
| | 32 | did not finish | 2 ms, 106 MB |
| | 64 | — | 4 ms, 110 MB |
| | 1000 | — | 0.44 s, 230 MB |
| One schema migration, then `k` self-edges on its contract, each providing an invariant | 16 | 1.1 s | 6 ms, 108 MB |
| | 18 | 5.2 s, 490 MB | — |
| | 32 | did not finish | 7 ms, 112 MB |
| | 64 | — | 9 ms, 112 MB |
| | 1000 | — | 2.0 s, 253 MB |
| Schema migrations each followed by four self-edges providing an invariant | 64 | did not finish | 8 ms, 110 MB |
| | 1000 | — | 0.25 s, 192 MB |

The reporter of the bug saw planning exceed 12 GB of memory on their own history with 32 such invariants. After the change, memory at the sizes real histories have is the Node process baseline. Cost still grows faster than the graph when `k` grows with it: with `k²` on the chain shape and with `k³` when many self-edges share one contract, because each of a node's self-edges is tried, and checked against every invariant, from each state at that node. That is seconds only at about a thousand invariants. In steady state `effectiveRequired` is usually empty or holds one new invariant, and routing costs a few breadth-first searches of the graph, about 1 ms on a 1000-migration chain.

The worst case is still exponential in `k`. The rules drop a state only when an invariant it lacks has become unobtainable. When the invariants a state lacks can each still be obtained some other way, every combination stays alive, and finding the shortest path that covers a set of labels is NP-hard in general. That happens when alternative routes each provide a different subset of the required invariants, and when an invariant has a second provider the search can still reach: for example `k` self-edges on one contract whose invariants a later migration on the route also provides, so each of them is optional. Measured before this change, `branchy(spine=1000, density=0.05)` took about 80 ms at `k = 8` and 8.7 s at `k = 16`. A shape built so that pruning removes nothing (`k` optional branches off a 1000-node spine, each providing one invariant, plus a final migration providing all of them) took 9.0 s before pruning and 10.3 s after at `k = 14`. The optional self-edge shape above, with the providing migration at the end of a route as long as the run of self-edges, takes 1.9 s and 630 MB at `k = 16`, about as long as before. The algorithm has no refusal threshold. If real histories reach these shapes with large `k`, a different search (heuristic A* or dominance pruning) would replace this one.

## Alternatives considered

### Ledger-side storage of the applied-invariants set

Record `(migrationId, invariants)` per applied ledger row, derive the applied set by reading the ledger.

Rejected because:

- Routing would depend on a writable, user-owned audit log (the principled objection — see "Why the marker, not the ledger").
- Requires a new ledger-read SPI surface across both storage families.
- Drags MongoDB's ledger up to parity with the SQL ledger, which is its own workstream.
- Pays for per-migration provenance — a real benefit — that the routing layer doesn't consume.

The principled objection stands even if the surface costs were already paid. Per-migration provenance is a separable feature: the ledger can grow it later as audit data without becoming the source of truth for routing.

### Graph-derived snapshot of the applied-invariants set

Compute the applied set on the fly by walking `root → marker` in the graph and unioning declared `providedInvariants` from each edge.

Rejected as correctness-breaking. It assumes the database actually traversed every edge on the structural root-to-marker path. The `db update` flow (which advances the marker without going through migrations) violates that assumption: any graph-derived applied set would over-claim invariants the database has never actually been subjected to.

### A separate runner option channel for invariants

Have the runner accept invariants through an option (e.g. `MigrationRunner.execute({ invariants })`), independent of the manifest.

Rejected because the manifest's `providedInvariants` is the canonical source and the load-time integrity check already enforces consistency between the aggregate and the ops it claims to summarise. A parallel option channel adds a second source of truth for a property the framework already guarantees, and a "forgot to thread the option" footgun on top.

## Related

- [ADR 001 — Migrations as Edges](./ADR%20001%20-%20Migrations%20as%20Edges.md) — self-edge rules.
- [ADR 021 — Contract Marker Storage](./ADR%20021%20-%20Contract%20Marker%20Storage.md) — the marker's role as guarantee record.
- [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20&%20integrity.md) — `findPathWithInvariants` algorithm details.
- [ADR 169 — On-disk migration persistence](./ADR%20169%20-%20On-disk%20migration%20persistence.md) — manifest hash coverage and ref structure.
- [ADR 176 — Data migrations as invariant-guarded transitions](./ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md) — conceptual model.
- [ADR 192 — ops.json is the migration contract](./ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) — `invariantId` round-trip through the op schema.

## Decision record

`invariantId` is the opt-in routing key on data transforms; the marker stores the monotonic union of applied invariants via storage-family-atomic merge; `findPathWithDecision` discriminates `unreachable` from `unsatisfiable`; the CLI computes `effectiveRequired = ref.invariants − marker.invariants` before routing; and the manifest's `providedInvariants` is the single source of truth, threaded into runners through the plan envelope and verified at load time.

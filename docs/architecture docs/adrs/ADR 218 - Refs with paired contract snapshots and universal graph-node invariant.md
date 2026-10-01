# ADR 218 — Refs with paired contract snapshots and universal graph-node invariant

## Status

**Accepted** — closes the dev → ship transition trap tracked in [TML-2629](https://linear.app/prisma-company/issue/TML-2629/dev-ship-transition-broken-first-migration-plan-after-db-update).

The **paired contract snapshot** part of this decision (a ref carrying its own `<name>.contract.json` / `<name>.contract.d.ts` copy) was folded into the shared content-addressed store introduced by [ADR 240](ADR%20240%20-%20Contract%20snapshots%20live%20in%20a%20content-addressed%20store.md) (TML-3072). A ref is now only its pointer file (`{hash, invariants}`); the contract bytes it names resolve through `migrations/snapshots/<hex>/contract.{json,d.ts}` by that hash, the same store every graph node resolves through. The **universal graph-node invariant** and **asymmetric ref-advancement** decisions below are unaffected and remain current. `db sign` was later added to the implicit-advancement set (see the row in the table under *Asymmetric ref-advancement*); unlike `db init` / `db update`, its `--db` flag does not suppress the advancement; `--no-advance-ref` skips it.

## Context

Prisma Next's migration workflow is deliberately Git-shaped: named **refs** point at contract hashes, the on-disk **migration graph** records committed edges between hashes, and the live database **marker** records which hash the database was last brought up to. In healthy operation those three views agree. In the dev-shaped loop — iterate locally with `db init` / `db update`, then publish with `migration plan` and `migrate` — they can drift apart with no precise diagnostic.

The failure mode that motivated this ADR is the **dev → ship transition trap** (TML-2629). A typical dev → ship transition reproduction looks like this:

1. `db init` stamps the database and advances local dev state to contract hash **H_A**; the migration graph is still **empty**.
2. The developer edits the schema and runs `contract emit` → **H_B**, then `db update` → marker **H_B**, still with an **empty graph**.
3. Another edit → **H_C**; `migration plan` (defaulting `from` to the `db` ref at **H_B**) emits a single bundle `from=H_B, to=H_C`.
4. `migrate` refuses: **H_B** is not a node in the on-disk graph, so no path exists from the marker to **H_C**.

The symptom is an **unapplyable migration** produced at plan time — the worst class of failure because the bad artefact is already on disk and headed for git. Secondary symptoms made recovery harder: drift between the local DB, the on-disk graph, and the live marker surfaced only as generic path-unreachable errors without naming which view was authoritative or what to run next.

Three architectural choices are coupled here. Splitting them across separate ADRs would obscure why they land together: paired ref snapshots exist so the **offline** planner can diff against dev-state hashes that are not yet graph nodes; the universal graph-node invariant ensures every *committed* edge is structurally coherent; asymmetric ref-advancement keeps production-shaped commands explicit while dev-shaped commands remain ergonomic. This ADR records all three as one decision.

See also the [Migration System subsystem doc](../subsystems/7.%20Migration%20System.md) for per-command behaviour and recovery affordances.

## Decision

### (1) Refs are stored with paired contract snapshots

Each on-disk ref `<name>` is a **pointer file** plus a **paired contract snapshot**:

```text
migrations/app/refs/
├── db.json                 # { "hash": "…", "invariants": [] }
├── db.contract.json        # full contract IR at that hash
└── db.contract.d.ts        # TypeScript handle for the snapshot
```

The pointer shape is unchanged from [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md). The snapshot mirrors the convention migration bundles already use for `end-contract.json` / `end-contract.d.ts` ([ADR 197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md)): the same pattern applied to refs.

**Write rule:** whenever a ref is written or changed, its paired snapshot is written or refreshed in the same logical operation. Whenever a ref is deleted, the paired snapshot is deleted in the same step. No stale ref contracts.

**Atomic paired primitives** implement this rule. `writeRefPaired` writes the snapshot files first, then the pointer; on pointer failure it rolls back the snapshot. `deleteRefPaired` removes pointer and snapshot together and tolerates orphan halves (pointer without snapshot, or the reverse) so recovery commands can heal partial states.

```74:165:packages/1-framework/3-tooling/migration/src/refs/snapshot.ts
export async function writeRefSnapshot(
  refsDir: string,
  name: string,
  snapshot: ContractIR,
): Promise<void> {
  // … atomicWriteFile for .contract.json and .contract.d.ts …
}

export async function writeRefPaired(
  refsDir: string,
  name: string,
  entry: RefEntry,
  snapshot: ContractIR,
): Promise<void> {
  await writeRefSnapshot(refsDir, name, snapshot);
  try {
    await writeRef(refsDir, name, entry);
  } catch (writeError) {
    try {
      await deleteRefSnapshot(refsDir, name);
    } catch {
      // Rollback failure is secondary; preserve the original writeRef error.
    }
    throw writeError;
  }
}
```

**Who writes paired snapshots:**

| Writer | Snapshot source |
|---|---|
| `db init` / `db update` (with ref advancement) | Contract IR already in hand at command completion |
| `migrate --advance-ref <name>` | Post-apply contract (or bundle `end-contract` when `--to` is a ref) |
| `ref set <name> <hash>` | Synthesised from the migration bundle whose `to == <hash>` (`end-contract.json` / `.d.ts`) |

**Read rule for the planner:** when `from` resolves via a ref name, the planner reads `<name>.contract.json` directly. No fallback chain, no live-DB read. If the snapshot is missing, the command refuses with `MIGRATION.SNAPSHOT_MISSING` (see § (2)).

### (2) Universal "from must be a graph node" invariant

Any hash that participates as a **`from` end** — whether supplied explicitly (`--from`), resolved implicitly (default `db` ref), or set via `ref set` — must be a **node in the on-disk migration graph**, or the operation refuses with a structured diagnostic.

A **graph node** is a contract hash that appears as the `from` or `to` of any on-disk migration bundle, or the `null` empty-graph sentinel (`empty`). A hash that is valid on its own but appears in no bundle is *not* a graph node. That distinction is load-bearing: it is exactly the condition that made the single-bundle plan in the reproduction above impossible to apply.

Enforcement is centralized in `isGraphNode` / `assertHashIsGraphNode`:

```5:17:packages/1-framework/3-tooling/migration/src/graph-membership.ts
export function isGraphNode(hash: string, graph: MigrationGraph): boolean {
  if (hash === EMPTY_CONTRACT_HASH) {
    return true;
  }
  return graph.nodes.has(hash);
}

export function assertHashIsGraphNode(hash: string, graph: MigrationGraph): asserts hash is string {
  if (isGraphNode(hash, graph)) {
    return;
  }
  throw errorHashNotInGraph(hash, graph);
}
```

**Plan-time enforcement** lives in `resolveFromForPlan` (`cli/src/utils/plan-resolution.ts`). After resolving `from` to a hash and materialising its contract (from a paired snapshot or a bundle `end-contract`), a non-empty graph triggers `assertFromIsGraphNode`. Failure maps to `MIGRATION.HASH_NOT_IN_GRAPH` with reachable ref names — the "forgot-the-flag" diagnostic when the `db` ref points past the graph tip.

**Apply-time enforcement** is complementary: `migrate` reads the live marker before DDL and refuses with `MIGRATION.MARKER_MISMATCH` when the marker hash is not a graph node — catching drift the planner cannot see offline.

**The one well-defined exception — auto-baseline emission:** when the migration graph is **empty** and `from` resolves to a **non-null** hash with an available paired snapshot (typical: default `db` ref after `db update`), `migration plan` emits **two** bundles instead of refusing:

1. Baseline: `null → from-hash` (introduces `from-hash` as a graph node)
2. Delta: `from-hash → current_contract`

By the time downstream checks run, the baseline bundle has materialised the `from` hash on disk. This is the mechanism that closes the dev → ship transition trap without requiring a separate `--baseline` command or a live-DB connection at plan time.

`ref set` enforces the same invariant: the hash being set must be a graph node; the command synthesises the paired snapshot from the matching bundle's `end-contract` files.

**Sibling invariant for `migrate --to`:** Target reachability is separate from the universal `from`-membership rule above. `migrate --to <ref-or-hash>` requires a path from the live marker to the target in the on-disk graph; path resolution refuses with `MIGRATION.PATH_UNREACHABLE` when none exists. At apply time, the live DB marker is the implicit `from` of the apply — it must be a graph node, checked before the runner executes DDL (`MIGRATION.MARKER_MISMATCH`). During the runner's graph walk, `MIGRATION.MARKER_NOT_IN_HISTORY` fires when the marker is not on the path being traversed — a complementary check at a different layer, not a restatement of the plan-time `from` invariant.

### (3) Asymmetric ref-advancement

Ref advancement is **implicit** for dev-shaped reconciliation commands and **opt-in** for production-shaped commands.

| Command | Default ref advancement | Override |
|---|---|---|
| `db init` | Advances `db` when `--db` is omitted (project default URL) | `--advance-ref <name>` |
| `db update` | Same | `--advance-ref <name>`; **no** implicit advance with any explicit `--db` (even one naming the default URL) unless `--advance-ref` is explicit |
| `migrate` | **None** | `--advance-ref <name>` only |
| `ref set` | Sets `<name>` (always explicit) | N/A — user names the ref |
| `db sign` (added after this ADR) | Advances `db` whether or not `--db` is given — sign never mutates the schema, and adoption normally names the database with `--db`; `--no-advance-ref` skips it | `--advance-ref <name>`; `--no-advance-ref` |

The default name selection for `db init` and `db update` is implemented in `computeRefAdvancementName`; `db sign` does not go through it — the sign command picks `--advance-ref <name>` if given, else `db`:

```25:36:packages/1-framework/3-tooling/cli/src/control-api/operations/ref-advancement.ts
export function computeRefAdvancementName(options: {
  readonly advanceRef?: string;
  readonly db?: string;
}): string | null {
  if (options.advanceRef !== undefined) {
    return options.advanceRef;
  }
  if (options.db === undefined) {
    return 'db';
  }
  return null;
}
```

**Rationale:** `db init` and `db update` exist to reconcile the **project dev database** with the emitted contract. Advancing a local ref (default `db`) is part of what those commands *mean*. `migrate` is generic — deploy, CI apply, rollback rehearsal — and must not infer dev-state intent. A plain `migrate` leaves the `db` ref unchanged; the live marker advances while the ref may lag until the developer runs `db update` (no-op on DB when already current) or `migrate --advance-ref db`.

`db` is a **default name**, not a reserved or magic ref. The framework overwrites `db` on the next dev cycle; users may `ref set db <hash>` and accept that a subsequent `db update` replaces it. No ref names are protected.

## Consequences

### Positive

- **Dev → ship transition trap closed.** Empty graph + non-null `db` ref + paired snapshot → auto-baseline two-bundle output; `migrate` finds a path `null → H_B → H_C` and applies the delta while the baseline is idempotently satisfied.
- **Plans can be applied by construction** for the dev → ship loop: every emitted `from` either was already a graph node or is introduced by the baseline bundle in the same plan invocation.
- **Offline planner preserved.** No `migration plan` code path opens a database connection to read the marker; drift signal comes from on-disk refs + snapshots + graph membership.
- **Discoverable recovery.** Plan-time `MIGRATION.HASH_NOT_IN_GRAPH` and `MIGRATION.SNAPSHOT_MISSING`, apply-time `MIGRATION.MARKER_MISMATCH`, and improved `MIGRATION.PATH_UNREACHABLE` payloads name both hashes and suggest concrete next commands (`migration plan --from <reachable>`, `ref set db <marker-hash>`, `db update --advance-ref <name>`).
- **Uniform ref namespace.** Framework and user refs share one shape; `db` is not special-cased in storage, only in default advancement rules for dev commands.

### Negative

- **Extra on-disk files** per ref (two snapshot siblings). Acceptable for the safety of atomic paired writes and offline planning.
- **`db` ref staleness after plain `migrate`.** Accepted; apply-time drift checks and an explicit `db update` or `migrate --advance-ref db` are the remediation.
- **Two-bundle visibility.** Auto-baseline shows two directories in `git status` before commit — intentional transparency, not silent graph extension.

### Neutral

- **Paired snapshot size** tracks contract IR size; same order of magnitude as per-migration `end-contract.json` snapshots teams already commit.
- **`ref list` / `readRefs`** must ignore `*.contract.json` basename patterns so snapshots do not appear as phantom refs (enforced at the tools layer).
- **Legacy `writeRef` / `deleteRef`** remain for internal compatibility; all CLI ref writes go through paired primitives.

## Alternatives considered

### Implicit `db` ref advancement on `migrate`

**Rejected.** Would make `db` behave like a magic reserved ref and blur the boundary between "apply migrations" and "record dev iteration state." Production-shaped commands must be explicit; dev-shaped commands own the implicit default.

### `migration plan` connecting to the DB to read the marker

**Rejected.** Breaks the offline-planner invariant: once plan time opens a connection, future features will expand the read surface. The on-disk `db` ref + paired snapshot achieves the same outcome without coupling planning to runtime infrastructure ([NFR: planner stays offline](ADR%20169%20-%20On-disk%20migration%20persistence.md)).

### First-time-only baseline (refuse `--from` past graph tip after the first migration)

**Rejected.** Long-running projects routinely pass `--from production` (or similar) when the `db` ref has moved ahead of the graph tip. That is a valid explicit workflow; the forgot-the-flag refuse-with-hints path handles the *implicit* default case without blocking explicit `--from`.

### Generalised catch-up emission whenever `from` is off-graph

**Rejected.** Would silently emit bundles the user did not intend when they forgot to pass `--from <graph-node>`. Auto-baseline is scoped strictly to **empty graph + non-null ref-resolved `from` with snapshot**.

### Reserved / protected `db` ref name

**Rejected.** Users own refs; the framework overwrites `db` only when dev commands run with the default advancement rules. Protection-from-self adds complexity without matching how other refs behave.

### Per-ref directory layout (`refs/<name>/ref.json` + `contract.json`)

**Rejected for this scope.** Would migrate existing flat `<name>.json` refs in projects that already use the surface. Re-evaluate if refs accumulate more paired artefacts.

## Relation to existing ADRs

| ADR | Relationship |
|---|---|
| [197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md) | Paired ref snapshots apply the same snapshot-copy pattern at the ref layer. |
| [198 — Runner decoupled from driver via visitor SPIs](ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) | Apply-time marker-vs-graph drift check (`MIGRATION.MARKER_MISMATCH`) lives in the CLI before the runner executes DDL — not in the runner package. |
| [199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md) | Graph-node identity is by `storageHash` appearing in bundle `from`/`to` bookends; ref pointers store the same hash vocabulary. |
| [169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md) | Ref file layout and version-control expectations. |
| [039 — Migration graph path resolution & integrity](ADR%20039%20-%20Migration%20graph%20path%20resolution%20&%20integrity.md) | Pathfinding and `MIGRATION.PATH_UNREACHABLE`; improved CLI `fix` text is additive. |
| [021 — Contract Marker Storage](ADR%20021%20-%20Contract%20Marker%20Storage.md) | Live DB marker semantics that `migrate` compares against the on-disk graph. |
| [123 — Drift Detection, Recovery & Reconciliation](ADR%20123%20-%20Drift%20Detection,%20Recovery%20&%20Reconciliation.md) | Taxonomy for drift types; this ADR adds plan-time and pre-apply CLI diagnostics. |

## References

- [Migration System subsystem doc](../subsystems/7.%20Migration%20System.md) — command-level behaviour, `--advance-ref`, recovery affordances
- Implementation: `packages/1-framework/3-tooling/migration/src/refs/snapshot.ts`, `graph-membership.ts`; `packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts`, `ref-advancement.ts`, `cli-errors.ts`
- Linear: [TML-2629](https://linear.app/prisma-company/issue/TML-2629/dev-ship-transition-broken-first-migration-plan-after-db-update)

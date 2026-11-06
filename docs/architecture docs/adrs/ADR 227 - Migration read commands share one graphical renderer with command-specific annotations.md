# ADR 227 — Migration read commands share one graphical renderer with command-specific annotations

## Status

Accepted. Builds on [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) and [ADR 218 — Refs with paired contract snapshots](./ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md).

## A worked example

A contract space has two migrations: `init` brings the empty contract to `ef9de27`, and `add_email` brings `ef9de27` to `a94b7b4`. The database is sitting at `ef9de27`; the app currently emits `a94b7b4`.

Three commands let you look at that state, and they all draw the *same* picture — contracts as `○` nodes, migrations as labelled edges, newest at the top, the empty contract at the bottom:

```text
migration graph                migration list                 migration status
─────────────────              ─────────────────              ─────────────────
○   a94b7b4  (@contract)        ○   a94b7b4                    ○   a94b7b4  (@contract)
│↑  add_email                   │↑  add_email   2 ops          │↑  add_email   ⧗ pending
○   ef9de27  (@db)              ○   ef9de27                    ○   ef9de27  (@db)
│↑  init                        │↑  init        1 op           │↑  init        ✓ applied
○   ∅                           ○   ∅                          ○   ∅
```

The skeleton is identical. What differs is what each command *writes onto* it: `graph` labels the ref/marker nodes, `list` annotates each edge with its package facts (operation counts, invariants), and `status` annotates each edge with whether it has run against the live database.

## Decision

There is one graphical renderer for migration topology. `migration list`, `migration graph`, and `migration status` all call it. They differ only in the per-migration annotations they hand it — never in how the tree itself is laid out.

The renderer takes the graph topology and produces the lane geometry, the gutter, and the node placement entirely from the topology. Everything command-specific arrives as a sparse annotation map:

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-labels.ts
export interface MigrationEdgeAnnotation {
  readonly status?: 'applied' | 'pending';
  readonly operationCount?: number;
  readonly invariants?: readonly string[];
  readonly pathHighlight?: 'on-path' | 'off-path';
}
```

A command builds a `ReadonlyMap<string, MigrationEdgeAnnotation>` keyed by `migrationHash`, populates only the keys it cares about, and passes it to the renderer. The renderer draws whatever keys are present and leaves the rest of the row plain.

## How it works

### The annotation map is sparse and additive

Each command owns a disjoint slice of `MigrationEdgeAnnotation`:

- **`migration graph`** adds no edge annotations. It annotates *nodes* — refs and the `@contract`/`@db` markers.
- **`migration list`** sets `operationCount` and `invariants` (the facts about each migration package on disk), plus ref node overlays.
- **`migration status`** sets `status: 'applied' | 'pending'` on each edge, plus the `@db` node marker.
- **`migrate --show`** sets `pathHighlight: 'on-path' | 'off-path'`, which the renderer draws as a focus mode — the chosen path bright, everything else dimmed.

Because every command writes only its own keys, their annotations compose without conflict: `migration status` overlays its applied/pending information on top of the list's package facts by merging the two maps before rendering.

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-space-render.ts
export function mergeMigrationEdgeAnnotations(
  listOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
  statusOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
): ReadonlyMap<string, MigrationEdgeAnnotation>
```

Adding a new kind of annotation later is a matter of adding a field; commands that don't set it are unaffected.

### The trunk is always the live contract

A space's history is rarely a single line — branches, abandoned chains, and refs pointing at older states all coexist. The renderer has to choose which chain runs straight up the left as the trunk and which render as indented side-branches.

That choice is fixed: the trunk is the chain containing the **live contract** — the contract the app currently emits, the same one `migrate` advances toward when you give it no target. It is supplied to the renderer as `liveContractHash`:

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-space-render.ts
export interface RenderMigrationGraphSpaceTreeInput {
  readonly liveContractHash: string;
  readonly isAppSpace?: boolean;   // default true; false suppresses @contract in extension spaces
  // …
}
```

Anchoring on the live contract makes the picture mean "where the app's code thinks the schema is" — the reference frame an author actually works in. All three commands pass the same `liveContractHash`, so a given space looks the same whichever command drew it. The rule is not configurable.

### Node markers

Two reserved markers sit on contract nodes:

- **`@contract`** — the live working contract. It only appears in the application space; extension spaces have no working contract of their own, so passing `isAppSpace: false` suppresses it.
- **`@db`** — the database's current position. It is per-space and appears wherever a database is connected.

Both render in sigil form (`@contract`, `@db`) in the tree and in `--legend` output, and those are exactly the tokens `--from`/`--to` accept — the graph shows you what you're allowed to type.

### Every space, by default

All three commands render every on-disk contract space, each as its own section with its own tree. `--space <id>` narrows to one. Per-space headings appear only when more than one space is present. Contract spaces are independent histories with no cross-space topology, so this is N independent trees, not one combined graph.

### Applied vs pending

`migration status` is the only command whose annotation depends on live database state. It reads the apply ledger ([ADR 228](./ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md)) and classifies each edge:

- **applied** — the ledger has an entry for this migration's `migrationHash`. Drawn green, `✓ applied`.
- **pending** — on the shortest path from the database's current contract to the live contract, and not yet applied. Drawn yellow, `⧗ pending`.

Everything else is on disk but neither applied nor on the current path, and renders plain.

### Human picture, flat machine output

The tree is for people. `--json` output is per-command and flat, shaped for tooling rather than for reading:

- `migration list --json` → a flat array of migration packages.
- `migration graph --json` → `{ nodes, edges }`, the deduplicated contract topology.
- `migration status --json` → the list shape plus a per-migration `status` field.

The tree is never part of machine output. The tree is a human block on stderr; a pipe receives the command's tab-separated data lines on stdout, and `--json` gives the JSON shapes above. The data lines follow the same relationship as the JSON: `migration status` prints the `migration list` fields plus `status` as the last field.

## Consequences

- **One renderer to maintain.** Improvements to layout, lane colouring, gutter, and label formatting land for all three commands at once.
- **The trunk is uniform.** No command can drift onto a different trunk rule without changing the renderer itself.
- **Machine output is independent of the picture.** `--json` consumers are unaffected by any change to graphical rendering.
- **`list` and `graph` remain separate commands** even though their human output looks alike — see below.

## Alternatives considered

- **Two renderers in parallel** — a force-directed graph for `graph`/`status` and a tree for a subset. Rejected. When the same data is drawn by two engines they drift: in practice the two picked different trunks (one the live contract, one a historical ref), so the same space looked different depending on which command you ran, and every visual change had to be made twice.

- **Merge `list` and `graph` into one command.** Rejected. Their machine output is durably different — `list` emits the faithful on-disk package inventory (every package, including parallel and disconnected edges) while `graph` emits the deduplicated `{ nodes, edges }` topology — and they answer different questions ("what migration packages are on disk?" versus "what contract topology do they describe?"). Sharing a human picture does not make them one command.

- **A separate annotation type per command** instead of one shared interface. Rejected in favour of a single additive map. Per-command types would force the renderer to accept a union and lose the simple "draw the keys that are present" semantics that makes annotations compose.

- **A configurable trunk (`--trunk <ref>`).** Deferred, not rejected. Locking a single rule — live contract is the trunk — was the priority; a user-selectable trunk can be added later as a pure extension without disturbing the default.

## References

- [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) — the graph model and path computation this renderer visualizes.
- [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](./ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) — refs rendered as node overlays.
- [ADR 228 — Migration apply ledger is a per-migration journal](./ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md) — the ledger that backs the `status` applied/pending overlay.
- [ADR 229 — Migration graph renderer uses a line/plane/occlusion model](./ADR%20229%20-%20Migration%20graph%20renderer%20uses%20a%20line-plane-occlusion%20model.md) — how the shared renderer is built internally.

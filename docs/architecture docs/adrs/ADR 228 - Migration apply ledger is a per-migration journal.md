# ADR 228 — Migration apply ledger is a per-migration journal

## Status

Accepted. Builds on [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) and [ADR 021 — Contract marker storage](./ADR%20021%20-%20Contract%20Marker%20Storage.md).

## A worked example

Someone applies two migrations to a database, decides the second was wrong, reverts it, then re-applies it. `migration log` shows exactly that, one row per thing that happened:

```text
APPLIED AT                   MIGRATION       FROM → TO            OPS
2026-06-02 16:37:31 +02:00   init            ∅ → ef9de27         1
2026-06-02 16:38:02 +02:00   add_email       ef9de27 → a94b7b4   2
2026-06-02 16:40:11 +02:00   revert_email    a94b7b4 → ef9de27   2
2026-06-02 16:41:55 +02:00   add_email       ef9de27 → a94b7b4   2
```

Each row is one applied migration edge: which migration ran, what contract it moved the database from and to, when, and how many operations it carried. `add_email` appears twice because it ran twice — the journal records events, not a set of "migrations that exist." Reading the `from → to` column top to bottom replays the database's actual path.

## Decision

The apply ledger is a per-migration journal: every `migrate` run appends **one row per applied migration edge**. Two read commands consume it — `migration status`, to tell which migrations have run against the live database, and `migration log`, to show the apply history.

A row is self-contained:

```ts
// packages/1-framework/0-foundation/contract/src/types.ts
export interface LedgerEntryRecord {
  readonly space: string;
  readonly migrationName: string;   // directory name of the migration package
  readonly migrationHash: string;
  readonly from: string | null;     // null for the baseline (empty-database) edge
  readonly to: string;
  readonly appliedAt: Date;
  readonly operationCount: number;
}
```

The ledger is append-only. Each row is written as its edge is applied, in walk order, inside the same per-space transaction as the migration itself, so the journal and the schema change commit together. `operationCount` is captured from the migration at write time, so a row needs no other source to be read.

## How it works

### Reading the ledger

The ledger is exposed as a single read-only primitive on the control-family instance, alongside the other marker reads:

```ts
// packages/1-framework/3-tooling/cli/src/control-api/types.ts
readLedger(space?: string): Promise<readonly LedgerEntryRecord[]>
```

Pass a `space` to read one space's rows; omit it to read every space's rows in one call. The two consumers use it differently, and that difference drives the optional argument.

### `migration status` — applied and pending

`status` calls `readLedger` per space and classifies each migration on the graph against the live database:

- **applied** — a ledger row exists carrying this migration's `migrationHash`. A migration that was reverted and re-applied still counts as applied; "applied" means "has ever run," and the full back-and-forth lives in `log`.
- **pending** — the migration is on the shortest path from the database's current contract to the live contract, and it is not applied. These are the migrations a plain `migrate` would run next.

Everything else is on disk but neither applied nor on the current path, and renders plain. (`status` feeds this classification into the shared tree renderer as an edge annotation — see [ADR 227](./ADR%20227%20-%20Migration%20read%20commands%20share%20one%20graphical%20renderer%20with%20command-specific%20annotations.md).)

Matching on `migrationHash` is what makes per-migration `status` possible: a journal with one row per edge can answer "did *this* migration run?"; a coarser record cannot.

### `migration log` — the flat history

`log` calls `readLedger()` with no space argument, gets the whole table, and renders it as the flat, time-ordered list shown above. It is the one read command that does **not** draw the tree — and deliberately so. The same edge can recur (apply → revert → re-apply), and a tree, which places each contract at one node, cannot represent the same edge appearing several times. A table can, so `log` uses one.

Rows sort by `appliedAt` ascending, with `space` then `migrationName` breaking ties. There is no `--space` flag and no per-space sections; a `Space` column appears only when more than one space contributes rows. `log` does not label rows as apply / revert / re-apply — the `from → to` direction and the repetition carry that meaning to the reader without the command having to do graph analysis on top of a database read.

`log` reads `migrationName` straight from the ledger row, never from disk, so a migration package deleted after it was applied still shows in the history under its original name.

Timestamps follow one rule: machine output is timezone-stable, human output is local. `--json` always emits ISO-8601 UTC (`2026-06-02T14:37:31.000Z`). Human/TTY output renders in the local timezone with offset (`2026-06-02 16:37:31 +02:00`); `--utc` switches the human output to UTC. A piped `log` prints data lines whose applied-at field is the same ISO-8601 UTC timestamp, so a script reads UTC whether or not it passes `--json`.

### Cross-target parity

Every adapter implements the same `readLedger(space?: string)` signature and returns the same `LedgerEntryRecord` shape, so `status` and `log` are written once against the interface and behave identically across targets. With `space` omitted, an adapter returns its full table unfiltered.

## Consequences

- `readLedger` is a pure read on the control-family instance, beside `readMarker` / `readAllMarkers`; it carries no write side-effects.
- `migration log` is online-only — the database is the source of truth for apply history; it never reconstructs the timeline from on-disk state.
- `operationCount` is denormalized onto the row to keep the journal self-contained. Only `migrationName` / `migrationHash` / `from` / `to` / `appliedAt` are needed by `status` and `log`, so heavier fields can be made opt-in later without changing either consumer.
- The ledger has no schema-migration path: a database whose ledger is in any other shape is not read; the next `migrate` writes rows in this shape.

## Alternatives considered

- **Reconstruct apply history from on-disk state** by walking `findPath(∅ → marker)`. Rejected. In a branching history the reconstruction can pick the wrong branch, and it conflates a migration's *creation* time with its *apply* time. Only the ledger records what actually ran, and when.

- **One collapsed row per `migrate` invocation**, spanning the whole walked path from origin to destination. Rejected. It cannot answer per-migration questions — `status` can't tell whether one specific migration ran — and it cannot represent the order of the individual edges within a single run, which is exactly what `log` exists to show.

- **A tree view for `log`.** Rejected. `log` reports events over time, and the same edge can occur repeatedly; a tree pins each contract to a single node and cannot show repetition. A flat table is the honest representation of a journal.

## References

- [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) — the graph walk that produces the edge sequence written to the ledger.
- [ADR 021 — Contract marker storage](./ADR%20021%20-%20Contract%20Marker%20Storage.md) — the database marker that provides `status`'s origin contract hash.
- [ADR 227 — Migration read commands share one graphical renderer with command-specific annotations](./ADR%20227%20-%20Migration%20read%20commands%20share%20one%20graphical%20renderer%20with%20command-specific%20annotations.md) — how the ledger-derived applied/pending overlay reaches the renderer.

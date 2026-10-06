# ADR 240 — Contract snapshots live in a content-addressed store

Status: **Accepted**.

Amends: [ADR 197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md), [ADR 232 — A migration is authored against its start and end contract snapshots](ADR%20232%20-%20A%20migration%20is%20authored%20against%20its%20start%20and%20end%20contract%20snapshots.md).

Related: [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md), [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md).

## Decision

Every distinct migration contract is stored exactly once per migrations root, in a content-addressed store at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`, where `<hex>` is the contract's `storage.storageHash` (bare 64-hex since [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md)'s 2026-07 revision dropped the `sha256:` prefix). A migration package directory carries only `migration.ts`, `migration.json`, and `ops.json` — its bookend contracts resolve through the store by hash, not from files inside the package. Per-package sibling copies (`start-contract.*` / `end-contract.*`) and per-space head copies (`migrations/<space-id>/contract.*`) no longer exist.

A rendered `migration.ts` imports the store directly:

```ts
#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as Start } from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract';
import startContract from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/6b4636f85cc2d7b2f8d4a70bd2c520246b4bbe786aa55d3b77592fae5c4d458f/contract';
import endContract from '../../snapshots/6b4636f85cc2d7b2f8d4a70bd2c520246b4bbe786aa55d3b77592fae5c4d458f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

matching the on-disk layout:

```text
migrations/
  snapshots/
    6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/
      contract.json
      contract.d.ts
    6b4636f85cc2d7b2f8d4a70bd2c520246b4bbe786aa55d3b77592fae5c4d458f/
      contract.json
      contract.d.ts
  app/
    20260303T1000_merge_alice/
      migration.ts
      migration.json
      ops.json
```

## Why a store, not sibling copies

A chain of N migrations previously stored roughly 2N copies of N+1 distinct contracts: each migration package held its own `start-contract.*` / `end-contract.*` pair, so a contract sitting at the boundary between two migrations was written once by the predecessor as its destination and again by the successor as its source. Deduplicating by content removes that redundancy without losing any information the manifest doesn't already carry. `migration.json`'s `from` / `to` fields already record the storage hash on both sides of every edge, so no link file is needed to find a migration's bookend contracts — the hash itself is the address.

## Keyed by storage hash

The store is keyed by `storage.storageHash`, not a hash over the full contract. Because `migration.json` already carries `from` / `to` as storage hashes (ADR 199), every reader that already has a hash in hand — a migration manifest, a ref pointer, a `--to <hash>` argument — resolves the store entry directly, with no secondary index to maintain.

The same content-addressed shape already exists on the Postgres control plane: `prisma_contract.contract` (`packages/3-targets/3-targets/postgres/src/contract-free/control-bootstrap.ts`) is a `core_hash text primary key` table holding one row per distinct contract, referenced by the ledger's `origin_core_hash` / `destination_core_hash` columns with no foreign key (a baseline origin has no stored contract by definition). The parallel is Postgres-only — SQLite's control plane inlines contract JSON directly into marker/ledger rows and has no content-addressed table of its own.

## Write-if-absent, made sound by canonicalization

Writing a snapshot checks only whether `snapshots/<hex>/` already exists; if it does, the write is skipped without comparing bytes. This is safe only because every write path canonicalizes first — `canonicalizeJson(contractJson)` plus a trailing newline for the JSON, and a trailing newline for the `.d.ts` — so two producers writing the entry for the same hash always agree on the bytes. Without that, write-if-absent could silently keep whichever producer wrote first even when a later producer's bytes differed from the file it walked past. Each write lands in a temporary directory under `snapshots/` and is `rename`d into place, so a concurrent or interrupted write cannot leave a partial entry visible under its real hash.

## Accepted conflation trade-off

Two contracts that differ only in their domain surface — operation names, docstrings, codec metadata — share the same storage hash by construction (ADR 199 excludes those fields from the hash). Because the store is keyed by storage hash, such contracts also share one store entry: whichever is written first is what every migration referencing that hash sees thereafter. This is the same conflation ADR 199 already accepts for migration identity, extended to the snapshot itself, and it is accepted for the same reason — the domain-surface fields aren't part of what a migration promises about storage.

## Runner independence is preserved

`migration apply` reads only `migration.json` and `ops.json` per package; it never touches `snapshots/`. `migrationHash` already excludes the contract snapshot from its hash inputs (ADR 199), so moving the snapshot into a shared store changes no migration's identity — every committed `migrationHash` is unchanged by this move. A project can delete `migrations/snapshots/` entirely and still `migrate` an app-space chain end-to-end; `snapshots/` is authoring and planning surface, not an apply input. Only authoring commands (`migration plan`, `migration new`) and typed-import resolution (`tsc`, the emitted `migration.ts`) need the store present.

## `snapshots` is a reserved space name

Every directory under `migrations/` is either a materialized space of migration packages or the shared store; a space named `snapshots` would be indistinguishable from the store itself, so `snapshots` is a reserved top-level name under `migrations/` and cannot be used as a space id.

## Contract source stays out of the store

The store holds only the emitted `contract.json` / `contract.d.ts` pair, never the PSL or TypeScript source a contract was authored from. The intermediate-contract workflow (ADR 197) already has users hand-copy their own schema authoring surface into a migration directory when they need one typed against an intermediate state, and TypeScript authoring mode has no single canonical source file to snapshot in the first place. A source slot in the store is additive and can be added later without breaking the shape decided here.

## The `snapshotsImportPath` threading

Every planner that can render a `migration.ts` file takes a required `snapshotsImportPath: string` option — the POSIX-relative path from the migration package directory to `migrations/snapshots` (`../../snapshots` for app-space and consumer-project extension-space packages; `../snapshots` for packages inside an extension's own source repo, where migration packages sit one level shallower). The field is required, not optional, so a caller that forgets to compute it gets a compile error rather than a renderer that silently emits a malformed import specifier.

One planner caller never renders a `migration.ts` at all: the `db init` / `db update` diff-reconciliation path builds a plan purely to apply it, with no authoring surface and so no migration package directory to compute a real import path from. That caller passes `snapshotsImportPath: ''`, which is safe precisely because the plan it produces is applied, never rendered — the field exists only to satisfy the planner's options type. A discriminated options shape that separated rendering plans from reconciliation plans, so the reconciliation path couldn't even be asked for an import path, would express this more cleanly; it is deferred rather than adopted here.

## Snapshot concept boundary, and the path to one store

This store is a distinct concept from the ref-paired snapshot [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) introduced: `refs/<name>.contract.json` / `.contract.d.ts` are mutable working state paired to a live ref (`db`, `production`, …), rewritten whenever the ref advances. The content-addressed store this ADR describes holds immutable migration-chain history, written once per distinct contract and never rewritten. Both are called "snapshot" today — a boundary worth naming precisely because it is not meant to be permanent.

The two have folded into one, in this same release (TML-3072): `refs/<name>.json` is now a pure `{ hash, invariants }` pointer, and a ref's contract resolves through this same store instead of through paired sibling files. Every ref-advance path already resolved the contract bytes it would pair with the ref, so writing them into the store instead changed no call site's inputs — only where the bytes land. `migrations/` now holds exactly one snapshot concept: the content-addressed store, with every consumer — a migration bookend, a ref, an extension head — reaching it by hash.

## Alternatives considered

### Per-migration link files

Instead of moving contract bytes into a shared store, each migration package could keep a small file naming a shared external location by hash, leaving the contract copies where they were. Rejected: `migration.json`'s `from` / `to` fields already are that link — they are the storage hash, and the store above resolves directly from a hash to a directory. A link file would duplicate information the manifest already carries.

### Full-content-hash keying

The store could key snapshots by a hash over the full canonicalized contract, rather than reusing `storage.storageHash`. Rejected: the storage hash is already the hash `migration.json` records and every reader already has in hand; keying by a second, different hash would mean readers compute or store an extra hash just to find their own bookend contract, for no additional safety — the accepted conflation trade-off above follows from what `storage.storageHash` excludes, not from which hash a lookup happens to use.

### Gzip-compressed store entries

Store entries could be written as `contract.json.gz`, with readers tolerating either compressed or plain bytes. Rejected: TypeScript cannot resolve a gzipped `.d.ts` import, and the emitted `migration.ts`'s ESM JSON import (`import contract from '…/contract.json' with { type: 'json' }`) cannot decompress at import time. Reader-side tolerance only ever helps a tool that reads store files directly — every committed `migration.ts` still requires plain JSON, so there is no size-reduction outcome gzip support would unlock without breaking the emitted import.

## References

- [ADR 197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md) (amended — a migration directory no longer carries its own contract copies; the property is now "the migrations *tree* is self-contained," not "the migration package is self-contained")
- [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md) (the safety argument this store relies on)
- [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) (the ref-paired snapshot vocabulary this ADR's boundary section distinguishes from)
- [ADR 232 — A migration is authored against its start and end contract snapshots](ADR%20232%20-%20A%20migration%20is%20authored%20against%20its%20start%20and%20end%20contract%20snapshots.md) (amended — its file-layout claims describe the pre-store sibling-copy shape)
- [Migration System subsystem doc](../subsystems/7.%20Migration%20System.md)
- Store implementation: `packages/1-framework/1-core/framework-components/src/control/contract-snapshot-layout.ts`, `packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts`
- Postgres content-addressed contract table: `packages/3-targets/3-targets/postgres/src/contract-free/control-bootstrap.ts`

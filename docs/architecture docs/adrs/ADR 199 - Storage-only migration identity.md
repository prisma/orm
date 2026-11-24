# ADR 199 — Storage-only migration identity

**Revised:** 2026-04-30 — `kind` removed; `from` is now nullable (TML-2270).
**Revised:** 2026-05-14 — vestigial `authorship` and `signature` fields removed from `MigrationMetadata` (TML-2458); `strippedMeta` description and example updated to match.
**Revised:** 2026-05-29 — vestigial `labels` and `hints` fields removed from `MigrationMetadata` entirely (TML-2701); `strippedMeta` description, destructure example, "What stays on disk", and "Why `hints` is excluded" sections updated to match.
**Amended by** [ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md): `migration.json` carries `formatVersion`, which `computeMigrationId` leaves out of its input as it leaves out `migrationHash`.

**Amends:** [ADR 169 §3 — Content-addressed migration identity](ADR%20169%20-%20On-disk%20migration%20persistence.md)

## At a glance

A team has an attested migration `002-add-email-index`. Its on-disk package is a `migration.json` manifest plus a sibling `ops.json`. The manifest records `from` (`string | null` — `null` for a baseline), `to` (destination storage hash), and the full `fromContract` / `toContract` JSON; `ops.json` holds the operations list. Its `migrationId` was computed from `(manifest, ops)` — see `computeMigrationId` below.

A developer then renames an operation in the contract — say, `findUserByEmail` becomes `getUserByEmail`. No columns change, no indexes change, nothing about the physical database changes. But the canonicalized `toContract` is now different, so `computeMigrationId` returns a new hash. `migration verify` fails with `mismatch`. The developer must re-attest a migration whose ops are byte-for-byte identical.

This is wrong. The migration doesn't care about operation names. It cares about storage.

## Decision

`migrationId` is computed from `(strippedManifest, ops)` only. The full `fromContract` and `toContract` objects are excluded from the hash.

```ts
export function computeMigrationId(manifest: MigrationManifest, ops: MigrationOps): string {
  const {
    migrationId: _migrationId,
    fromContract: _fromContract,
    toContract: _toContract,
    ...strippedMeta
  } = manifest;

  const canonicalManifest = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalManifest, canonicalOps].map(sha256Hex);
  return sha256Hex(canonicalizeJson(partHashes));
}
```

`strippedMeta` contains `from`, `to`, `providedInvariants`, `createdAt`. The `from` field is `string | null`: when it is a string, it is the prior-state storage hash — the same storage-projection commitment that ADR 004 defines; `null` denotes a baseline with no prior state. The `to` field is the destination storage hash. They pin the migration to its bookends: which physical schema it expects (if any), and which physical schema it produces. `providedInvariants` participates in identity because it captures which routing-visible data transforms the migration declares; changing the set changes which refs the migration satisfies, so it is *not* metadata-about. Together with `ops`, the strippedMeta fields fully describe what the migration does to the database. Everything else (the discarded `fromContract`, `toContract`, plus the trivially-derived `migrationHash` itself) is metadata *about* the migration, not part of its physical identity.

### What stays on disk

`fromContract` and `toContract` remain in `migration.json`. They are consumed by `migration plan` (to reconstruct the "from" schema for the next diff), `migrate` (for display and verification), and the transitional `migration emit` command (to regenerate ops; see [ADR 193](ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)). They're context for tooling, not inputs to identity.

## Consequence

Non-storage contract edits — operation renames, docstring changes, codec metadata — no longer invalidate `migrationId`. A developer can evolve the contract's domain surface freely between planning cycles without triggering re-attestation of existing migrations.

Storage-affecting edits — changes to `from`, `to`, or `ops` — still produce a different `migrationId`, as they should. The migration's physical identity tracks its physical effect.

## Alternatives considered

### Keep full contracts in the hash (status quo ante)

ADR 169 §3 included canonicalized `fromContract` and `toContract` in the hash. The rationale was that migration identity should capture the full context the planner used. We chose to narrow because:

- The `from`/`to` fields already pin the migration to its contract bookends (`from` is nullable for baselines). Adding the full contract objects is redundant for identity and actively harmful for stability.
- Migrations are storage artifacts (ADR 001, ADR 004). Their identity should reflect what they do to storage, not the shape of the contract's domain layer at planning time.
- The practical cost is high: any non-storage contract edit invalidates all downstream `migrationId` values, forcing re-attestation across the migration chain.

### Hash contracts but strip non-storage fields first

Instead of dropping contracts entirely, we could have projected each contract down to its storage-relevant fields before hashing. This was rejected because the manifest `from`/`to` fields (with nullable `from`) already *are* that projection — they are the canonical storage fingerprint defined by ADR 004. Duplicating the projection inside `computeMigrationId` would be redundant and would couple the migration identity computation to the contract's internal field structure.

## References

- [ADR 001 — Migrations as Edges](ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [ADR 028 — Migration Structure & Operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md) (§3 amended)
- [ADR 192 — ops.json is the migration contract](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) (concurrent)

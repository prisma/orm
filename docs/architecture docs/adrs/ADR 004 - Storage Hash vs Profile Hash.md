# ADR 004 — Storage Hash vs Profile Hash (formerly “core hash”)

**Hash inputs superseded by** [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md): each hash covers only `targetFamily`, `target` and its own section, and the rules do not change within a major.

## Context

- We hash the emitted data contract to tie code, database state, and artifacts together
- A single hash makes any physical or capability tweak look like a breaking schema change
- Teams need to evolve physical settings and enable target features without invalidating every artifact or forcing meaningless migrations
- We also need strong guarantees for changes that do alter the logical meaning of the data model

## Decision

- Split hashing into two layers
- **storageHash** (previously referred to as “coreHash” in early docs): a deterministic hash of the contract’s `storage` section plus target headers
- **profileHash (pinned)**: a deterministic hash of the contract’s declared capability requirements (`capabilities`) plus target headers
- Store both in artifacts and in the database marker
- Use storageHash for applicability of migrations and plan verification
- Use profileHash to enforce capability parity with the database marker; runtime compares equality to the marker, not a freshly computed runtime profile

## Details

### What contributes to storageHash

`storageHash` is computed from a canonicalized object that includes:

- `schemaVersion`
- `targetFamily`
- `target`
- `storage`

It intentionally excludes `models`, `relations`, `capabilities`, and `meta`, and the *content* of `extensions`. The canonicalized object always carries an `extensions` key (an empty object when no extension contributes), so the key itself is part of the hashed bytes even though extension content never contributes.

### What contributes to profileHash

`profileHash` is computed from a canonicalized object that includes:

- `schemaVersion`
- `targetFamily`
- `target`
- `capabilities`

It intentionally excludes `storage`, `models`, `relations`, and `meta`, and the *content* of `extensions` (the empty `extensions` key is present in the canonical form, as above).

### Emission and storage

- Emitter produces `contract.json` and computes both hashes via canonicalization:
  - `storageHash = sha256(canonicalize({ schemaVersion, targetFamily, target, storage }))`
  - `profileHash = sha256(canonicalize({ schemaVersion, targetFamily, target, capabilities }))`
- Database marker stores both hashes (plus optional diagnostic JSON and metadata)
  - Note: the Postgres marker table column is still named `core_hash`, but it stores the **contract `storageHash`**
- Migration edges store complete fromContract and toContract JSON alongside hashes
- Runtime embeds `storageHash` into each Plan's meta and verifies on execute; it reads marker `profile_hash` and enforces equality with the contract's `profileHash`
- Preflight surfaces differences in both hashes with actionable guidance

### Behavior on mismatch

#### storageHash mismatch
- **Migrations**: edge is inapplicable and must be re-planned
- **Runtime**: block or warn per environment policy

#### profileHash mismatch
- **Runtime**: blocking error by default (contract/target-mismatch). The app must re-verify against the database (or update the contract) so the marker reflects the pinned profile.
- **Advisors**: suggest reconciliation steps (enable required capabilities, install extensions, or update contract/pins)
- **PPg**: can surface remediation instructions

### Example changes and their effects

- Add nullable column (DDL/storage changes) → new storageHash
- Add an index (DDL/storage changes) → new storageHash
- Enable a declared capability flag (capabilities change) → new profileHash
- Change a physical storage attribute represented in `storage` → new storageHash

## Alternatives considered

- **Single hash for everything**: Simple but noisy and forces unnecessary re-plans and redeploys
- **Multiple fine-grained hashes per section**: More precision but higher complexity and harder UX
- **No hashing, version integers only**: Weak verification and easy to drift undetected

## Consequences

### Positive

- Clear contract for when migrations and queries must be revalidated
- Safer evolutions of physical tuning without breaking logical compatibility
- Better diagnostics and targeted PPg guidance

### Trade-offs

- Slightly more complexity in artifacts and marker schema
- Requires careful classification of fields into core vs profile

## Scope and non-goals

### In scope for MVP

- Define canonicalization rules and implement both hashes in emitter
- Persist both hashes in the database marker and artifacts
- Runtime verification against storageHash and errors for profileHash drift
- Preflight diagnostics for both categories

### Out of scope for MVP

- Automated reconciliation for profile drift
- Per-section hashing beyond the two-layer split

## Backwards compatibility and migration

- Existing contracts without profileHash are treated as profileHash = null
- Marker migration adds a nullable profile_hash column and a marker schema version bump
- Old environments continue to verify coreHash as before

## Open questions

- Exact boundary for collations and encodings between core and profile
- Future: a "floating mode" could compute a runtime profile from discovered capabilities and check only that it satisfies contract requirements rather than equality. This would be an additive mode; the default remains pinned and contract-derived.
- How to report combined core/profile diffs in a single, readable diagnostic for CI and PPg

## Decision record

- Adopt a two-layer hashing scheme with storageHash for storage identity and profileHash for pinned capability profile
- Verify storageHash for applicability and safety, surface profileHash drift with advisor guidance
- Persist both in artifacts and database markers to support deterministic planning, safe execution, and platform insights

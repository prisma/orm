# ADR 010 — Canonicalization Rules for contract.json

**Revised:** 2026-07-23 — hashes are represented as bare lowercase hex; the former `sha256:` algorithm prefix was dropped before the RC format freeze (TML-2756). The prefix carried no information — the algorithm never varies per hash — and a change to the hashing rules is signalled by re-emit, not by an in-band marker, the same no-in-band-version reasoning [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) records. Examples below use the bare form.

**Partly superseded by** [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md): the canonicalization rules that hashes use do not change within a major, so a rule change is no longer handled by emitting and signing again. The hashes cover only `targetFamily`, `target` and their own section.

## Context

- `contract.json` is the canonical artifact consumed by the runtime, planner, preflight, and PPg
- Hashing, caching, and CI diffs require byte-identical output across platforms and authoring modes
- Non-determinism from key order, whitespace, default materialization, and adapter metadata has previously caused noisy diffs and false cache misses
- We need explicit, testable rules for canonicalization

## Decision

- Define a strict canonical JSON format for `contract.json`
- Apply canonicalization in the emitter after validation and normalization and before hashing
- Compute `storageHash` plus `profileHash` over canonical bytes, and include `executionHash` only when execution defaults are emitted in the canonical artifact
- Treat any divergence from these rules as an emitter bug
- State that TS-first and PSL-first must canonicalize to the identical JSON and `storageHash` for equivalent intent
- When the canonicalization rules change, the change is breaking — the new ruleset produces different bytes for the same logical contract, so every consumer that hashed or stored the old form must re-emit. This is handled by re-emit / re-sign rather than by versioning the algorithm at runtime.

## Canonical JSON profile

This project adopts a pragmatic subset inspired by RFC 8785 with additional domain rules.

### Encoding

- UTF-8 without BOM
- Newlines are `\n`
- No trailing newline at EOF
- Objects serialized with deterministic key order
- Numbers encoded with minimal decimal form, no `+`, no leading zeros, no trailing `.0` unless required, and no scientific notation unless necessary to preserve value
- Booleans as `true` or `false` and `null` as `null`
- Strings escaped per JSON spec with `\uXXXX` for control chars

### Whitespace

- No insignificant whitespace other than that required by JSON separators
- Exactly one `:` after keys and no space
- Keys separated by `,` with no spaces

**Example:** `{"a":1,"b":[true,"x"]}`

### Object key ordering

- Keys sorted lexicographically by UTF-16 code unit order
- Sort applied recursively to all objects
- For top-level sections we enforce a small, explicit *presentation order* before lexicographic sort to stabilize human diffs.
  - This does not change semantics (the JSON meaning is the same either way).
  - It only makes reviews easier by keeping “header” fields (identity + hashes) grouped, followed by the large semantic sections, with `meta` last.
  - Within each section (and for any non-top-level object), standard lexicographic sort applies, except where domain-specific ordering rules are defined below.

**Source of truth:** the exact top-level ordering is defined by the emitter implementation (see `TOP_LEVEL_ORDER` in `packages/1-framework/1-core/control-plane/src/emission/canonicalization.ts`). Any new top-level section that becomes part of the canonical artifact must be added there (and covered by tests) to keep diffs stable.

### Arrays

- Arrays are preserved in the order that is semantically meaningful
- Where order is not semantically meaningful, arrays are canonically sorted
- Column lists in composite keys retain declared order
- Lists of constraints and indexes are sorted by their canonical names per ADR 009
- Model and table registries are represented as objects, not arrays, to avoid order-dependence

### Optional and default fields

- Omit fields that are equal to their canonical defaults
- **Canonical defaults**:
  - `nullable` is always explicit (never omitted) — see ADR 172
  - `generated: false` omitted
  - Empty arrays and empty objects omitted unless required for schema readability (tables and models must be present, even if empty)
  - Capability flags omitted when false and recorded only when true
  - Derived names injected by the emitter per ADR 009 must be present with `generated: true`

### Identifiers and names

- Persist identifiers as authored or deterministically generated strings
- Do not case-normalize author-provided names beyond validation
- Deterministic names for PK/UK/FK/IDX per ADR 009 must appear in canonical form
- Engine-specific quoting is not embedded in the contract

### Target extensions

- Capability requirement keys live under `capabilities.<key>` and storage extensions under `storage.extensions.<target>`
- Use shared `capabilities.sql.*` keys for family-wide SQL features, and use target brand keys only for target-specific capabilities
- Keys within extensions follow the same lexicographic ordering
- Fields that do not alter logical meaning are included in profileHash only per ADR 004

### Meta (tooling-only; excluded from hashes)

`meta` exists to carry optional, tooling-facing information. It does not change contract meaning and **must not** influence any hash.

- `meta` is excluded from `storageHash`, `executionHash`, and `profileHash` inputs.
- `meta` key ordering is lexicographic and appears after core sections (see top-level presentation order above).

### Hashing

- `storageHash` is computed over canonical JSON for storage meaning (profile-only fields stripped)
- `executionHash` is emitted only when execution-plane defaults are present in the emitted contract artifact
- `profileHash` is computed over canonical JSON including profile fields
- Hash algorithm: SHA-256, represented as bare lowercase `<hex>` (no algorithm prefix)

## Emitter responsibilities

- Normalize then canonicalize, then compute hashes, then write artifacts
- Provide `--verify` mode that re-parses and re-emits to assert byte-identical output
- Provide a `prisma-next verify contract.json` command to check adherence outside of emit
- Ensure TS-first and PSL-first projects produce identical canonical JSON and `storageHash` for the same logical schema

## Consumer responsibilities

- Treat `contract.json` as immutable content-addressed data
- Never reorder or pretty-print when storing or transmitting
- Use `storageHash` for applicability checks and `profileHash` for drift checks

## Examples

### Minimal canonical object

```json
{"schemaVersion":"1","targetFamily":"sql","target":"postgres","profileHash":"...","models":{},"storage":{"storageHash":"...","tables":{}}}
```

### With capabilities

`capabilities` records contract requirements. Adapters still negotiate and verify support at connect time; this example only shows required keys captured in the contract.

```json
{"schemaVersion":"1","targetFamily":"sql","target":"postgres","profileHash":"...","models":{"User":{"fields":{"email":{"codecId":"text","nullable":false},"id":{"codecId":"int4","nullable":false}},"storage":{"table":"user"}}},"storage":{"storageHash":"...","tables":{"user":{"columns":{"email":{"type":"text"},"id":{"type":"int4"}},"primaryKey":{"columns":["id"],"name":"user_pkey"}}}},"capabilities":{"sql":{"jsonAgg":true,"lateral":true}},"codecs":{"int4":{"ts":"number"},"text":{"ts":"string"}}}
```

## Alternatives considered

- **RFC 8785 strict conformance without domain rules**: Insufficient for our defaults and naming requirements
- **Pretty-printed JSON for readability**: Increases diff noise and weakens byte-level determinism
- **Protobuf or CBOR canonical formats**: Tighter encoding but worse DX and harder ecosystem interoperability

## Consequences

### Positive

- Byte-identical artifacts across OSes and authoring modes
- Stable `storageHash` and `profileHash` for CI and PPg
- Cleaner diffs and lower review noise
- Deterministic planner inputs and fewer spurious changes

### Trade-offs

- Harder to eyeball without a pretty-printer
- Slight complexity in emitter and tests
- Consumers must not reformat artifacts

## Testing and compliance

- Golden tests for representative schemas, including edge cases of names, defaults, and extensions
- Round-trip parse → canonicalize → hash → parse checks
- Cross-platform CI jobs compare emitted bytes on Linux, macOS, and Windows
- Contract linter rule to detect non-canonical files committed by mistake

## Backwards compatibility

- Older contracts without canonicalization are re-emitted on first emit and pick up hashes accordingly
- Schema version bump if canonicalization rules change in a breaking way
- Canonicalization rule changes are breaking: hashes change because canonical bytes change. Existing stored contract blobs and DB markers must be re-emitted / re-signed against the new ruleset; there is no in-band version field on the contract or marker for the canonicalizer (the earlier `canonicalVersion` field was retired — tracked separately under the migration-area Linear project).

## Open questions

- Whether to expose a `--pretty` view for humans without altering the on-disk artifact
- Policy for large numeric types that exceed IEEE-754 safe integers in JS tooling
- Canonicalization of expression-based indexes when added to the model

## Decision record

- Adopt strict canonicalization rules for `contract.json` and compute all hashes over canonical bytes
- Emitter enforces and verifies determinism, consumers treat artifacts as immutable data
- Domain-specific rules align with our hashing split and deterministic naming to keep artifacts stable and useful

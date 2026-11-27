# ADR 010 — Canonicalization Rules for contract.json

**Revised:** 2026-07-23 — hashes are represented as bare lowercase hex; the former `sha256:` algorithm prefix was dropped before the RC format freeze (TML-2756). The prefix carried no information — the algorithm never varies per hash — and nothing in the hash names the rules that produced it, the same no-in-band-version reasoning [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) records. Examples below use the bare form.

Hashes cover only `targetFamily`, `target` and their own section, and the rules that compute them do not change within a major version: see [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md).

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
- The canonicalization rules that hashes use do not change within a major version (ADR 332). A change to them ships only in a major release, with a way to move existing files and databases.

## Canonical JSON profile

This project adopts a pragmatic subset inspired by RFC 8785 with additional domain rules.

### Encoding

The hash input and the written file have the same form: the key-sorted JSON, printed by `JSON.stringify` with a two-space indent.

- UTF-8 without BOM
- Newlines are `\n`
- No trailing newline at EOF
- Two-space indentation, one space after each `:`, as `JSON.stringify(value, null, 2)` prints it
- Numbers, booleans, `null` and string escapes as `JSON.stringify` prints them

The indentation is part of the rule: the same JSON printed without it has a different hash.

### Object key ordering

- Keys sorted lexicographically by UTF-16 code unit order
- Sort applied recursively to all objects
- For top-level sections we enforce a small, explicit *presentation order* before lexicographic sort to stabilize human diffs.
  - This does not change semantics (the JSON meaning is the same either way).
  - It only makes reviews easier by keeping “header” fields (identity + hashes) grouped, followed by the large semantic sections, with `meta` last.
  - Within each section (and for any non-top-level object), standard lexicographic sort applies, except where domain-specific ordering rules are defined below.

**Source of truth:** the exact top-level ordering is defined by `TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`. Any new top-level section that becomes part of the canonical artifact must be added there (and covered by tests) to keep diffs stable.

### Arrays

- Arrays are preserved in the order that is semantically meaningful
- Every array keeps the order it is given in, except the lists named below
- Column lists in composite keys retain declared order
- Lists whose order means nothing to the database are ordered by the family, in its normal form: the SQL family orders a table's checks, foreign keys, indexes and unique constraints by name, and an entry without a name by its content; the MongoDB family orders a collection's indexes by name, and indexes with the same name by their content. Reordering them in the contract source changes no hash
- Model and table registries are represented as objects, not arrays, to avoid order-dependence

### Optional and default fields

The framework's canonicalizer leaves out nothing. It sorts keys and encodes what it is given; it does not know what any field means, so it never decides that a `false`, an empty array or an empty object is a default.

Each family owns the normal form of its own content, and gives it to the framework through one function (`normalizeStorage`) that the framework applies both when it writes `storage` and when it hashes it. A value is therefore in the hash input exactly when it is in the written section, except a namespace's `kind`, which is written and which the storage hash leaves out (ADR 332).

- A family leaves out a field only where the family itself defines the absent field and the value to mean the same, and it names each such field. For example, the SQL family leaves out a column's `many: false` and a foreign key's `onDelete: "noAction"`; the MongoDB family leaves out an index's `unique: false`.
- Nothing is left out because of the shape of its value. Data a family does not own is kept exactly as given: a type's parameters, an index's options, a MongoDB partial filter expression, a generator's parameters, the members of a value set, and every field of an entry an extension pack defines.
- `nullable` is always written — see ADR 172.
- A capability flag that is off is left out by the code that builds the capability list.
- A family also leaves its own defaults out of the `domain` section when it writes it, for example a field's `many: false`. `domain` is not hashed.
- Only a family names defaults. Every field of an entry that a target or an extension pack defines is hashed exactly as given, so its author gives each field one form: the field is required, or its constructor stores the default in one way only. Otherwise the same meaning has two storage hashes, and after `8.0.0` that cannot be corrected within the major.

An earlier rule had the framework drop every `false`, `[]` and `{}` unless a path was on an exception list. It dropped values that were not defaults: `{ "fastupdate": false }` in an index's options was written as `{}`, a MongoDB partial filter `{ "isAdmin": false }` was written as a filter that matches every document, and two types whose parameters differed only by such a value had one storage hash.

### Identifiers and names

- Persist identifiers as authored or deterministically generated strings
- Do not case-normalize author-provided names beyond validation
- Deterministic names for PK/UK/FK/IDX per ADR 009 must appear in canonical form
- Engine-specific quoting is not embedded in the contract

### Target extensions

- Capability requirement keys live under `capabilities.<key>`
- Use shared `capabilities.sql.*` keys for family-wide SQL features, and use target brand keys only for target-specific capabilities
- Keys within extensions follow the same lexicographic ordering
- Fields that do not alter logical meaning are included in profileHash only per ADR 004

### Meta (tooling-only; excluded from hashes)

`meta` exists to carry optional, tooling-facing information. It does not change contract meaning and **must not** influence any hash.

- `meta` is excluded from `storageHash`, `executionHash`, and `profileHash` inputs.
- `meta` key ordering is lexicographic and appears after core sections (see top-level presentation order above).

### Hashing

- `storageHash` is computed over `targetFamily`, `target` and `storage` in the family's normal form, with keys sorted
- `executionHash` is emitted only when execution-plane defaults are present in the emitted contract artifact
- `profileHash` is computed over `targetFamily`, `target` and `capabilities`, with keys sorted
- Hash algorithm: SHA-256, represented as bare lowercase `<hex>` (no algorithm prefix)

## Emitter responsibilities

- The storage hash is computed when the contract is built, by the family's authoring code. The emitter writes it, and refuses to write a `storage` section that does not hash to it
- Ensure TS-first and PSL-first projects produce identical canonical JSON and `storageHash` for the same logical schema

## Consumer responsibilities

- Treat `contract.json` as immutable content-addressed data
- Never reorder or reformat when storing or transmitting
- Use `storageHash` for applicability checks and `profileHash` for drift checks

## Example

The input of a storage hash, as it is hashed:

```json
{
  "storage": {
    "namespaces": {
      "public": {
        "entries": {
          "table": {}
        },
        "id": "public"
      }
    }
  },
  "target": "postgres",
  "targetFamily": "sql"
}
```

## Alternatives considered

- **RFC 8785 strict conformance without domain rules**: Insufficient for our defaults and naming requirements
- **Compact JSON with no whitespace**: what an earlier draft of this record described. The file is written indented so that it can be read and diffed, and the hash input uses the same form so that there is one
- **Protobuf or CBOR canonical formats**: Tighter encoding but worse DX and harder ecosystem interoperability

## Consequences

### Positive

- Byte-identical artifacts across OSes and authoring modes
- Stable `storageHash` and `profileHash` for CI and PPg
- Cleaner diffs and lower review noise
- Deterministic planner inputs and fewer spurious changes

### Trade-offs

- Slight complexity in emitter and tests
- Consumers must not reformat artifacts

## Testing and compliance

- Golden tests for representative schemas, including edge cases of names, defaults, and extensions
- Round-trip parse → canonicalize → hash → parse checks
- Cross-platform CI jobs compare emitted bytes on Linux, macOS, and Windows
- Contract linter rule to detect non-canonical files committed by mistake

## Backwards compatibility

- Older contracts without canonicalization are re-emitted on first emit and pick up hashes accordingly
- The rules do not change within a major version (ADR 332). The one change made before `8.0.0` was handled by the upgrade instructions of that release.

## Open questions

- Whether to expose a `--pretty` view for humans without altering the on-disk artifact
- Policy for large numeric types that exceed IEEE-754 safe integers in JS tooling
- Canonicalization of expression-based indexes when added to the model

## Decision record

- Adopt strict canonicalization rules for `contract.json` and compute all hashes over canonical bytes
- Emitter enforces and verifies determinism, consumers treat artifacts as immutable data
- Domain-specific rules align with our hashing split and deterministic naming to keep artifacts stable and useful

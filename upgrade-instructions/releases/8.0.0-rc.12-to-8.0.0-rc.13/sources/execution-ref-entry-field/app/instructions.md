---
changes:
  - id: execution-ref-entry-field
    summary: |
      Each entry in `contract.execution.mutations.defaults` now names its target as
      `ref: { namespace, entry, field }` instead of `ref: { namespace, table, column }`. The values
      are the same table and column names. Re-emit the contract; code that reads `.ref.table` or
      `.ref.column` reads `.ref.entry` and `.ref.field`.
    detection:
      glob: "**/*.{json,ts,mts,cts}"
      matches:
        - '"ref"\s*:\s*\{(?![^{}]*"kind")[^{}]*"(?:table|column)"\s*:'
        - '\.ref\??\.(?:table|column)\b'
        - '\bref\s*:\s*\{(?![^{}]*\bkind\b)[^{}]*\b(?:table|column)\s*:[^{}]*\b(?:table|column)\s*:'
---

## `execution-ref-entry-field`

A contract with generated defaults (`temporal.createdAt()`, `temporal.updatedAt()`, `@default(uuid())` and the like) carries them under `execution.mutations.defaults`. Each entry's `ref` changes keys; the values do not:

```json
// before
{ "ref": { "namespace": "public", "table": "user", "column": "updated_at" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }

// after
{ "ref": { "entry": "user", "field": "updated_at", "namespace": "public" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }
```

1. Run `prisma contract emit` so `contract.json` and `contract.d.ts` use the new keys. The runtime rejects a contract whose refs still say `table` and `column` with `Contract structural validation failed: execution.mutations.defaults[0].ref.entry must be a string`.
2. Contract snapshots under `migrations/snapshots/<hash>/` that carry an `execution` section have the old keys too. In each `execution.mutations.defaults[].ref`, in both `contract.json` and `contract.d.ts`, rename `table` to `entry` and `column` to `field`, and write the keys in the order `entry`, `field`, `namespace`, which is the order `prisma contract emit` writes. Leave the snapshot's existing `executionHash` as it is. It no longer matches the renamed content, but the snapshot loader re-hashes only the storage section, so nothing checks it. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same.
3. Code that reads the section directly changes `.ref.table` to `.ref.entry` and `.ref.column` to `.ref.field`.

`executionHash` changes for every contract with generated defaults, because the canonical JSON changes. Nothing compares it against the database, so no migration or re-sign is needed.

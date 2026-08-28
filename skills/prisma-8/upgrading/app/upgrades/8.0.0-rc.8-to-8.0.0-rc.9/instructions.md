---
from: "8.0.0-rc.8"
to: "8.0.0-rc.9"
changes:
  - id: mongo-index-projections-use-native-lists
    summary: |
      MongoDB wildcard index `include` and `exclude` projections in Prisma schema files must use native PSL lists instead of encoded list strings.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(?:include|exclude)\s*:\s*"\[[^"\r\n]*\]"'
  - id: mongo-text-index-weights-use-native-records
    summary: |
      MongoDB text-index `weights` in Prisma schema files must use native PSL records instead of encoded JSON strings.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\bweights\s*:\s*"\{\s*(?:\\.|[^"\\])*\}"'
  - id: mongo-unlowered-attributes-are-rejected
    summary: |
      MongoDB Prisma schema files must not carry `@default(...)`, `@updatedAt`, or `@db.*` attributes; the Mongo interpreter never lowered them and now rejects them.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@(?:default\(|updatedAt\b|db\.)'
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — User upgrade instructions

## `mongo-index-projections-use-native-lists`

For every Prisma schema matched by `detection`, replace encoded projection strings with native PSL lists. For example, change `include: "[a, b]"` to `include: ["a", "b"]` and `exclude: "[a]"` to `exclude: ["a"]`. Decode each string's fields in their existing order and preserve whether the argument is `include` or `exclude`.

## `mongo-text-index-weights-use-native-records`

For every Prisma schema matched by `detection`, replace the encoded JSON string passed to `weights` with a native PSL record. For example, change `weights: "{\"title\": 10}"` to `weights: { title: 10 }`, preserving every field name and numeric weight.

## `mongo-unlowered-attributes-are-rejected`

This change applies only to schemas whose contract is produced by `@prisma/orm-mongo` (MongoDB projects; their models declare an `ObjectId` id field). Schemas for SQL targets keep these attributes.

For every matched MongoDB schema, delete each `@default(...)`, `@updatedAt`, and `@db.<Type>` attribute from the field that carries it, leaving the field's type and its other attributes in place. For example, change `status ProductStatus @default(Active)` to `status ProductStatus` and `updatedAt DateTime @updatedAt` to `updatedAt DateTime`. The Mongo interpreter never lowered these attributes into the contract, so the emitted `contract.json` does not change; defaults and timestamps stay the responsibility of application code, as they already were. `prisma contract emit` now fails with `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` while any of them remain.

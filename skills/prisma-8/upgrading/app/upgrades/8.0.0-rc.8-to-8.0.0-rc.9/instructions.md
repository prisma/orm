---
from: "8.0.0-rc.8"
to: "8.0.0-rc.9"
changes:
  - id: reemit-supabase-extension-version
    summary: |
      Re-emit contracts using the Supabase extension so their extension version metadata matches the installed rc.9 package.
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
  - id: explicit-enum-sort-values
    summary: |
      PostgreSQL text-backed enums now sort by stored value rather than declaration order; encode semantic ranks explicitly when ordering matters.
  - id: namespace-qualify-sql-orm-filter-types
    summary: |
      SQL ORM reusable filter types now require the domain namespace before the model name: `<Contract, Namespace, Model>`.
  - id: mongo-unlowered-attributes-are-rejected
    summary: |
      MongoDB Prisma schema files must not carry `@default(...)`, `@updatedAt`, or `@db.*` attributes; the Mongo interpreter never lowered them and now rejects them.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@(?:default\(|updatedAt\b|db\.)'
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — User upgrade instructions

## `reemit-supabase-extension-version`

After updating the Supabase extension to rc.9, run `prisma contract emit` for each contract that uses it and commit the regenerated `contract.json` and `contract.d.ts`. Verify that the Supabase extension's version metadata is `8.0.0-rc.9` in both artifacts; do not edit generated contracts by hand.

## `mongo-index-projections-use-native-lists`

For every Prisma schema matched by `detection`, replace encoded projection strings with native PSL lists. For example, change `include: "[a, b]"` to `include: ["a", "b"]` and `exclude: "[a]"` to `exclude: ["a"]`. Decode each string's fields in their existing order and preserve whether the argument is `include` or `exclude`.

## `mongo-text-index-weights-use-native-records`

For every Prisma schema matched by `detection`, replace the encoded JSON string passed to `weights` with a native PSL record. For example, change `weights: "{\"title\": 10}"` to `weights: { title: 10 }`, preserving every field name and numeric weight.

## `explicit-enum-sort-values`

Review queries that order text-backed enum columns and rely on declaration order. To retain semantic ranking, use an explicit ranking expression or numeric enum values. For example, a priority enum can use `{ codecId: 'pg/int4@1', nativeType: 'int4' }` with `member('Low', 0)`, `member('High', 1)`, and `member('Urgent', 2)`. In PSL, use `@@type("pg/int4@1")` with `Low = 0`, `High = 1`, and `Urgent = 2`. Update literal writes and type annotations to the numeric values, then re-emit the contract. For an existing database, create a data-preserving migration mapping the old strings to their numeric ranks and update defaults and constraints; do not rewrite applied migration history. PostgreSQL native enum columns retain the database's native ordering.

## `namespace-qualify-sql-orm-filter-types`

Find TypeScript references to `ShorthandWhereFilter`, `RelationPredicate`, `RelationPredicateInput`, and `RelationFilterAccessor`. Add the model's domain namespace as the second generic argument and place the model name third. Rewrite `ShorthandWhereFilter<Contract, Model>` as `ShorthandWhereFilter<Contract, Namespace, Model>` and `ShorthandWhereFilter<Contract, Model, Namespace>` as `ShorthandWhereFilter<Contract, Namespace, Model>`. Rewrite the relation types from `<Contract, Model>` to `<Contract, Namespace, Model>`. Use the namespace facet through which the model is queried, such as `'public'` for `db.public.User`.

## `mongo-unlowered-attributes-are-rejected`

First, before editing any schema, determine whether the project targets MongoDB: its `prisma.config.ts` imports `@prisma/orm-mongo`, or its `package.json` depends on that package. If neither holds, skip this change entirely and leave every schema untouched. The `detection` pattern also matches SQL schemas, where `@default(...)` and `@db.<Type>` are supported and deleting them breaks the contract.

For every matched MongoDB schema, delete each `@default(...)`, `@updatedAt`, and `@db.<Type>` attribute from the field that carries it, leaving the field's type and its other attributes in place. For example, change `status ProductStatus @default(Active)` to `status ProductStatus` and `updatedAt DateTime @updatedAt` to `updatedAt DateTime`. The Mongo interpreter never lowered these attributes into the contract, so the emitted `contract.json` does not change; defaults and timestamps stay the responsibility of application code, as they already were. `prisma contract emit` now fails with `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` while any of them remain.

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
  - id: namespace-qualify-sql-orm-filter-types
    summary: |
      SQL ORM reusable filter types now require the domain namespace before the model name: `<Contract, Namespace, Model>`.
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — User upgrade instructions

## `mongo-index-projections-use-native-lists`

For every Prisma schema matched by `detection`, replace encoded projection strings with native PSL lists. For example, change `include: "[a, b]"` to `include: ["a", "b"]` and `exclude: "[a]"` to `exclude: ["a"]`. Decode each string's fields in their existing order and preserve whether the argument is `include` or `exclude`.

## `mongo-text-index-weights-use-native-records`

For every Prisma schema matched by `detection`, replace the encoded JSON string passed to `weights` with a native PSL record. For example, change `weights: "{\"title\": 10}"` to `weights: { title: 10 }`, preserving every field name and numeric weight.

## `namespace-qualify-sql-orm-filter-types`

Find TypeScript references to `ShorthandWhereFilter`, `RelationPredicate`, `RelationPredicateInput`, and `RelationFilterAccessor`. Add the model's domain namespace as the second generic argument and place the model name third. Rewrite `ShorthandWhereFilter<Contract, Model>` as `ShorthandWhereFilter<Contract, Namespace, Model>` and `ShorthandWhereFilter<Contract, Model, Namespace>` as `ShorthandWhereFilter<Contract, Namespace, Model>`. Rewrite the relation types from `<Contract, Model>` to `<Contract, Namespace, Model>`. Use the namespace facet through which the model is queried, such as `'public'` for `db.public.User`.

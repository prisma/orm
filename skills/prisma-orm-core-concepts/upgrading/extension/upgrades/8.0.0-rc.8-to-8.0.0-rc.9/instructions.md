---
from: "8.0.0-rc.8"
to: "8.0.0-rc.9"
changes:
  - id: remove-nested-relations-from-sql-orm-upsert-and-batch-create
    summary: |
      SQL ORM `upsert({ create })`, `createAll()`, and `createAndCount()` payloads no longer accept nested relation mutation callbacks, which these operations cannot execute. Remove the callbacks and create related records separately, or use ordinary `create()` when the records must be created as one nested relation operation.
  - id: namespace-qualify-sql-orm-filter-types
    summary: |
      SQL ORM reusable filter types now require the domain namespace before the model name: `<Contract, Namespace, Model>`.
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — Extension author upgrade instructions

## `remove-nested-relations-from-sql-orm-upsert-and-batch-create`

Find SQL ORM calls to `upsert()`, `createAll()`, and `createAndCount()` whose create payloads contain relation fields assigned callback functions. Remove those callbacks and create the related records separately. When the operation requires nested relation creation, replace it with ordinary `create()`, which continues to accept and execute relation mutation callbacks.

## `namespace-qualify-sql-orm-filter-types`

Find TypeScript references to `ShorthandWhereFilter`, `RelationPredicate`, `RelationPredicateInput`, and `RelationFilterAccessor`. Add the model's domain namespace as the second generic argument and place the model name third. Rewrite `ShorthandWhereFilter<Contract, Model>` as `ShorthandWhereFilter<Contract, Namespace, Model>` and `ShorthandWhereFilter<Contract, Model, Namespace>` as `ShorthandWhereFilter<Contract, Namespace, Model>`. Rewrite the relation types from `<Contract, Model>` to `<Contract, Namespace, Model>`. For predicates targeting a relation, use the namespace declared by that relation's `to.namespace` coordinate.

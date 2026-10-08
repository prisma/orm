---
changes:
  - id: mongo-index-sort-function
    summary: Replace MongoDB PSL field sort modifiers with sort(field, direction).
---

## MongoDB PSL index sort directions

In MongoDB PSL schemas, replace `field(sort: Asc)` with `sort(field, Asc)` and `field(sort: Desc)` with `sort(field, Desc)` in `@@index`, `@@unique`, and `@@textIndex` field lists. The old syntax is no longer accepted.

For example, change `@@index([createdAt(sort: Desc), authorId])` to `@@index([sort(createdAt, Desc), authorId])`. Keep field order, direction, and the attribute's other arguments unchanged. Use the model field name, not its mapped database name.

Apply this translation to current schema files, PSL schema snapshots stored in migration directories, and documentation examples. When documentation describes the old spelling as a "per-field form", call the new spelling a "function form" instead.

Plain field references and `wildcard()` / `wildcard(field)` remain unchanged. There is no null-ordering option. Do not change SQL schemas, generated contracts, or migration operations: this is a MongoDB PSL syntax change, not a database index change.

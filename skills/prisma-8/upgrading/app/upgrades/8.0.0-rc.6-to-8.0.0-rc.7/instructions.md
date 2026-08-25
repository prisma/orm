---
from: "8.0.0-rc.6"
to: "8.0.0-rc.7"
changes:
  - id: rename-orm-pagination-methods
    summary: |
      Rename ORM collection pagination calls from `.take(n)` to `.limit(n)` and from `.skip(n)` to `.offset(n)`. This applies to SQL and Mongo ORM collections, including relation refinements and grouped SQL collections. Do not rename Mongo query-builder `.skip(n)` calls: that lower-level API continues to mirror the `$skip` pipeline stage.
---

# 8.0.0-rc.6 → 8.0.0-rc.7 — User upgrade instructions

## `rename-orm-pagination-methods`

Find calls on Prisma Next ORM collections and apply these translations:

- `.take(n)` → `.limit(n)`
- `.skip(n)` → `.offset(n)`

Apply the same translation inside `include(...)` refinement callbacks, `combine(...)` branches, and after SQL ORM `groupBy(...)`. Leave Mongo query-builder chains that start from `db.query.from(...)` unchanged: their `.limit(...)` and `.skip(...)` methods name Mongo aggregation pipeline stages rather than the ORM collection API.

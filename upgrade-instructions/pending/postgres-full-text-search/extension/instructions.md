---
changes:
  - id: query-operation-types-move-to-the-postgres-target
    summary: |
      `QueryOperationTypes` moves from `@internal/adapter-postgres/operation-types` to
      `@internal/target-postgres/operation-types`. The adapter subpath is gone, with no
      compatibility re-export.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "adapter-postgres/operation-types"
        - "orm-postgres/adapter/operation-types"
---

## `query-operation-types-move-to-the-postgres-target`

The Postgres adapter no longer contributes query operations; the target does. Change the import:

```ts
// before
import type { QueryOperationTypes } from '@internal/adapter-postgres/operation-types';
// after
import type { QueryOperationTypes } from '@internal/target-postgres/operation-types';
```

Under the published facade, `@prisma/orm-postgres/adapter/operation-types` becomes `@prisma/orm-postgres/target/operation-types`. Emitted contracts name the target import under the alias `PgTargetQueryOps` instead of `PgAdapterQueryOps`, so a snapshot or fixture that pins emitted contract text needs regenerating.

The type's shape is otherwise unchanged. It gains `fullTextMatches`, `fullTextRank` and `fullTextHeadline` on `textual` columns, whose query argument is a `pg/tsquery@1` value (built with a parser or the `tsquery` tag). It also gains the four parser operations `websearchToTsquery`, `toTsquery`, `plaintoTsquery` and `phrasetoTsquery`, which have no `self`, so they attach to no column. None of the names collide with an existing operation, so an extension that intersects its own `QueryOperationTypes` with the Postgres one needs no other edit.

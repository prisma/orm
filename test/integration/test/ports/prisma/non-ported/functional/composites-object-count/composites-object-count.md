# Non-ported — composites-object-count

- `packages/client/tests/functional/composites/object/count.ts` › `count` — `prisma.comment.count({ where, orderBy: { content: { upvotes: { _count: 'desc' } } } })` returns `1` — Prisma 8's mongo ORM has no read-side `count()` (only write-side `createCount`/`updateCount`/`deleteCount`), and no nested-composite `_count` orderBy (orderBy is `Record<field, 1|-1>`). Whole suite non-portable.

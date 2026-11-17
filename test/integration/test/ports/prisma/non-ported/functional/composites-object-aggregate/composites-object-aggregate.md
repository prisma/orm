# Non-ported — composites-object-aggregate

- `packages/client/tests/functional/composites/object/aggregate.ts` › `aggregate` — `prisma.comment.aggregate({ where, orderBy: { content: { upvotes: { _count: 'desc' } } }, _count: true })` returns `{ _count: 1 }` — Prisma 8's mongo ORM has no read-side `aggregate()` (only write-side `createCount`/`updateCount`/`deleteCount`), and no nested-composite `_count` orderBy (orderBy is `Record<field, 1|-1>`). Whole suite non-portable.

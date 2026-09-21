# Non-ported — composites-list-aggregate

- `packages/client/tests/functional/composites/list/aggregate.ts` › `simple` — `aggregate({ where, orderBy: { contents: { _count: 'asc' } }, _count: true })` returns `{ _count: 1 }` — Prisma 8's mongo ORM has no `aggregate` surface, and ordering by an embedded-list count is inexpressible. Whole suite non-portable.

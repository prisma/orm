# Non-ported — composites-list-count

- `packages/client/tests/functional/composites/list/count.ts` › `simple` — `count({ where, orderBy: { contents: { _count: 'asc' } } })` returns `1` — Prisma 8 has no `count` method, and ordering by an embedded-list count is inexpressible. Whole suite non-portable.

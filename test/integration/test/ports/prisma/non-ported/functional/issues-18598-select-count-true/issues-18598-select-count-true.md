# Non-ported — issues-18598-select-count-true

- `packages/client/tests/functional/issues/18598-select-count-true/tests.ts` › `works with _count shorthand` — `findFirst({ select: { _count: true } })` returns a count of every relation — Prisma 8 has no all-relations `_count` selection surface (`select: { _count: true }` counts all relations; only a specific-relation count via `include(rel => rel.count())` is expressible, which is a different mechanism)

# Non-ported — blog-update

- `packages/client/tests/functional/blog-update/tests.ts` › `should create a user with posts and a profile and update itself and nested connections setting fields to null` — single `update()` with nested `profile: { update: {...} }` and `posts: { updateMany: {...} }` — the Prisma 8 ORM relation mutator has no single-row nested `update`; the nested `updateMany` is available as `updateAll()` on a filtered to-many relation.

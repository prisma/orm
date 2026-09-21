# Non-ported — blog-update

- `packages/client/tests/functional/blog-update/tests.ts` › `should create a user with posts and a profile and update itself and nested connections setting fields to null` — single `update()` with nested `profile: { update: {...} }` and `posts: { updateMany: {...} }` — the Prisma 8 ORM relation mutator exposes only `create`/`connect`/`disconnect`; there is no nested `update` or `updateMany` on relations.

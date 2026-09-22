# Non-ported — methods-updateManyAndReturn-supported

- `packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts` › `should fail include on the user side` — updateManyAndReturn on User rejects `include: { posts: true }` — non-ported: same reason as createManyAndReturn-supported; Prisma 8's `updateAll` DOES support `include('posts')` on User
- `packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts` › `take should fail` — updateManyAndReturn rejects `take` option — non-ported: `updateAll` takes `(data, configure?)`, not an options bag
- `packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts` › `orderBy should fail` — updateManyAndReturn rejects `orderBy` option — non-ported: same reason
- `packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts` › `distinct should fail` — updateManyAndReturn rejects `distinct` option — non-ported: same reason

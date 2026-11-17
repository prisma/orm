# Non-ported — strictUndefinedChecks

- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on undefined argument` — `where: undefined` throws validation error — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on undefined input field` — `where: { email: undefined }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on undefined select field` — `select: { posts: undefined }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on undefined include field` — `include: { posts: undefined }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on undefined omit field` — `omit: { id: undefined }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on nested include` — `include: { posts: { include: { author: undefined } } }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on nested select` — `select: { posts: { select: { author: undefined } } }` throws — Prisma 8 has no strictUndefinedChecks feature
- `packages/client/tests/functional/strictUndefinedChecks/test.ts` › `throws on nested omit` — `select: { posts: { omit: { id: undefined } } }` throws — Prisma 8 has no strictUndefinedChecks feature

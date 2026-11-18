# Non-ported — issues-17405-extensions-casing

Matrix: all providers, `skipDb: true`. 1 test. Subject = `prisma.$extends({}).user.findFirst()` — verifies that a model whose name has a casing variation (`user`) instantiates and is callable via an extended client. Prisma 8 has no `$extends` surface → non-ported.

- `packages/client/tests/functional/issues/17405-extensions-casing/tests.ts` › `empty` — verifies `$extends({}).user.findFirst()` is callable without error when the model-name casing is `user` — no `$extends` surface in Prisma 8

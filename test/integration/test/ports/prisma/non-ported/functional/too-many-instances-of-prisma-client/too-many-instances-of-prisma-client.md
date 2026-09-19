# Non-ported — too-many-instances-of-prisma-client

- `packages/client/tests/functional/too-many-instances-of-prisma-client/tests.ts` › `should not console warn when spawning too many instances of PrismaClient` — constructs and connects fifteen generated `PrismaClient` instances and asserts the client's instance-count warning remains absent — non-portable because prisma-8 has no generated `PrismaClient` constructor or equivalent instance-count warning mechanism, so constructing repeated facades would test a different client lifecycle feature.

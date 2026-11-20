This test checks that the type definitions for DBNull, JsonNull and AnyNull also correctly work in monorepos where packages might get hoisted.

We had problems here when introducing the `@prisma/client-runtime-utils` with Prisma 7. See https://github.com/prisma/prisma/issues/28581.

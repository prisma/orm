# Non-ported — issues-12003-order-by-self

- `packages/client/tests/functional/issues/12003-order-by-self/tests.ts` › `findFirst` — orderBy across a self-relation works in findFirst — `orderBy` through `resource.dependsOn.id` requires relational-path orderBy, absent from Prisma 8 ORM
- `packages/client/tests/functional/issues/12003-order-by-self/tests.ts` › `findMany` — orderBy across a self-relation works in findMany — same relational orderBy gap
- `packages/client/tests/functional/issues/12003-order-by-self/tests.ts` › `aggregate` — orderBy across a self-relation works in aggregate — same relational orderBy gap

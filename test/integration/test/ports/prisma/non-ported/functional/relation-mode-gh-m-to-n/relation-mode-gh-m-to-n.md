# Non-ported — relation-mode-gh-m-to-n (SQL m:n)

Source: `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts`
(prisma/prisma@a6d0155, `manyToManySQLExplicit` branch). The `relationMode=foreignKeys`
matrix cells (both `isSchemaUsingMap=false` and `=true`) are ported under
`test/ports/prisma/functional/relation-mode-gh-m-to-n/` (`create.test.ts`, `update.test.ts`,
`delete.test.ts`). The `relationMode=prisma` matrix entries below are non-ported: Prisma 8
has no client-side `relationMode=prisma` referential-action emulation — it relies on real DB
foreign keys — so the emulated no-real-FK-check behaviour these tests exercise cannot be
expressed. One line per source test (each runs across all matrix actions).

- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts` › `m:n mandatory (explicit) - SQL Databases > [create] > [create] categoriesOnPostsModel with non-existing post and category id should succeed with prisma emulation` [testIf relationMode=prisma] — creates a join row with non-existing postId/categoryId and asserts it succeeds (no FK check) — Prisma 8 has no client-side relationMode=prisma referential-action emulation; it relies on DB foreign keys.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts` › `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=prisma - [update] categoriesOnPostsModel with non-existing postId should succeed` [testIf relationMode=prisma] — repoints a join row's postId to a non-existent post and asserts success — Prisma 8 has no client-side relationMode=prisma referential-action emulation; it relies on DB foreign keys.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts` › `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=prisma - [update] categoriesOnPostsModel with non-existing categoryId should succeed` [testIf relationMode=prisma] — repoints a join row's categoryId to a non-existent category and asserts success — Prisma 8 has no client-side relationMode=prisma referential-action emulation; it relies on DB foreign keys.

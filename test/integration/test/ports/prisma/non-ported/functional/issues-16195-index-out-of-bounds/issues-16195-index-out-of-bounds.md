# Non-ported: issues/16195-index-out-of-bounds

Source: `prisma/prisma@a6d0155 packages/client/tests/functional/issues/16195-index-out-of-bounds`
Provider: allProviders (postgres entry would apply)

- `packages/client/tests/functional/issues/16195-index-out-of-bounds/tests.ts` › `transaction` — verifies that `$transaction([findUnique, findMany])` (array-batch form) does not trigger an index-out-of-bounds engine panic — Prisma 8 does not support the array/batch `$transaction([...])` form; only the callback `transaction(async tx => {...})` form is available; the array form has no equivalent public API surface

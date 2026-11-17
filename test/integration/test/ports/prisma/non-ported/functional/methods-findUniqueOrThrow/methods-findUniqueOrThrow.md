# Non-ported — methods-findUniqueOrThrow

- `packages/client/tests/functional/methods/findUniqueOrThrow/tests.ts` › `works with transactions` — `prisma.$transaction([...])` — verifies batch transaction rolls back on `findUniqueOrThrow` failure — the array/batch `$transaction([...])` form has no Prisma 8 equivalent (interactive transactions ARE supported via the facade `transaction(cb)` and are ported)
- `packages/client/tests/functional/methods/findUniqueOrThrow/tests.ts` › `reports correct method name in case of validation error` — `prisma.user.findUniqueOrThrow({ where: { notAUserField: true } })` — verifies the error message contains the client method name — Prisma 8 errors carry structured codes, not the invoking method name

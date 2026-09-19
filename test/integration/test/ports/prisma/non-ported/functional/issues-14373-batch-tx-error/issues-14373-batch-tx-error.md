# Non-ported — issues-14373-batch-tx-error

- `packages/client/tests/functional/issues/14373-batch-tx-error/tests.ts` › `correctly reports location of a batch error` — a batch `$transaction([...])` error reports the correct failing query index — Prisma 8 does not have the array/batch form of `$transaction`; only the interactive callback form exists. (`_matrix.ts` uses `allProviders` so the suite would otherwise run on postgres, but the mechanism under test — `prisma.$transaction([op1, op2])` — is the array/batch form which has no equivalent in Prisma 8's public API.)

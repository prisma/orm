# Non-ported — issues-20499-result-ext-count

Matrix: all providers. 1 test. Subject = a `$extends` result extension that overrides a field does not break `.count()` on the extended client. Requires a `$extends` result extension; Prisma 8 has no `$extends` surface → non-ported.

- `packages/client/tests/functional/issues/20499-result-ext-count/tests.ts` › `result extensions do not break .count` — verifies `.count()` returns the correct value when a `$extends` result extension is applied — no `$extends` surface in Prisma 8

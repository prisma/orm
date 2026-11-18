# Non-ported — validator

- `packages/client/tests/functional/validator/tests.ts` › `validation via non-extended client` — `Prisma.validator<UserSelect>()({...})` and `Prisma.validator(prisma, 'user', 'findFirst')({...})` — Prisma 8 has no Prisma.validator API
- `packages/client/tests/functional/validator/tests.ts` › `validation via extended client` — `Prisma.validator(xprisma, 'user', ...)` on $extends client — Prisma 8 has no Prisma.validator API and no $extends

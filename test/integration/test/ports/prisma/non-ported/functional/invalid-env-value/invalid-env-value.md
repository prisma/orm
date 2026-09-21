# Non-ported — invalid-env-value

- `packages/client/tests/functional/invalid-env-value/tests.ts` › `PrismaClientInitializationError for invalid env` — a generated client resolves its datasource URL from a provider-specific environment variable and `$connect` reports Prisma's invalid-protocol initialization error — Prisma 8 contracts do not embed datasource environment-variable resolution and its public clients require an explicit binding, so the generated-client env-resolution subject cannot be expressed.

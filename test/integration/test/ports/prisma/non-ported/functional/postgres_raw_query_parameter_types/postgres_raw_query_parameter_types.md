# Non-ported — postgres_raw_query_parameter_types

- `packages/client/tests/functional/postgres_raw_query_parameter_types/test.ts` › `$queryRaw works with different parameter types` — executes identical raw SQL text first with an integer parameter and then with a decimal parameter to verify prepared-statement cache keys preserve parameter types — non-portable because prisma-8 has no public top-level tagged-template raw-query executor equivalent to `$queryRaw`; replacing the raw statements with an ORM or structured SQL-builder query would substitute the mechanism under test.

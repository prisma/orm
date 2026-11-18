# Non-ported — raw-queries-typed-results-advanced-and-native-types

- `packages/client/tests/functional/raw-queries/typed-results-advanced-and-native-types/tests.ts` › `query model with multiple fields` — reads a Postgres row through `$queryRaw` and asserts raw decoding of JSON, string and bigint arrays, `date`, and `time` values — non-portable because prisma-8 has no public top-level raw-query executor equivalent to `$queryRaw`; reading the row through the ORM or structured table query would replace the raw-result decoding mechanism under test.

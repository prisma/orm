# Non-ported — reconnect-failure

- `packages/client/tests/functional/reconnect-failure/tests.ts` › `example` — queries while the database is absent, starts the database, then verifies the same client instance reconnects and returns an empty result — non-portable because prisma-8's self-contained PGlite port harness provides a database only for the callback lifetime and no public test surface that drops and recreates that backend while retaining the same connected facade; constructing a new harness or client would not test same-client recovery.

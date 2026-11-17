# non-ported: chunking-query (individual non-portable tests)

Source: `packages/client/tests/functional/chunking-query/tests.ts`

Note: One test IS ported (see `.test.ts` in `functional/chunking-query/`).
The non-portable tests are listed below.

---

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when "in" has MAX ids` — subject: `tag.findMany({ where: { id: { in: ids } } })` over MAX_BIND_VALUES (32766) seeded tags succeeds because Prisma's engine chunks the IN query under the wire limit — non-ported: Prisma 8 does not chunk, so seeding MAX rows and selecting them back through one un-chunked IN query terminates the connection on the real CI Postgres backend (`SqlConnectionError`); it only passes under PGlite, which does not enforce the wire limit. The outcome is backend-dependent, so the chunking subject cannot be faithfully reproduced (a green under PGlite is vacuous). The sibling two-disjunct-IN case with no seeded rows returns `[]` and IS ported.

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when "include" involves MAX records` — subject: `tag.findMany({ include: { posts: true } })` with MAX_BIND_VALUES tags succeeds because the engine chunks the child-record IN lookup — non-ported (Prisma 8 uses LATERAL/json_agg for includes, not a separate child IN query; the chunking mechanism for includes is inexpressible in Prisma 8's ORM)

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when "include" involves EXCESS records` — subject: `tag.findMany({ include: { posts: true } })` with EXCESS_BIND_VALUES tags succeeds because the engine chunks the child-record IN lookup — non-ported (same as above; Prisma 8 uses LATERAL/json_agg, no chunking for child includes)

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when raw query has MAX ids` — subject: `$queryRawUnsafe('SELECT * FROM tag WHERE id IN ($1,$2,...)')` with MAX_BIND_VALUES parameters succeeds — non-ported (`$queryRawUnsafe` raw-SQL execution mechanism is the subject; no equivalent in Prisma 8's public ORM API)

- `packages/client/tests/functional/chunking-query/tests.ts` › `should fail when raw query has EXCESS ids` — subject: `$queryRawUnsafe` with EXCESS_BIND_VALUES parameters throws a database error — non-ported (`$queryRawUnsafe` raw-SQL execution mechanism is the subject; no equivalent in Prisma 8's public ORM API)

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when "in" has EXCESS ids` — subject: `tag.findMany({ where: { id: { in: ids } } })` with EXCESS_BIND_VALUES (32776) integer parameters; Prisma Client's query engine chunks the IN clause to avoid the 32767-param wire limit — non-ported: PGlite (WASM Postgres) does not enforce the 32767-param wire limit, so the failure mode cannot be reproduced in integration tests; the test would pass vacuously rather than faithfully representing the Prisma 8 gap

- `packages/client/tests/functional/chunking-query/tests.ts` › `Selecting EXCESS ids at once in two inclusive disjunct filters results in error` — subject: OR(id.in(ids), id.in(ids)) with EXCESS_BIND_VALUES entries should throw because prisma-8 does not chunk — non-ported: PGlite does not enforce the 32767-param wire limit, so the error cannot be reproduced in integration tests

- `packages/client/tests/functional/chunking-query/tests.ts` › `should succeed when "in" has EXCESS ids and a "skip" filter` — upstream test is `test.skip` (known flawed behavior, issue #23733); kept as non-ported to avoid conflating a skipped test with a ported test

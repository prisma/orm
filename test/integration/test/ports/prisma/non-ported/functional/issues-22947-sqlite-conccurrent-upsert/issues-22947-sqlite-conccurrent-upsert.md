# Non-ported — issues-22947-sqlite-conccurrent-upsert

- `packages/client/tests/functional/issues/22947-sqlite-conccurrent-upsert/tests.ts` › `concurrent upserts should succeed` — concurrent upserts on a Tag model succeed without conflict errors — the test's `optOut` explicitly excludes postgresql, cockroachdb, mysql, sqlserver, and mongodb; the suite runs only on sqlite. Prisma 8 has no self-contained SQLite integration harness (SQLite target pre-GA per spec), so this test is non-portable on any currently available harness.

# Non-ported — legacy-json

- `packages/client/tests/functional/0-legacy-ports/json/tests.ts` › `select required json with where path` — filter by JSON path equals (mysql/sqlite string path, postgres/cockroach array path) (testIf: mysql/postgresql/cockroachdb/sqlite only) — JSON path filter ({ path:[...], equals }) — Prisma 8 jsonb ORM surface exposes whole-value equality only, no path operator

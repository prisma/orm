# Non-ported — fulltext-search

- `packages/client/tests/functional/fulltext-search/tests.ts` › `AND query` — `findMany({ where: { name: { search: andQuery } } })` — PostgreSQL full-text `@@` search with tsquery `&` operator — no `search:` filter in the Prisma 8 ORM where surface (no tsvector/tsquery generation or `@@` operator).
- `packages/client/tests/functional/fulltext-search/tests.ts` › `OR query` — full-text search with tsquery `|` operator — same gap.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `NOT query` — full-text search with tsquery `!` NOT operator — same gap.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `no results` — full-text search query returning zero results — same gap.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `bad query` — bad tsquery string throws a Prisma error snapshot — same gap; additionally uses `rejects.toMatchPrismaErrorSnapshot()` which is Prisma-client-specific.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `order by relevance on a single field` — `orderBy: { _relevance: { fields: ['name'], search: 'John', sort: 'desc' } }` — `_relevance` ordering (ts_rank) — no `_relevance` / full-text ranking orderBy in Prisma 8 ORM.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `order by relevance on multiple fields` — multi-field `_relevance` orderBy — same gap.
- `packages/client/tests/functional/fulltext-search/tests.ts` › `order by relevance: multiple orderBy statements` — `_relevance` orderBy with multiple fields — same gap.

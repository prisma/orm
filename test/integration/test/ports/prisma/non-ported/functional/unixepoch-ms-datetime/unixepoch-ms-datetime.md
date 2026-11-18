# Non-ported — unixepoch-ms-datetime

- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with a find unique query` — SQLite-only; tests PrismaLibSql/PrismaBetterSqlite3 driver adapter `timestampFormat: 'unixepoch-ms'` option — suite matrix is `[{provider: Providers.SQLITE}]` only; Prisma 8 integration corpus targets postgres (PGlite); no SQLite target.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with a find unique query when it was stored directly as a millis number` — SQLite-only unixepoch-ms driver adapter behavior — same: SQLite-only, no postgres target.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with a raw query` — SQLite-only; uses `$queryRaw` — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with a raw query by a millis number` — SQLite-only; uses `$queryRaw` — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with a find many query` — SQLite-only — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `can retrieve a unixepoch-ms date time with compactable find unique queries` — SQLite-only; tests query compaction — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `findUnique() returns valid Date when createdAt is stored as unix millis directly` — SQLite-only; uses `$executeRaw` — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `aggregate() returns valid Date when unix millis are stored directly` — SQLite-only; uses `$executeRaw` + aggregate — same.
- `packages/client/tests/functional/unixepoch-ms-datetime/tests.ts` › `manually created INTEGER DateTime column returns valid Date values` — SQLite-only; creates table with `$executeRaw`; uses `CREATE TABLE` + `$executeRaw` — same.

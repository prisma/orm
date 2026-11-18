# Non-ported — issues-21369-select-null

- `packages/client/tests/functional/issues/21369-select-null/tests.ts` › `SELECT NULL works` — subject: `$queryRaw\`SELECT NULL AS result\`` returns `[{ result: null }]` — Not yet ported; the earlier reason (no raw SQL surface) no longer holds: ``db.raw.sql`…`.returnsRow({ result: { codecId: 'pg/text@1', nullable: true } })`` runs a whole-query raw statement without a table (`packages/2-sql-family/4-lanes/sql-builder/src/types/raw-query.ts`).

# Non-ported — issues-21369-select-null

- `packages/client/tests/functional/issues/21369-select-null/tests.ts` › `SELECT NULL works` — subject: `$queryRaw\`SELECT NULL AS result\`` returns `[{ result: null }]`; Prisma 8 has no free-standing raw SQL execution surface (`sql()` builder is table-anchored, and `runtime.query()` is a seeding/inspection escape hatch not part of the public API) — non-ported (no free-standing raw SQL surface; sql() builder is table-anchored)

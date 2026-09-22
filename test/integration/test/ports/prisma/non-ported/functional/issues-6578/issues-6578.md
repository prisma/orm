# Non-ported — issues-6578

- `packages/client/tests/functional/issues/6578/tests.ts` › `should assert Dates, DateTimes, Times and UUIDs are wrapped in quotes and are deserializable` — raw-query JSON output quotes Date/DateTime/Time/UUID so JSON.parse does not throw — exercises `prisma.$on('query')` event system + SQL-parameter string serialisation; no equivalent in Prisma 8

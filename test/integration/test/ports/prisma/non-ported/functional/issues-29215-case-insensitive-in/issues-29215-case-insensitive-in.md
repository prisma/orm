# Non-ported — issues-29215-case-insensitive-in

- `packages/client/tests/functional/issues/29215-case-insensitive-in/tests.ts` › `correctly handles a case insensitive IN filter` — subject: `{ in: [...], mode: 'insensitive' }` case-insensitive IN filter; Prisma 8 has no case-insensitive IN operator (the `.in()` method is case-sensitive; replacing with OR-of-ilike would change the mechanism) — non-ported (no case-insensitive IN in Prisma 8 public ORM API)
- `packages/client/tests/functional/issues/29215-case-insensitive-in/tests.ts` › `correctly handles a case insensitive NOT IN filter` — subject: `{ notIn: [...], mode: 'insensitive' }` case-insensitive NOT IN filter; same gap — non-ported (no case-insensitive NOT IN in Prisma 8 public ORM API)

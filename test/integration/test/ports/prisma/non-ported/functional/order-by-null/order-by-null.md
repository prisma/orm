# Non-ported — order-by-null

- `packages/client/tests/functional/order-by-null/tests.ts` › `should return records sorted by name asc and null first` — `orderBy: { name: { sort: 'asc', nulls: 'first' } }` — null-first/last ordering — ORM `orderBy` callback exposes only `.asc()`/`.desc()`; `OrderByItem` has no nulls field; `NULLS FIRST/LAST` is absent from the entire Prisma 8 SQL surface.
- `packages/client/tests/functional/order-by-null/tests.ts` › `should return records sorted by name asc and null last` — `orderBy: { name: { sort: 'asc', nulls: 'last' } }` — null-last ordering — same gap.
- `packages/client/tests/functional/order-by-null/tests.ts` › `should return records sorted by name desc and null first` — `orderBy: { name: { sort: 'desc', nulls: 'first' } }` — null-first with desc ordering — same gap.
- `packages/client/tests/functional/order-by-null/tests.ts` › `should return records sorted by name desc and null last` — `orderBy: { name: { sort: 'desc', nulls: 'last' } }` — null-last with desc ordering — same gap.

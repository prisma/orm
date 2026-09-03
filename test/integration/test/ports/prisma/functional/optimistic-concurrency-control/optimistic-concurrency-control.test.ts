import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/optimistic-concurrency-control
// (postgres matrix entry; allProviders with skipTestIf guards).
//
// Regression test for issue #8612 — Optimistic Concurrency Control (OCC).
//
// Non-ported tests (require `{ increment: N }` atomic field update — not in ORM API):
//   - prisma/functional/optimistic-concurrency-control › updateMany
//     `data: { occStamp: { increment: 1 } }` — ORM updateAll() accepts plain values only
//   - prisma/functional/optimistic-concurrency-control › update
//     same: `{ occStamp: { increment: 1 } }` not expressible
//   - prisma/functional/optimistic-concurrency-control › upsert
//     same: `update: { occStamp: { increment: 1 } }` not expressible
//   - prisma/functional/optimistic-concurrency-control › update with upsert relation
//     same: `occStamp: { increment: 1 }` + nested `child: { upsert: {...} }` not expressible
//
// Ported test:
//   - deleteMany — filters by `occStamp: 0`; 5 concurrent deletes on a single row;
//     total deleted count is 1. Uses `deleteAll()` whose single-statement
//     DELETE…RETURNING is atomic (occStamp is @unique so at most one row matches).

describe('ports/prisma/functional/optimistic-concurrency-control', () => {
  it(
    'deleteMany — only one concurrent delete succeeds when filtering by unique stamp',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Resource.create({});

        const fn = async (): Promise<number> => {
          const deleted = await db.public.Resource.where({ occStamp: 0 }).deleteAll();
          return deleted.length;
        };

        const results = await Promise.all([fn(), fn(), fn(), fn(), fn()]);
        const totalCount = results.reduce((acc, result) => acc + result, 0);

        expect(totalCount).toBe(1);
      }),
    timeouts.spinUpPpgDev,
  );
});

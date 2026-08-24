import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/29254-query-plan-cache-mutation
// (postgres matrix entry; allProviders — we port postgres).
//
// Subject: two subsequent findMany calls with different cursor values return
// correct non-mutated results (regression: query plan cache was sharing mutable
// state between calls, causing the second cursor to use the first query's cursor).
//
// Observable behavior: two sequential cursor-paginated queries with different
// cursor values each return the correct page (correctness across two cursor calls).
//
// Cursor semantics gap:
//   Prisma cursor is INCLUSIVE (starts FROM the cursor row); skip=1 skips
//   the cursor row itself, yielding the next row.
//   prisma-next cursor is EXCLUSIVE (starts AFTER the cursor row); skip=1
//   skips one MORE row after the cursor.
//
//   Query 1: cursor=id1, skip=1, take=1
//     Prisma:      starts FROM id1 (price=10), skip 1 → id2 (price=20) ✓
//     prisma-next: starts AFTER id1, skip 1 → id3 (price=30) ✗
//
//   Query 2: cursor=id2, skip=1, take=1
//     Prisma:      starts FROM id2 (price=20), skip 1 → id3 (price=30) ✓
//     prisma-next: starts AFTER id2, skip 1 → beyond end → [] ✗
//
// A faithful port runs both queries with `.orderBy().cursor().offset(1).limit(1).all()`
// but the assertions from the upstream test will fail → it.fails (semantics gap).
//
// Dispositions:
//   'correctly handles two subsequent queries with a different cursor' → it.fails

describe('ports/prisma/functional/issues-29254-query-plan-cache-mutation', () => {
  it.fails(
    'correctly handles two subsequent queries with a different cursor',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const id1 = 'aaaa';
        const id2 = 'bbbb';
        const id3 = 'cccc';

        await db.public.Item.createAll([
          { id: id1, price: 10 },
          { id: id2, price: 20 },
          { id: id3, price: 30 },
        ]);

        // Upstream orderBy: [{ price: 'asc' }, { id: 'asc' }].
        // prisma-next: array of callbacks for multi-column orderBy.
        const result1 = await db.public.Item.orderBy([(i) => i.price.asc(), (i) => i.id.asc()])
          .cursor({ id: id1, price: 10 })
          .offset(1)
          .limit(1)
          .all();

        // Prisma (inclusive cursor + skip=1): [{ id: id2, price: 20 }]
        // prisma-next (exclusive cursor + skip=1): [{ id: id3, price: 30 }]
        expect(result1).toEqual([{ id: id2, price: 20 }]);

        const result2 = await db.public.Item.orderBy([(i) => i.price.asc(), (i) => i.id.asc()])
          .cursor({ id: id2, price: 20 })
          .offset(1)
          .limit(1)
          .all();

        // Prisma (inclusive cursor + skip=1): [{ id: id3, price: 30 }]
        // prisma-next (exclusive cursor + skip=1): [] (past the end)
        expect(result2).toEqual([{ id: id3, price: 30 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
